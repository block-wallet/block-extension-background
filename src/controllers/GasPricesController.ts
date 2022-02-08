/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BaseController } from '../infrastructure/BaseController';
import NetworkController, { NetworkEvents } from './NetworkController';
import { BigNumber, utils } from 'ethers';
import log from 'loglevel';
import { Mutex } from 'async-mutex';
import {
    ACTIONS_TIME_INTERVALS_DEFAULT_VALUES,
    Network,
} from '../utils/constants/networks';
import { FeeData } from '@ethersproject/abstract-provider';
import axios from 'axios';
import { ActionIntervalController } from './block-updates/ActionIntervalController';
import BlockUpdatesController, {
    BlockUpdatesEvents,
} from './block-updates/BlockUpdatesController';

const CHAIN_FEE_DATA_SERVICE_URL = 'https://chain-fee.blockwallet.io/v1';
const BLOCKS_TO_WAIT_BEFORE_CHECHKING_FOR_CHAIN_SUPPORT = 100;

export enum GasPriceLevelsEnum {
    SLOW = 'slow',
    AVERAGE = 'average',
    FAST = 'fast',
}

/**
 * The levels of gas price in WEI
 */
export type GasPriceLevels = {
    slow: FeeData;
    average: FeeData;
    fast: FeeData;
};

export interface GasPriceData {
    gasPricesLevels: GasPriceLevels;
    blockGasLimit: BigNumber;
    baseFee?: BigNumber;
    estimatedBaseFee?: BigNumber;
    chainSupportedByFeeService?: {
        lastBlockChecked: number;
        supported: boolean;
    };
}

export interface GasPricesControllerState {
    gasPriceData: { [chainId: number]: GasPriceData };
}

export interface FeeHistory {
    baseFeePerGas: string[];
    gasUsedRatio: number[];
    oldestBlock: number;
    reward?: string[][];
}

const expirationTime = 75000;
export class GasPricesController extends BaseController<GasPricesControllerState> {
    private readonly _gasPriceUpdateIntervalController: ActionIntervalController;
    private readonly _mutex: Mutex;
    private expiration: number;

    constructor(
        private readonly _networkController: NetworkController,
        private readonly _blockUpdatesController: BlockUpdatesController,
        initialState: GasPricesControllerState
    ) {
        super(initialState);

        this._mutex = new Mutex();
        this._gasPriceUpdateIntervalController = new ActionIntervalController(
            this._networkController
        );

        // Set for expiration policy
        this.expiration = new Date().getTime();
        this._networkController.on(
            NetworkEvents.NETWORK_CHANGE,
            async (network: Network) => {
                this.updateGasPrices(network.chainId);
            }
        );

        // Subscription to new blocks
        this._blockUpdatesController.on(
            BlockUpdatesEvents.BLOCK_UPDATES_SUBSCRIPTION,
            async (chainId: number, _: number, newBlockNumber: number) => {
                const network =
                    this._networkController.getNetworkFromChainId(chainId);
                const interval =
                    network?.actionsTimeIntervals.gasPricesUpdate ||
                    ACTIONS_TIME_INTERVALS_DEFAULT_VALUES.gasPricesUpdate;

                this._gasPriceUpdateIntervalController.tick(
                    interval,
                    async () => {
                        await this.updateGasPrices(newBlockNumber, chainId);
                    }
                );
            }
        );
    }

    /**
     * return the state by chain
     */
    public getState(
        chainId: number = this._networkController.network.chainId
    ): GasPriceData {
        const state = this.store.getState();

        if (chainId in state.gasPriceData) {
            return state.gasPriceData[chainId];
        }

        return {
            blockGasLimit: BigNumber.from(0),
            gasPricesLevels: { slow: {}, average: {}, fast: {} },
        } as GasPriceData;
    }

    /**
     * Get latest fee data
     */
    public getFeeData(chainId?: number): FeeData {
        return this.getState(chainId).gasPricesLevels.average;
    }

    /**
     * Get latest gas prices levels
     */
    public getGasPricesLevels(chainId?: number): GasPriceLevels {
        return this.getState(chainId).gasPricesLevels;
    }

