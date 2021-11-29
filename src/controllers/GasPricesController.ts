/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BaseController } from '../infrastructure/BaseController';
import NetworkController, { NetworkEvents } from './NetworkController';
import { TransactionMeta, TransactionType } from './transactions/utils/types';

import { BigNumber, utils } from 'ethers';
import { getTransactionType } from './transactions/utils/utils';
import log from 'loglevel';
import { Mutex } from 'async-mutex';
import { Network } from '../utils/constants/networks';
import {
    FeeMarketEIP1559Values,
    GasPriceValue,
} from './transactions/TransactionController';

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
    baseFeePerGas?: null | BigNumber;
    gasPrices: GasPriceLevels;
    isEIP1559Compatible?: boolean;
}

export interface GasPricesControllerState {
    gasPriceData: { [chainId: number]: GasPriceData };
}

/**
 * Gas information for a transaction
 * It supports gas configuration for post and pre EIP1559.
 */
export interface FeeData
    extends Partial<GasPriceValue>,
        Partial<FeeMarketEIP1559Values> {
    /**
     * Amount of gas to spend in the transaction fee.
     */
    gasLimit?: BigNumber;
}

export interface FeeHistory {
    baseFeePerGas: string[];
    gasUsedRatio: number[];
    oldestBlock: number;
    reward?: string[][];
}

const expirationTime = 75000;
export class GasPricesController extends BaseController<GasPricesControllerState> {
    private readonly _networkController: NetworkController;
    private readonly _mutex: Mutex;
    private expiration: number;

    constructor(
        initialState: GasPricesControllerState,
        networkController: NetworkController
    ) {
        super(initialState);

        this._mutex = new Mutex();
        this._networkController = networkController;

        // Set for expiration policy
        this.expiration = new Date().getTime();

        this.updateEIP1559Compatibility();

        this._networkController.on(
            NetworkEvents.NETWORK_CHANGE,
            async (network: Network) => {
                this.updateGasPrices(network.chainId);
            }
        );
    }

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

    private _getState(
        chainId: number = this._networkController.network.chainId
    ): GasPriceData {
        const state = this.store.getState();

        if (chainId in state.gasPriceData) {
            return state.gasPriceData[chainId];
        }

        return {
            gasPrices: { slow: {}, average: {}, fast: {} },
        } as GasPriceData;
    }

    public gasPrices(chainId?: number): GasPriceLevels {
        return this._getState(chainId).gasPrices;
    }

    /**
     * update EIP1559 compatibility in state
     */
    public async updateEIP1559Compatibility(
        chainId?: number
    ): Promise<boolean> {
        const isEIP1559Compatible = await this._networkController.getEIP1559Compatibility();

        await this._updateState(chainId, { isEIP1559Compatible });

        return isEIP1559Compatible;
    }

    /**
     * get EIP1559 compatibility from state
     */
    public async getEIP1559Compatibility(chainId?: number): Promise<boolean> {
        const state = this._getState(chainId);
        if (state.isEIP1559Compatible !== undefined) {
            return state.isEIP1559Compatible!;
        }
        return await this.updateEIP1559Compatibility(chainId);
    }

