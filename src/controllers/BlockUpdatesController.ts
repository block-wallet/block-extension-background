import { Mutex } from 'async-mutex';
import log from 'loglevel';
import { BaseController } from '../infrastructure/BaseController';
import { AccountTrackerController } from './AccountTrackerController';
import { ExchangeRatesController } from './ExchangeRatesController';
import { GasPricesController } from './GasPricesController';
import { IncomingTransactionController } from './IncomingTransactionController';
import NetworkController, { NetworkEvents } from './NetworkController';
import TransactionController from './transactions/TransactionController';
import { TransactionStatus } from './transactions/utils/types';

export const BLOCK_UPDATES_INTERVAL = 15000;
export interface BlockUpdatesControllerState {
    blockData: { [chainId: number]: number };
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
        initialState: BlockUpdatesControllerState
    ) {
        super(initialState);

        this._mutex = new Mutex();

        // Set the ethers polling interval
        this._networkController.getProvider().pollingInterval =
            BLOCK_UPDATES_INTERVAL;

        this.initBlockNumber(_networkController.network.chainId);

        _networkController.on(NetworkEvents.NETWORK_CHANGE, async () => {
            this._networkController.getProvider().pollingInterval =
                BLOCK_UPDATES_INTERVAL;

            this.initBlockNumber(_networkController.network.chainId);
        });

        /**
         * On transaction store update, update whether we should keep updating the
         * transactions
         */
        this._transactionController.UIStore.subscribe(() => {
            const { length: pendingTransactions } =
                this._transactionController.store
                    .getState()
                    .transactions.filter(
                        ({ status }) => status === TransactionStatus.SUBMITTED
                    );

            this.shouldQueryTransactions = pendingTransactions > 0;
            this.emit(BlockUpdatesEvents.SUBSCRIPTION_UPDATE);
        });

        /**
         * Set or remove the block listeners depending on whether the
         * extension is unlocked and have active subscriptions, or if there
         * is any transaction pending of confirmation.
         */
        this.on(BlockUpdatesEvents.SUBSCRIPTION_UPDATE, () => {
            if (this.shouldQuery || this.shouldQueryTransactions) {
                this._networkController.addOnBlockListener(this._blockUpdates);
            } else {
                this._networkController.removeAllOnBlockListener();
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
                    [chainId]: -1,
                },
            });
        }
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
        return blockData[chainId];
    }

    /**
     * _blockUpdates
     *
     * Triggered on each block update, it stores the latest block number
     * and triggers updates for different controllers if needed
     */
    private _blockUpdates = async (): Promise<void> => {
        const releaseLock = await this._mutex.acquire();
        try {
            if (!this._networkController.isNetworkChanging) {
                const {
                    blockNumber,
                    network: { chainId },
                } = this._networkController.getProvider();

                const { blockData } = this.store.getState();
                const currentBlock =
                    chainId in blockData ? blockData[chainId] : -1;

                if (blockNumber != currentBlock) {
                    this.store.setState({
                        blockData: {
                            ...blockData,
                            [chainId]: blockNumber,
                        },
                    });

                    if (this.shouldQuery) {
                        this._accountTrackerController.updateAccounts();
                        this._gasPricesController.updateGasPrices();
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