    /**
     * It updates the state with the current gas prices following
     * a 5% variation and expiration policy
     */
    public updateGasPrices = async (
        currentBlockNumber: number,
        chainId: number = this._networkController.network.chainId
    ): Promise<void> => {
        try {
            const oldGasPriceLevels = this.getGasPricesLevels(chainId);
            const isEIP1559Compatible =
                await this._networkController.getEIP1559Compatibility(chainId);

            const newGasPriceLevels = await this._fetchFeeData(
                isEIP1559Compatible,
                oldGasPriceLevels,
                currentBlockNumber,
                chainId
            );

            const time = new Date().getTime();
            if (time - this.expiration > expirationTime) {
                await this._updateState(chainId, {
                    gasPricesLevels: newGasPriceLevels,
                });
                this.expiration = time;
                return;
            }

            const shouldUpdate = Object.entries(newGasPriceLevels).reduce(
                (pv, [level, feeData]) => {
                    if (pv !== true) {
                        let newValue: number;
                        let oldValue: number;

                        if (isEIP1559Compatible) {
                            const oldGasPrice =
                                oldGasPriceLevels[level as keyof GasPriceLevels]
                                    .maxPriorityFeePerGas || '0';

                            newValue = Number(
                                utils.formatEther(feeData.maxPriorityFeePerGas!)
                            );
                            oldValue = Number(utils.formatEther(oldGasPrice));
                        } else {
                            const oldGasPrice =
                                oldGasPriceLevels[level as keyof GasPriceLevels]
                                    .gasPrice || '0';

                            newValue = Number(
                                utils.formatEther(feeData.gasPrice!)
                            );
                            oldValue = Number(utils.formatEther(oldGasPrice));
                        }

                        /* oldValue will be 0, if previous stored gas is incompatible with
                                      current network (e.g. due toEIP1559) */
                        if (oldValue == 0) {
                            return true;
                        }

                        const diff = Math.abs(newValue - oldValue) / oldValue;

                        return diff > 0.05;
                    }
                    return true;
                },
                false
            );

            if (shouldUpdate) {
                await this._updateState(chainId, {
                    gasPricesLevels: newGasPriceLevels,
                });
            }
        } catch (error) {
            log.warn('Unable to update the gas prices', error.message || error);
        }
    };

