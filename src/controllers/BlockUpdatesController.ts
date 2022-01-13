import { Mutex } from 'async-mutex';
import log from 'loglevel';
import { BaseController } from '../infrastructure/BaseController';
import { AccountTrackerController } from './AccountTrackerController';
import BlockFetchController from './BlockFetchController';
import { ExchangeRatesController } from './ExchangeRatesController';
import { GasPricesController } from './GasPricesController';
import { IncomingTransactionController } from './IncomingTransactionController';
import NetworkController, { NetworkEvents } from './NetworkController';
import TransactionController from './transactions/TransactionController';

export interface BlockUpdatesControllerState {
    blockData: {
        [chainId: number]: { blockNumber: number; updateCounter: number };
    };
}

export enum BlockUpdatesEvents {
    SUBSCRIPTION_UPDATE = 'SUBSCRIPTION_UPDATE',
}

export default class BlockUpdatesController extends BaseController<BlockUpdatesControllerState> {
    private readonly _mutex: Mutex;

    private shouldQuery = false;
    private shouldQueryTransactions = false;

    constructor(
        private readonly _networkController: NetworkController,
        private readonly _accountTrackerController: AccountTrackerController,
        private readonly _gasPricesController: GasPricesController,
        private readonly _exchangeRatesController: ExchangeRatesController,
        private readonly _incomingTransactionController: IncomingTransactionController,
        private readonly _transactionController: TransactionController,
        private readonly _blockFetchController: BlockFetchController,
        initialState: BlockUpdatesControllerState
    ) {
        super(initialState);

        this._mutex = new Mutex();

        this.initBlockNumber(_networkController.network.chainId);

        _networkController.on(NetworkEvents.NETWORK_CHANGE, async () => {
            this.initBlockNumber(this._networkController.network.chainId);
            this.updateTransactionsSubscription();
        });

        /**
         * On transaction store update, update whether we should keep updating the
         * transactions
         */
        this._transactionController.UIStore.subscribe(
            this.updateTransactionsSubscription
        );
        this.updateTransactionsSubscription();

        /**
         * Set or remove the block listeners depending on whether the
         * extension is unlocked and have active subscriptions, or if there
         * is any transaction pending of confirmation.
         */
        this.on(BlockUpdatesEvents.SUBSCRIPTION_UPDATE, () => {
            if (this.shouldQuery || this.shouldQueryTransactions) {
                this._blockFetchController.addNewOnBlockListener(
                    this._networkController.network.chainId,
                    this._blockUpdates
                );
            } else {
                this._blockFetchController.removeAllOnBlockListener();
            }
        });
    }

    /**
     * Sets a default block number for the specified chainId
     *
     * @param chainId The chainId to init the block number from
     */
    private initBlockNumber = (chainId: number) => {
        const { blockData } = this.store.getState();
        if (!(chainId in blockData)) {
            this.store.setState({
                blockData: {
                    ...blockData,
                    [chainId]: { blockNumber: -1, updateCounter: 0 },
                },
            });
        } else {
            this.store.setState({
                blockData: {
                    ...blockData,
                    [chainId]: {
                        ...blockData[chainId],
                        updateCounter: 0,
                    },
                },
            });
        }
    };

    /**
     * updateTransactionsSubscription
     *
     * Checks whether we should keep updating the transactions
     * according to the current network transaction's verifiedOnBlockchain
     * status flag.
     */
    private updateTransactionsSubscription = () => {
        this.shouldQueryTransactions =
            this._transactionController.UIStore.getState().transactions.some(
                ({ verifiedOnBlockchain }) => !verifiedOnBlockchain
            );

        this.emit(BlockUpdatesEvents.SUBSCRIPTION_UPDATE);
    };

    /**
     * setBlockUpdatesStatus
     *
     * It sets whether rates, balances, prices and incoming transactions
     * should be fetched or not
     *
     * @param isUnlocked Whether the extension is unlocked or not
     * @param subscriptions The number of subscriptions to the background
     */
    public setBlockUpdatesStatus(
        isUnlocked: boolean,
        subscriptions: number
    ): void {
        this.shouldQuery = isUnlocked && subscriptions > 0;
        this.emit(BlockUpdatesEvents.SUBSCRIPTION_UPDATE);
    }

    /**
     * getBlockNumber
     *
     * @param chainId The chainId to get the block number from
     * @returns The most recently mined block number
     */
    public getBlockNumber(
        chainId: number = this._networkController.network.chainId
    ): number {
        const { blockData } = this.store.getState();
        if (!(chainId in blockData)) {
            return -1;
        }
        return blockData[chainId].blockNumber;
    }

    /**
     * _blockUpdates
     *
     * Triggered on each block update, it stores the latest block number
     * and triggers updates for different controllers if needed
     */
    private _blockUpdates = async (blockNumber: number): Promise<void> => {
        const releaseLock = await this._mutex.acquire();
        try {
            if (!this._networkController.isNetworkChanging) {
                const chainId = this._networkController.network.chainId;

                let { blockData } = this.store.getState();
                if (!(chainId in blockData)) {
                    // preventing race condition
                    this.initBlockNumber(chainId);
                    blockData = this.store.getState().blockData;
                }
                const currentBlock =
                    chainId in blockData ? blockData[chainId].blockNumber : -1;

                const assetsAutoDiscoveryInterval =
                    this._networkController.network
                        .assetsAutoDiscoveryInterval || 10;

                let updateCounter = blockData[chainId].updateCounter;

                const assetsAutoDiscovery =
                    updateCounter % assetsAutoDiscoveryInterval === 0;
                if (assetsAutoDiscovery) {
                    updateCounter = 0;
                }

                if (blockNumber != currentBlock) {
                    this.store.setState({
                        blockData: {
                            ...blockData,
                            [chainId]: {
                                blockNumber,
                                updateCounter: updateCounter + 1,
                            },
                        },
                    });

                    if (this.shouldQuery) {
                        this._accountTrackerController.updateAccounts({
                            // every N updates we fetch all the chain assets
                            assetsAutoDiscovery,
                        });
                        this._gasPricesController.updateGasPrices(
                            blockNumber,
                            chainId
                        );
                        this._exchangeRatesController.updateExchangeRates();
                        this._incomingTransactionController.updateIncomingTransactions();
                    }

                    if (this.shouldQueryTransactions) {
                        this._transactionController.update(blockNumber);
                    }
                }
            }
        } catch (error) {
            log.error(error);
        } finally {
            releaseLock();
        }
    };
}