    /**
     * It updates the state with the current gas prices following
     * a 5% variation and expiration policy
     */
    public async updateGasPrices(
        chainId: number = this._networkController.network.chainId
    ): Promise<void> {
        try {
            const { gasPrices } = this._getState(chainId);
            const isEIP1559Compatible = await this.getEIP1559Compatibility(
                chainId
            );

            let newGasPrices;
            if (isEIP1559Compatible) {
                newGasPrices = await this.getEIP1599GasPriceLevels(gasPrices);
            } else {
                newGasPrices = await this.getGasPriceLevels(gasPrices);
            }

            const time = new Date().getTime();
            if (time - this.expiration > expirationTime) {
                await this._updateState(chainId, { gasPrices: newGasPrices });
                this.expiration = time;
                return;
            }

            const shouldUpdate = Object.entries(newGasPrices).reduce(
                (pv, [level, feeData]) => {
                    if (pv !== true) {
                        let newValue: number;
                        let oldValue: number;

                        if (isEIP1559Compatible) {
                            const oldGasPrice =
                                gasPrices[level as keyof GasPriceLevels]
                                    .maxPriorityFeePerGas || '0';

                            newValue = Number(
                                utils.formatEther(feeData.maxPriorityFeePerGas!)
                            );
                            oldValue = Number(utils.formatEther(oldGasPrice));
                        } else {
                            const oldGasPrice =
                                gasPrices[level as keyof GasPriceLevels]
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
                await this._updateState(chainId, { gasPrices: newGasPrices });
            }
        } catch (error) {
            log.warn('Unable to update the gas prices', error.message || error);
        }
    }

    /**
     * Updates the baseFeePerGas
     */
    public async updateBaseFeePerGas(chainId?: number): Promise<void> {
        const baseFeePerGas = (await this._networkController.getLatestBlock())
            .baseFeePerGas;

        await this._updateState(chainId, { baseFeePerGas });
    }

    /**
     * Returns an object including the three levels of non-EIP1559 gas prices
     */
    public async getGasPriceLevels(
        fallbackGasPrices?: GasPriceLevels
    ): Promise<GasPriceLevels> {
        const gasPrice = await this._networkController
            .getProvider()
            .getGasPrice();

        if (gasPrice || !fallbackGasPrices) {
            return {
                slow: { gasPrice: gasPrice.mul(85).div(100) },
                average: { gasPrice: gasPrice },
                fast: { gasPrice: gasPrice.mul(125).div(100) },
            };
        } else {
            return fallbackGasPrices;
        }
    }

    /**
     * Returns an object including the three levels of gas prices
     */
    public async getEIP1599GasPriceLevels(
        fallbackGasPrices: GasPriceLevels
    ): Promise<GasPriceLevels> {
        try {
            const rewardsSlow: BigNumber[] = [];
            const rewardsAverage: BigNumber[] = [];
            const rewardsFast: BigNumber[] = [];

            // gets 1%, 10% and 25% percentile fee history of txs included in last 5 blocks
            const feeHistory: FeeHistory = await this._networkController
                .getProvider()
                .send('eth_feeHistory', ['0x5', 'latest', [1, 10, 25]]);

            const chainId = this._networkController.network.chainId;

            // last element in array is latest block
            const baseFeePerGas = BigNumber.from(
                feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1]
            );

            this._updateState(chainId, { baseFeePerGas });

            // add all rewards to rewards array
            for (let i = 0; i < feeHistory.reward!.length; i++) {
                rewardsSlow.push(BigNumber.from(feeHistory.reward![i][0]));
                rewardsAverage.push(BigNumber.from(feeHistory.reward![i][1]));
                rewardsFast.push(BigNumber.from(feeHistory.reward![i][2]));
            }

            // sort rewards array lowest to highest
            rewardsSlow.sort();
            rewardsAverage.sort();
            rewardsFast.sort();

            // choose middle tip as suggested tip
            const suggestedTipSlow =
                rewardsSlow[Math.floor(rewardsSlow.length / 2)];
            const suggestedTipAverage =
                rewardsAverage[Math.floor(rewardsAverage.length / 2)];
            const suggestedTipFast =
                rewardsFast[Math.floor(rewardsFast.length / 2)];

            const maxFeesPerGas = await this.getMaxFeePerGas({
                slow: suggestedTipSlow,
                average: suggestedTipAverage,
                fast: suggestedTipFast,
            });

            return {
                slow: {
                    maxPriorityFeePerGas: suggestedTipSlow,
                    maxFeePerGas: maxFeesPerGas.slow,
                },
                average: {
                    maxPriorityFeePerGas: suggestedTipAverage,
                    maxFeePerGas: maxFeesPerGas.average,
                },
                fast: {
                    maxPriorityFeePerGas: suggestedTipFast,
                    maxFeePerGas: maxFeesPerGas.fast,
                },
            };
        } catch (e) {
            log.error(e);
            return fallbackGasPrices;
        }
    }

    /**
     * Detects if the network is compatible with EIP1559 but the
     * the transaction is legacy and then Transforms the gas configuration
     * of the legacy transaction to the EIP1559 fee data.
     *
     * @param {TransactionMeta} transactionMeta - The transactionMeta object
     * @returns {Promise<TransactionMeta>} Resolves with transactionMeta
     */
    public async transformLegacyGasPriceToEIP1559FeeData(
        transactionMeta: TransactionMeta
    ): Promise<TransactionMeta> {
        // Already EIP1559
        if (
            getTransactionType(transactionMeta.transactionParams) ==
            TransactionType.FEE_MARKET_EIP1559
        ) {
            return transactionMeta;
        }

        // Network not compatible with EIP1559.
        // The transaction must use `gasPrice`.
        if (!(await this.getEIP1559Compatibility())) {
            return transactionMeta;
        }

        // Legacy transaction support: https://hackmd.io/@q8X_WM2nTfu6nuvAzqXiTQ/1559-wallets#Legacy-Transaction-Support
        transactionMeta.transactionParams.maxPriorityFeePerGas =
            transactionMeta.transactionParams.gasPrice;
        transactionMeta.transactionParams.maxFeePerGas =
            transactionMeta.transactionParams.gasPrice;
        transactionMeta.transactionParams.gasPrice = undefined;

        return transactionMeta;
    }

    /**
     * Adds the gas limit default to the specified transaction meta
     * @param {TransactionMeta} transactionMeta - The transactionMeta object
     * @returns {Promise<TransactionMeta>} Resolves with transactionMeta
     */
    public async addTransactionGasPriceDefault(
        transactionMeta: TransactionMeta
    ): Promise<TransactionMeta> {
        const defaultGasPrice = await this.getDefaultGasPrice(transactionMeta);

        if (defaultGasPrice) {
            transactionMeta.transactionParams.gasPrice = defaultGasPrice;
        }

        return transactionMeta;
    }

    /**
     * Adds the max fee per gas default to the specified transaction meta
     * @param {TransactionMeta} transactionMeta - The transactionMeta object
     * @returns {Promise<TransactionMeta>} Resolves with transactionMeta
     */
    public async addTransactionMaxFeePerGasDefault(
        transactionMeta: TransactionMeta
    ): Promise<TransactionMeta> {
        const defaultMaxFeePerGas = await this.getDefaultMaxFeePerGas(
            transactionMeta
        );

        if (defaultMaxFeePerGas) {
            transactionMeta.transactionParams.maxFeePerGas = defaultMaxFeePerGas;
        }

        return transactionMeta;
    }

    /**
     * Adds the max priority fee per gas default to the specified transaction meta
     * @param {TransactionMeta} transactionMeta - The transactionMeta object
     * @returns {Promise<TransactionMeta>} Resolves with transactionMeta
     */
    public async addTransactionMaxPriorityFeePerGasDefault(
        transactionMeta: TransactionMeta
    ): Promise<TransactionMeta> {
        const defaultMaxPriorityFeePerGas = await this.getDefaultMaxPriorityFeePerGas(
            transactionMeta
        );

        if (defaultMaxPriorityFeePerGas) {
            transactionMeta.transactionParams.maxPriorityFeePerGas = defaultMaxPriorityFeePerGas;
        }

        return transactionMeta;
    }

    public async getMaxFeePerGas(suggestedTip: {
        slow: BigNumber;
        average: BigNumber;
        fast: BigNumber;
    }): Promise<{
        slow: BigNumber;
        average: BigNumber;
        fast: BigNumber;
    }> {
        const currentBaseFeePerGas = BigNumber.from(
            this._getState().baseFeePerGas || (await this.getBaseFeePerGas())
        );

        const slowBaseFeePerGas = currentBaseFeePerGas.mul(90).div(100);
        const mediumBaseFeePerGas = currentBaseFeePerGas.mul(110).div(100);
        const fastBaseFeePerGas = currentBaseFeePerGas.mul(130).div(100);

        return {
            slow: BigNumber.from(suggestedTip.slow).add(slowBaseFeePerGas),
            average: BigNumber.from(suggestedTip.average).add(
                mediumBaseFeePerGas
            ),
            fast: BigNumber.from(suggestedTip.fast).add(fastBaseFeePerGas),
        };
    }

    /**
     * Get default max fee per gas, returns `undefined` if it is already set
     * @param {TransactionMeta} transactionMeta - The transactionMeta object
     * @returns {Promise<BigNumber|undefined>} The default max fee per gas
     */
    public async getDefaultMaxFeePerGas(
        transactionMeta: TransactionMeta
    ): Promise<BigNumber | undefined> {
        if (transactionMeta.transactionParams.maxFeePerGas) {
            return undefined;
        }

        if (!(await this.getEIP1559Compatibility())) {
            return undefined;
        }

        return (await this.getFeeData()).maxFeePerGas;
    }

    /**
     * Get default max prioriry fee per gas, returns `undefined` if it is already set
     * @param {TransactionMeta} transactionMeta - The transactionMeta object
     * @returns {Promise<BigNumber|undefined>} The default max prioriry fee per gas
     */
    public async getDefaultMaxPriorityFeePerGas(
        transactionMeta: TransactionMeta
    ): Promise<BigNumber | undefined> {
        if (transactionMeta.transactionParams.maxPriorityFeePerGas) {
            return undefined;
        }

        if (!(await this.getEIP1559Compatibility())) {
            return undefined;
        }

        return (await this.getFeeData()).maxPriorityFeePerGas;
    }

    /**
     * Get default gas price, returns `undefined` if gas price is already set
     * @param {TransactionMeta} transactionMeta - The transactionMeta object
     * @returns {Promise<BigNumber|undefined>} The default gas price
     */
    public async getDefaultGasPrice(
        transactionMeta: TransactionMeta
    ): Promise<BigNumber | undefined> {
        if (transactionMeta.transactionParams.gasPrice) {
            return undefined;
        }

        if (await this.getEIP1559Compatibility()) {
            return undefined;
        }

        return this.getGasPrice();
    }

    /**
     * Get base fee per gas
     */
    public async getBaseFeePerGas(): Promise<BigNumber> {
        return (await this._networkController.getLatestBlock()).baseFeePerGas!;
    }

    /**
     * Get latest fee data
     */
    public async getFeeData(): Promise<FeeData> {
        const feeData = await this._networkController
            .getProvider()
            .getFeeData();

        return {
            ...feeData,
        } as FeeData;
    }

    /**
     * Get latest gas price
     */
    public async getGasPrice(): Promise<BigNumber> {
        return this._networkController.getProvider().getGasPrice();
    }
}