    /**
     * Fetches the fee's service to get the current gas prices.
     * If the service is not available or the chain is not supported then
     * it requests the chain.
     *
     * @param isEIP1559Compatible
     * @param fallbackGasPrices
     * @param chainId
     * @returns GasPriceLevels
     */
    private async _fetchFeeData(
        isEIP1559Compatible: boolean,
        fallbackGasPrices: GasPriceLevels,
        currentBlockNumber: number,
        chainId: number = this._networkController.network.chainId
    ): Promise<GasPriceLevels> {
        try {
            let gasPriceData: GasPriceData = {} as GasPriceData;
            let hasToRequestTheChain = false;

            // Fetch the service to detect if the chain has support.
            try {
                if (
                    this._shouldRequestChainService(currentBlockNumber, chainId)
                ) {
                    // If the chain has support request the service
                    const feeDataResponse = await axios.get(
                        `${CHAIN_FEE_DATA_SERVICE_URL}/fee_data`,
                        {
                            params: {
                                chain_id: chainId,
                            },
                        }
                    );

                    if (
                        feeDataResponse.status === 200 &&
                        feeDataResponse.data
                    ) {
                        // Parsing the gas result considering the EIP1559 status
                        if (isEIP1559Compatible) {
                            gasPriceData = {
                                blockGasLimit: BigNumber.from(
                                    feeDataResponse.data.blockGasLimit
                                ),
                                baseFee: BigNumber.from(
                                    feeDataResponse.data.baseFee
                                ),
                                estimatedBaseFee: BigNumber.from(
                                    feeDataResponse.data.estimatedBaseFee
                                ),
                                gasPricesLevels: {
                                    slow: {
                                        gasPrice: null,
                                        maxFeePerGas: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .slow.maxFeePerGas
                                        ),
                                        maxPriorityFeePerGas: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .slow.maxPriorityFeePerGas
                                        ),
                                    },
                                    average: {
                                        gasPrice: null,
                                        maxFeePerGas: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .average.maxFeePerGas
                                        ),
                                        maxPriorityFeePerGas: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .average.maxPriorityFeePerGas
                                        ),
                                    },
                                    fast: {
                                        gasPrice: null,
                                        maxFeePerGas: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .fast.maxFeePerGas
                                        ),
                                        maxPriorityFeePerGas: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .fast.maxPriorityFeePerGas
                                        ),
                                    },
                                },
                            };
                        } else {
                            gasPriceData = {
                                blockGasLimit: BigNumber.from(
                                    feeDataResponse.data.blockGasLimit
                                ),
                                gasPricesLevels: {
                                    slow: {
                                        gasPrice: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .slow.gasPrice
                                        ),
                                        maxFeePerGas: null,
                                        maxPriorityFeePerGas: null,
                                    },
                                    average: {
                                        gasPrice: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .average.gasPrice
                                        ),
                                        maxFeePerGas: null,
                                        maxPriorityFeePerGas: null,
                                    },
                                    fast: {
                                        gasPrice: BigNumber.from(
                                            feeDataResponse.data.gasPricesLevels
                                                .fast.gasPrice
                                        ),
                                        maxFeePerGas: null,
                                        maxPriorityFeePerGas: null,
                                    },
                                },
                            };
                        }
                    } else {
                        hasToRequestTheChain = true;
                    }
                } else {
                    hasToRequestTheChain = true;
                }
            } catch (error) {
                log.error('error calling chain fees service', error);
                hasToRequestTheChain = true;
            }

            // If it has no support or the service fails we have to query the chain.
            if (hasToRequestTheChain) {
                if (isEIP1559Compatible) {
                    const provider = this._networkController.getProvider();

                    const networkCalls = await Promise.all([
                        // Get blockBaseFee of the last block
                        this._networkController.getLatestBlock(),
                        // Get eth_feeHistory
                        // gets 10%, 25% and 50% percentile fee history of txs included in last 5 blocks
                        provider.send('eth_feeHistory', [
                            '0x5',
                            'latest',
                            [10, 25, 50],
                        ]),
                    ]);

                    const blockGasLimit: BigNumber = BigNumber.from(
                        networkCalls[0].gasLimit
                    );

                    const blockBaseFee: BigNumber = BigNumber.from(
                        networkCalls[0].baseFeePerGas
                    );
                    const feeHistory: FeeHistory = networkCalls[1];

                    // last element in array is the next block after the latest (estimated)
                    let estimatedBaseFee = blockBaseFee;
                    if (feeHistory.baseFeePerGas) {
                        estimatedBaseFee = BigNumber.from(
                            feeHistory.baseFeePerGas[
                                feeHistory.baseFeePerGas.length - 1
                            ]
                        );
                    }

                    const rewardsSlow: BigNumber[] = [];
                    const rewardsAverage: BigNumber[] = [];
                    const rewardsFast: BigNumber[] = [];

                    // add all rewards to rewards array
                    for (let i = 0; i < feeHistory.reward!.length; i++) {
                        rewardsSlow.push(
                            BigNumber.from(feeHistory.reward![i][0])
                        );
                        rewardsAverage.push(
                            BigNumber.from(feeHistory.reward![i][1])
                        );
                        rewardsFast.push(
                            BigNumber.from(feeHistory.reward![i][2])
                        );
                    }

                    // sort rewards array lowest to highest
                    rewardsSlow.sort();
                    rewardsAverage.sort();
                    rewardsFast.sort();

                    // choose middle tip as suggested tip
                    const maxPriorityFeePerGasSlow =
                        rewardsSlow[Math.floor(rewardsSlow.length / 2)];
                    const maxPriorityFeePerGasAverage =
                        rewardsAverage[Math.floor(rewardsAverage.length / 2)];
                    const maxPriorityFeePerGasFast =
                        rewardsFast[Math.floor(rewardsFast.length / 2)];

                    const slowBaseFeePerGas = estimatedBaseFee.mul(90).div(100);
                    const averageBaseFeePerGas = estimatedBaseFee
                        .mul(110)
                        .div(100);
                    const fastBaseFeePerGas = estimatedBaseFee
                        .mul(130)
                        .div(100);

                    const maxFeePerGasSlow = BigNumber.from(
                        maxPriorityFeePerGasSlow
                    ).add(slowBaseFeePerGas);
                    const maxFeePerGasAverage = BigNumber.from(
                        maxPriorityFeePerGasAverage
                    ).add(averageBaseFeePerGas);
                    const maxFeePerGasFast = BigNumber.from(
                        maxPriorityFeePerGasFast
                    ).add(fastBaseFeePerGas);

                    // Parsing the gas result considering the EIP1559 status
                    gasPriceData = {
                        blockGasLimit: blockGasLimit,
                        baseFee: BigNumber.from(blockBaseFee),
                        estimatedBaseFee: BigNumber.from(estimatedBaseFee),
                        gasPricesLevels: {
                            slow: {
                                gasPrice: null,
                                maxFeePerGas: BigNumber.from(maxFeePerGasSlow),
                                maxPriorityFeePerGas: BigNumber.from(
                                    maxPriorityFeePerGasSlow
                                ),
                            },
                            average: {
                                gasPrice: null,
                                maxFeePerGas:
                                    BigNumber.from(maxFeePerGasAverage),
                                maxPriorityFeePerGas: BigNumber.from(
                                    maxPriorityFeePerGasAverage
                                ),
                            },
                            fast: {
                                gasPrice: null,
                                maxFeePerGas: BigNumber.from(maxFeePerGasFast),
                                maxPriorityFeePerGas: BigNumber.from(
                                    maxPriorityFeePerGasFast
                                ),
                            },
                        },
                    };
                } else {
                    const networkCalls = await Promise.all([
                        this._networkController.getProvider().getGasPrice(),
                        this._networkController.getLatestBlock(),
                    ]);

                    const gasPrice: BigNumber = BigNumber.from(networkCalls[0]);
                    const { gasLimit: blockGasLimit } = networkCalls[1];

                    const gasPriceSlow = gasPrice.mul(85).div(100);
                    const gasPriceAverage = gasPrice;
                    const gasPriceFast = gasPrice.mul(125).div(100);

                    // Parsing the gas result considering the EIP1559 status
                    gasPriceData = {
                        blockGasLimit: blockGasLimit,
                        gasPricesLevels: {
                            slow: {
                                gasPrice: BigNumber.from(gasPriceSlow),
                                maxFeePerGas: null,
                                maxPriorityFeePerGas: null,
                            },
                            average: {
                                gasPrice: BigNumber.from(gasPriceAverage),
                                maxFeePerGas: null,
                                maxPriorityFeePerGas: null,
                            },
                            fast: {
                                gasPrice: BigNumber.from(gasPriceFast),
                                maxFeePerGas: null,
                                maxPriorityFeePerGas: null,
                            },
                        },
                    };
                }
            }

            // Storing in the state the fee data, not the levels
            await this._updateState(chainId, {
                blockGasLimit: gasPriceData.blockGasLimit,
                baseFee: gasPriceData.baseFee,
                estimatedBaseFee: gasPriceData.estimatedBaseFee,
                chainSupportedByFeeService: {
                    lastBlockChecked: currentBlockNumber,
                    supported: !hasToRequestTheChain,
                },
            });

            // Filtering gas prices
            gasPriceData.gasPricesLevels = this._ensureLowerPrices(
                chainId,
                isEIP1559Compatible,
                gasPriceData.gasPricesLevels
            );

            // Returning the gas levels
            return gasPriceData.gasPricesLevels;
        } catch (e) {
            log.error(e);
            return fallbackGasPrices;
        }
    }

    /**
     * For non EIP1559 chains this method ensures that all the
     * gas prices are above the chain lower cap if it exists.
     * @param chainId
     * @param isEIP1559Compatible
     * @param gasPrices
     * @returns a corrected gas prices
     */
    private _ensureLowerPrices(
        chainId: number,
        isEIP1559Compatible: boolean,
        gasPrices: GasPriceLevels
    ): GasPriceLevels {
        // For now it's the ony type of gas that this validation supports.
        if (!isEIP1559Compatible) {
            const network =
                this._networkController.getNetworkFromChainId(chainId);

            if (
                network &&
                network.gasLowerCap &&
                network.gasLowerCap.gasPrice
            ) {
                // If slow is lower than the lower cap we fix it.
                if (
                    BigNumber.from(network.gasLowerCap.gasPrice).gt(
                        BigNumber.from(gasPrices.slow.gasPrice)
                    )
                ) {
                    gasPrices.slow.gasPrice = BigNumber.from(
                        network.gasLowerCap.gasPrice
                    );
                }

                // If average is lower than the lower cap we fix it.
                if (
                    BigNumber.from(network.gasLowerCap.gasPrice).gt(
                        BigNumber.from(gasPrices.average.gasPrice)
                    )
                ) {
                    gasPrices.average.gasPrice = BigNumber.from(
                        network.gasLowerCap.gasPrice
                    );
                }

                // If average is lower or equal than slow cap we increment it.
                if (
                    BigNumber.from(gasPrices.average.gasPrice).lte(
                        BigNumber.from(gasPrices.slow.gasPrice)
                    )
                ) {
                    gasPrices.average.gasPrice = BigNumber.from(
                        gasPrices.slow.gasPrice
                    )
                        .mul(125)
                        .div(100);
                }

                // If fast is lower than the lower cap we fix it.
                if (
                    BigNumber.from(network.gasLowerCap.gasPrice).gt(
                        BigNumber.from(gasPrices.fast.gasPrice)
                    )
                ) {
                    gasPrices.fast.gasPrice = BigNumber.from(
                        network.gasLowerCap.gasPrice
                    );
                }

                // If average is lower or equal than fast cap we increment it.
                if (
                    BigNumber.from(gasPrices.fast.gasPrice).lte(
                        BigNumber.from(gasPrices.average.gasPrice)
                    )
                ) {
                    gasPrices.fast.gasPrice = BigNumber.from(
                        gasPrices.average.gasPrice
                    )
                        .mul(125)
                        .div(100);
                }
            }
        }

        return gasPrices;
    }

    /**
     * update the state by chain
     */
    private async _updateState(
        chainId: number = this._networkController.network.chainId,
        gasPriceData: Partial<GasPriceData>
    ) {
        const releaseLock = await this._mutex.acquire();

        try {
            const state = this.store.getState();

            const currentChainGasPriceData = {
                ...state.gasPriceData[chainId],
                ...gasPriceData,
            };

            this.store.setState({
                ...state,
                gasPriceData: {
                    ...state.gasPriceData,
                    [chainId]: currentChainGasPriceData,
                },
            });
        } finally {
            releaseLock();
        }
    }

    /**
     * Decides if the fee service should be requested.
     * It should be requested in these cases:
     *  - There is no information about the chain
     *  - The chain is already supported
     *  - There is a gap higher than BLOCKS_TO_WAIT_BEFORE_CHECHKING_FOR_CHAIN_SUPPORT between
     *    the current block and the block of the moment of the last update
     * @param currentBlockNumber
     * @param chainId
     * @returns
     */
    private _shouldRequestChainService(
        currentBlockNumber: number,
        chainId?: number
    ): boolean {
        const { chainSupportedByFeeService } = this.getState(chainId);

        if (!chainSupportedByFeeService) {
            return true;
        }

        if (chainSupportedByFeeService.supported) {
            return true;
        }

        return (
            currentBlockNumber - chainSupportedByFeeService.lastBlockChecked >
            BLOCKS_TO_WAIT_BEFORE_CHECHKING_FOR_CHAIN_SUPPORT
        );
    }
}
