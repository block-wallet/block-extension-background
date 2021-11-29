/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable no-case-declarations */
import { EventEmitter } from 'events';
import { BigNumber, constants } from 'ethers';
import { InfuraProvider, JsonRpcProvider } from '@ethersproject/providers';
import { Interface } from '@ethersproject/abi';
import log from 'loglevel';
import { addHexPrefix, bnToHex, bufferToHex } from 'ethereumjs-util';
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx';
import { v4 as uuid } from 'uuid';
import { Mutex } from 'async-mutex';
import {
    MetaType,
    TransactionCategories,
    TransactionEvents,
    TransactionMeta,
    TransactionParams,
    TransactionStatus,
    TransactionType,
} from './utils/types';
import NetworkController, { NetworkEvents } from '../NetworkController';
import { NonceTracker } from './NonceTracker';
import {
    compareAddresses,
    getTransactionType,
    isFeeMarketEIP1559Values,
    isGasPriceValue,
    normalizeTransaction,
    validateGasValues,
    validateMinimumIncrease,
    validateTransaction,
} from './utils/utils';
import { BnMultiplyByFraction } from '../../utils/bnUtils';
import { ProviderError } from '../../utils/types/ethereum';
import { runPromiseSafely } from '../../utils/promises';
import { PreferencesController } from '../PreferencesController';
import PermissionsController from '../PermissionsController';
import { GasPricesController } from '../GasPricesController';
import {
    ContractMethodSignature,
    SignatureRegistry,
} from './SignatureRegistry';
import erc20Abi from '../erc-20/abi';
import { DEFAULT_TORNADO_CONFIRMATION } from '../blank-deposit/tornado/TornadoService';
import { BaseController } from '../../infrastructure/BaseController';
import { showTransactionNotification } from '../../utils/notifications';

/**
 * @type Result
 * @property result - Promise resolving to a new transaction hash
 * @property transactionMeta - Meta information about this new transaction
 */
export interface Result {
    result: Promise<string>;
    transactionMeta: TransactionMeta;
}

export interface GasPriceValue {
    /**
     * Users set this. Added to transactions, represent the part of the tx fee that goes to the miner.
     */
    gasPrice: BigNumber;
}

export interface FeeMarketEIP1559Values {
    /**
     * Users set this. Represents the maximum amount that a user is willing to pay for
     * their tx (inclusive of baseFeePerGas and maxPriorityFeePerGas).
     * The difference between maxFeePerGas and baseFeePerGas + maxPriorityFeePerGas is “refunded” to the user.
     */
    maxFeePerGas: BigNumber;

    /**
     * 'Old' price for the gas in pre EIP1559 transactions
     */
    maxPriorityFeePerGas: BigNumber;
}

/**
 * @type TransactionConfig
 *
 * Transaction controller configuration
 * @property interval - Polling interval used to fetch new currency rate
 * @property sign - Method used to sign transactions
 */
export interface TransactionConfig {
    interval: number;
    sign?: (
        transaction: TransactionParams,
        from: string
    ) => Promise<TypedTransaction>;
    txHistoryLimit: number;
}

/**
 * @type TransactionState
 *
 * Transaction controller state
 * @property transactions - A list of TransactionMeta objects
 */
export interface TransactionControllerState {
    transactions: TransactionMeta[];
}

export interface TransactionVolatileControllerState {
    /**
     * Transactions filtered by current chain
     */
    transactions: TransactionMeta[];

    /**
     * Externally originated unapproved transactions to be used by provider related views
     */
    unapprovedTransactions: {
        [id: string]: TransactionMeta;
    };
}

/**
 * TransactionGasEstimation response
 */
export interface TransactionGasEstimation {
    /**
     * Estimated gas limit
     */
    gasLimit: BigNumber;

    /**
     * Whether the estimation succeded or not
     */
    estimationSucceeded: boolean;
}

/**
 * How many block updates to wait before considering a transaction dropped once the account
 * nonce is higher than the transaction's
 */
const BLOCK_UPDATES_BEFORE_DROP = 4;

/**
 * The gas cost of a send in hex (21000 in dec)
 */
export const SEND_GAS_COST = '0x5208';

/**
 * Multiplier used to determine a transaction's increased gas fee during cancellation
 */
export const CANCEL_RATE = {
    numerator: 3,
    denominator: 2,
};

/**
 * Multiplier used to determine a transaction's increased gas fee during speed up
 */
export const SPEED_UP_RATE = {
    numerator: 11,
    denominator: 10,
};

/**
 * The result of determine the transaction category
 */
interface TransactionCategoryResponse {
    transactionCategory: TransactionCategories;
    methodSignature?: ContractMethodSignature;
}

/**
 * Controller responsible for submitting and managing transactions
 */
export class TransactionController extends BaseController<
    TransactionControllerState,
    TransactionVolatileControllerState
> {
    private mutex = new Mutex();

    /**
     * EventEmitter instance used to listen to specific transactional events
     */
    hub = new EventEmitter();

    private readonly _signatureRegistry: SignatureRegistry;
    private readonly _nonceTracker: NonceTracker;
    private readonly _erc20Abi: Interface;

    /**
     * Creates a TransactionController instance.
     *
     * @param _networkController The network controller instance
     * @param initialState The transaction controller initial state
     * @param sign The transaction signing function
     * @param config.txHistoryLimit The transaction history limit
     */
    constructor(
        private readonly _networkController: NetworkController,
        private readonly _preferencesController: PreferencesController,
        private readonly _permissionsController: PermissionsController,
        private readonly _gasPricesController: GasPricesController,
        initialState: TransactionControllerState,
        /**
         * Method used to sign transactions
         */
        public sign: (
            transaction: TypedTransaction,
            from: string
        ) => Promise<TypedTransaction>,
        public config: {
            txHistoryLimit: number;
        } = {
            txHistoryLimit: 40,
        }
    ) {
        super(initialState);
        this._nonceTracker = new NonceTracker(
            _networkController,
            (address: string) => {
                const { chainId } = _networkController.network;
                return [...this.store.getState().transactions].filter(
                    (t) =>
                        t.status === TransactionStatus.CONFIRMED &&
                        t.chainId === chainId &&
                        compareAddresses(t.transactionParams.from, address)
                );
            },
            (address: string) => {
                const { chainId } = _networkController.network;
                return [...this.store.getState().transactions].filter(
                    (t) =>
                        t.status === TransactionStatus.SUBMITTED &&
                        t.chainId === chainId &&
                        compareAddresses(t.transactionParams.from, address)
                );
            }
        );

        // Instantiate signature registry service
        this._signatureRegistry = new SignatureRegistry(_networkController);

        // Instantiate the ERC20 interface to decode function names
        this._erc20Abi = new Interface(erc20Abi);

        // Clear unapproved & approved non-submitted transactions
        this.clearUnapprovedTransactions();
        this.wipeApprovedTransactions();

        // Add subscriptions
        this._networkController.on(NetworkEvents.NETWORK_CHANGE, () => {
            // Clear approved non-submitted transactions on network change
            this.checkForSignedTransactions();
            this.onStoreUpdate();
        });
        this.store.subscribe(this.onStoreUpdate);
        this.onStoreUpdate();

        // Emit controller event on STATUS_UPDATE
        this.hub.on(TransactionEvents.STATUS_UPDATE, (transactionMeta) => {
            this.emit(TransactionEvents.STATUS_UPDATE, transactionMeta);
        });

        // Show browser notification on transaction status update
        this.subscribeNotifications();
    }

    /**
     * onStoreUpdate
     *
     * Triggered when a new update to the store occurs
     */
    private onStoreUpdate = async (): Promise<void> => {
        const { chainId } = this._networkController.network;
        this.UIStore.updateState({
            transactions: this.store
                .getState()
                .transactions.filter((t) => t.chainId === chainId),
            unapprovedTransactions: this.getExternalUnapprovedTransactions(),
        });
    };

    /**
     * getExternalUnapprovedTransactions
     *
     * Returns a list of externally initiated unapproved transactions
     * @returns An object of unapproved transactions indexed by id
     */
    private getExternalUnapprovedTransactions = () => {
        const { chainId } = this._networkController.network;
        const { transactions } = this.store.getState();

        const unapprovedList = transactions.filter(
            (t) =>
                t.status === TransactionStatus.UNAPPROVED &&
                t.chainId === chainId
        );

        const externalUnapprovedList = unapprovedList.filter(
            (t) => t.origin !== 'blank'
        );

        return externalUnapprovedList.reduce((result, transaction) => {
            result[transaction.id] = transaction;
            return result;
        }, {} as { [key: string]: TransactionMeta });
    };

    private subscribeNotifications() {
        this.on(
            TransactionEvents.STATUS_UPDATE,
            (transactionMeta: TransactionMeta) => {
                if (
                    transactionMeta.status === TransactionStatus.CONFIRMED ||
                    transactionMeta.status === TransactionStatus.FAILED
                ) {
                    showTransactionNotification(transactionMeta);
                }
            }
        );
    }

    /**
     * Queries for transaction statuses
     *
     */
    public async update(currentBlockNumber: number): Promise<void> {
        await runPromiseSafely(
            this.queryTransactionStatuses(currentBlockNumber)
        );
    }

    /**
     * Fails a transaction and updates its status in the state
     *
     * @param transactionMeta - The transaction meta object
     * @param error The error to attach to the failed transaction
     */
    private failTransaction(
        transactionMeta: TransactionMeta,
        error: Error,
        dropped = false
    ) {
        const newTransactionMeta = {
            ...transactionMeta,
            error,
            status: !dropped
                ? TransactionStatus.FAILED
                : TransactionStatus.DROPPED,
        };
        if (this.checkCancel(transactionMeta)) {
            newTransactionMeta.status = TransactionStatus.CANCELLED;
        }
        this.updateTransaction(newTransactionMeta);
        this.hub.emit(`${transactionMeta.id}:finished`, newTransactionMeta);
    }

    /**
     * Add a new unapproved transaction to state. Parameters will be validated, a
     * unique transaction id will be generated, and gas and gasPrice will be calculated
     * if not provided.
     *
     * @param transaction - The transaction object to add.
     * @param origin - The domain origin to append to the generated TransactionMeta.
     * @param waitForConfirmation - Whether to wait for the transaction to be confirmed.
     * @returns Object containing a promise resolving to the transaction hash if approved.
     */
    public async addTransaction(
        transaction: TransactionParams,
        origin: string,
        waitForConfirmation = false
    ): Promise<Result> {
        const { chainId } = this._networkController.network;
        const { transactions } = this.store.getState();

        transaction.chainId = chainId;
        transaction = normalizeTransaction(transaction);
        validateTransaction(transaction);

        if (origin === 'blank') {
            // Check if the selected
            const selectedAccount = this._preferencesController
                .getSelectedAddress()
                .toLowerCase();
            if (transaction.from !== selectedAccount) {
                throw new Error(
                    'Internally initiated transaction is using invalid account.'
                );
            }
        } else {
            if (!transaction.from) {
                throw new Error(
                    'Externally initiated transaction has undefined "from" parameter.'
                );
            }

            const hasPermission = this._permissionsController.accountHasPermissions(
                origin,
                transaction.from
            );

            if (!hasPermission) {
                throw new Error(
                    `Externally initiated transaction has no permission to make transaction with account ${transaction.from}.`
                );
            }
        }

        // Determine transaction category and method signature
        const {
            transactionCategory,
            methodSignature,
        } = await this.determineTransactionCategory(transaction);

        let transactionMeta: TransactionMeta = {
            id: uuid(),
            chainId,
            origin,
            status: TransactionStatus.UNAPPROVED,
            time: Date.now(),
            transactionCategory: transactionCategory,
            methodSignature: methodSignature,
            transactionParams: transaction,
            verifiedOnBlockchain: false,
            loadingGasValues: true,
            blocksDropCount: 0,
        };

        try {
            // Estimate gas
            const { gasLimit, estimationSucceeded } = await this.estimateGas(
                transactionMeta
            );
            transactionMeta.transactionParams.gasLimit = gasLimit;
            transactionMeta.gasEstimationFailed = !estimationSucceeded;

            // Get default gas prices values
            transactionMeta = await this.getGasPricesValues(transactionMeta);

            transactionMeta.loadingGasValues = false;
        } catch (error) {
            this.failTransaction(transactionMeta, error);
            return Promise.reject(error);
        }

        const result: Promise<string> = this.waitForTransactionResult(
            transactionMeta.id,
            waitForConfirmation
        );

        transactions.push(transactionMeta);
        this.store.updateState({
            transactions: this.trimTransactionsForState(transactions),
        });

        return { result, transactionMeta };
    }

    private async getGasPricesValues(transactionMeta: TransactionMeta) {
        transactionMeta = await this._gasPricesController.addTransactionGasPriceDefault(
            transactionMeta
        );

        transactionMeta = await this._gasPricesController.addTransactionMaxFeePerGasDefault(
            transactionMeta
        );

        transactionMeta = await this._gasPricesController.addTransactionMaxPriorityFeePerGasDefault(
            transactionMeta
        );

        transactionMeta = await this._gasPricesController.transformLegacyGasPriceToEIP1559FeeData(
            transactionMeta
        );
        return transactionMeta;
    }

    public waitForTransactionResult(
        transactionMetaId: string,
        waitForConfirmation = false
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            this.hub.once(
                `${transactionMetaId}:${
                    !waitForConfirmation ? 'finished' : 'confirmed'
                }`,
                (meta: TransactionMeta) => {
                    switch (meta.status) {
                        case !waitForConfirmation
                            ? TransactionStatus.SUBMITTED
                            : TransactionStatus.CONFIRMED:
                            return resolve(
                                meta.transactionParams.hash as string
                            );
                        case TransactionStatus.REJECTED:
                            return reject(
                                new Error(ProviderError.TRANSACTION_REJECTED)
                            );
                        case TransactionStatus.CANCELLED:
                            return reject(
                                new Error('User cancelled the transaction')
                            );
                        case TransactionStatus.FAILED:
                            return reject(new Error(meta.error!.message));
                        default:
                            return reject(
                                new Error(
                                    `Transaction Signature: Unknown problem: ${JSON.stringify(
                                        meta.transactionParams
                                    )}`
                                )
                            );
                    }
                }
            );
        });
    }

    public async prepareUnsignedEthTransaction(
        transactionParams: TransactionParams
    ): Promise<TypedTransaction> {
        const common = await this._networkController.getCommon();
        return TransactionFactory.fromTxData(
            {
                type: transactionParams.type as number,
                data: transactionParams.data,
                gasLimit: transactionParams.gasLimit?.toHexString(),
                gasPrice: transactionParams.gasPrice?.toHexString(),
                maxFeePerGas: transactionParams.maxFeePerGas?.toHexString(),
                maxPriorityFeePerGas: transactionParams.maxPriorityFeePerGas?.toHexString(),
                nonce: transactionParams.nonce,
                value: transactionParams.value?.toHexString(),
                to: transactionParams.to,
            },
            { common }
        );
    }

    /**
     * Approves a transaction and updates it's status in state. If this is not a
     * retry transaction, a nonce will be generated. The transaction is signed
     * using the sign configuration property, then published to the blockchain.
     * A `<tx.id>:finished` hub event is fired after success or failure.
     *
     * @param transactionID - The ID of the transaction to approve.
     */
    public async approveTransaction(transactionID: string): Promise<void> {
        const releaseLock = await this.mutex.acquire();
        const { chainId } = this._networkController.network;
        const provider = this._networkController.getProvider();
        let transactionMeta = this.getTransaction(transactionID);

        if (!transactionMeta) {
            throw new Error('The specified transaction does not exist');
        }

        transactionMeta = { ...transactionMeta };

        const { nonce } = transactionMeta.transactionParams;

        let nonceLock;
        try {
            const { from } = transactionMeta.transactionParams;

            const { APPROVED: status } = TransactionStatus;

            let txNonce = nonce;
            if (!txNonce) {
                // Get new nonce
                nonceLock = await this._nonceTracker.getNonceLock(from!);
                txNonce = nonceLock.nextNonce;
            }

            transactionMeta.status = status;
            transactionMeta.transactionParams.nonce = txNonce;
            transactionMeta.transactionParams.chainId = chainId;

            const type = getTransactionType(transactionMeta.transactionParams);
            transactionMeta.transactionParams.type = type;

            const baseTxParams = {
                ...transactionMeta.transactionParams,
                chainId,
                nonce: txNonce,
                status,
                type,
            };

            const isEIP1559 = type === TransactionType.FEE_MARKET_EIP1559;

            const txParams = isEIP1559
                ? {
                      ...baseTxParams,
                      maxFeePerGas:
                          transactionMeta.transactionParams.maxFeePerGas,
                      maxPriorityFeePerGas:
                          transactionMeta.transactionParams
                              .maxPriorityFeePerGas,
                  }
                : baseTxParams;

            // delete gasPrice if maxFeePerGas and maxPriorityFeePerGas are set
            if (isEIP1559) {
                delete txParams.gasPrice;
            }

            // Update transaction
            this.updateTransaction(transactionMeta);

            // Sign transaction
            const signedTx = await this.signTransaction(txParams, from!);

            // Set status to signed
            transactionMeta.status = TransactionStatus.SIGNED;

            // Set r,s,v values
            transactionMeta.transactionParams.r = bnToHex(signedTx.r!);
            transactionMeta.transactionParams.s = bnToHex(signedTx.s!);
            transactionMeta.transactionParams.v = BigNumber.from(
                bnToHex(signedTx.v!)
            ).toNumber();

            // Serialize transaction & update
            const rawTransaction = bufferToHex(signedTx.serialize());
            transactionMeta.rawTransaction = rawTransaction;

            // Update transaction
            this.updateTransaction(transactionMeta);

            // Send transaction
            await this.submitTransaction(provider, transactionMeta);
        } catch (error) {
            this.failTransaction(transactionMeta, error);
            throw error;
        } finally {
            // Release nonce lock
            if (nonceLock) {
                nonceLock.releaseLock();
            }

            // Release approve lock
            releaseLock();
        }
    }

    /**
     * Sends the specifed transaction to the network
     *
     * @param provider The provider to use
     * @param transactionMeta The transaction to submit
     */
    private async submitTransaction(
        provider: InfuraProvider | JsonRpcProvider,
        transactionMeta: TransactionMeta,
        forceSubmitted = false
    ) {
        let transactionHash: string;

        try {
            const { hash } = await provider.sendTransaction(
                transactionMeta.rawTransaction!
            );
            transactionHash = hash;
        } catch (error) {
            if (!forceSubmitted) {
                // If the transaction is known, get the transaction hash from the error object and continue with the normal flow
                // https://github.com/ethers-io/ethers.js/blob/v5.5.1/packages/providers/src.ts/base-provider.ts#L1337
                if (error.message.toLowerCase().includes('known transaction')) {
                    transactionHash = error.transactionHash;
                } else {
                    throw error;
                }
            } else {
                transactionHash = error.transactionHash;
            }
        }

        // Store hash, mark as SUBMITTED and update
        transactionMeta.transactionParams.hash = transactionHash;
        transactionMeta.status = TransactionStatus.SUBMITTED;
        transactionMeta.submittedTime = Date.now();

        this.updateTransaction(transactionMeta);

        // Emit finish event
        this.hub.emit(`${transactionMeta.id}:finished`, transactionMeta);
    }

    /**
     * It signs the specified transaction storing the transaction type
     * and the r,s,v values if signing succeded or throwing an error otherwise.
     *
     * @param transactionMeta The transaction to sign
     * @param txParams
     * @returns
     */
    private async signTransaction(
        txParams: TransactionParams,
        from: string
    ): Promise<TypedTransaction> {
        const unsignedEthTx = await this.prepareUnsignedEthTransaction(
            txParams
        );
        const signedTx = await this.sign(unsignedEthTx, from);

        // Add r,s,v values
        if (!signedTx.r || !signedTx.s || !signedTx.v)
            throw new Error('An error while signing the transaction ocurred');

        return signedTx;
    }

    /**
     * Rejects a transaction based on its ID by setting its status to "rejected"
     * and emitting a `<tx.id>:finished` hub event.
     *
     * @param transactionID - The ID of the transaction to cancel.
     */
    public rejectTransaction(transactionID: string): void {
        const transactionMeta = this.getTransaction(transactionID);
        if (!transactionMeta) {
            throw new Error('The specified transaction does not exist');
        }
        transactionMeta.status = TransactionStatus.REJECTED;
        this.hub.emit(`${transactionMeta.id}:finished`, transactionMeta);
        const transactions = this.store
            .getState()
            .transactions.filter(({ id }) => id !== transactionID);
        this.store.updateState({
            transactions: this.trimTransactionsForState(transactions),
        });
    }

    /**
     * It clears the unapproved transactions from the transactions list
     */
    public clearUnapprovedTransactions(): void {
        const nonUnapprovedTransactions = this.store
            .getState()
            .transactions.filter(
                (transaction) =>
                    transaction.status !== TransactionStatus.UNAPPROVED
            );

        this.store.updateState({
            transactions: this.trimTransactionsForState(
                nonUnapprovedTransactions
            ),
        });
    }

    /**
     * Attempts to cancel a transaction submitting a new self transaction with the same nonce and Zero value
     *
     * @param transactionID - The ID of the transaction to cancel.
     * @param gasValues - The gas values to use for the cancellation transation.
     */
    public async cancelTransaction(
        transactionID: string,
        gasValues?: GasPriceValue | FeeMarketEIP1559Values
    ): Promise<void> {
        const provider = this._networkController.getProvider();

        const { transactions } = this.store.getState();

        if (gasValues) {
            validateGasValues(gasValues);
        }
        const transactionMeta = this.getTransaction(transactionID);
        if (!transactionMeta) {
            throw new Error('The specified transaction does not exist');
        }

        // Get transaction type
        const type = getTransactionType(transactionMeta.transactionParams);

        let txParams = {} as TransactionParams;

        if (type !== TransactionType.FEE_MARKET_EIP1559) {
            // gasPrice (legacy non EIP1559)
            const minGasPrice = BnMultiplyByFraction(
                transactionMeta.transactionParams.gasPrice!,
                CANCEL_RATE.numerator,
                CANCEL_RATE.denominator
            );

            const gasPriceFromValues =
                isGasPriceValue(gasValues) && gasValues.gasPrice;

            const newGasPrice =
                (gasPriceFromValues &&
                    validateMinimumIncrease(gasPriceFromValues, minGasPrice)) ||
                minGasPrice;

            txParams = {
                from: transactionMeta.transactionParams.from,
                gasLimit: transactionMeta.transactionParams.gasLimit,
                gasPrice: newGasPrice,
                type,
                nonce: transactionMeta.transactionParams.nonce,
                to: transactionMeta.transactionParams.from,
                value: constants.Zero,
            };
        } else {
            // maxFeePerGas (EIP1559)
            const existingMaxFeePerGas = transactionMeta.transactionParams
                .maxFeePerGas!;
            const minMaxFeePerGas = BnMultiplyByFraction(
                existingMaxFeePerGas,
                CANCEL_RATE.numerator,
                CANCEL_RATE.denominator
            );

            const maxFeePerGasValues =
                isFeeMarketEIP1559Values(gasValues) && gasValues.maxFeePerGas;

            const newMaxFeePerGas =
                (maxFeePerGasValues &&
                    validateMinimumIncrease(
                        maxFeePerGasValues,
                        minMaxFeePerGas
                    )) ||
                minMaxFeePerGas;

            // maxPriorityFeePerGas (EIP1559)
            const existingMaxPriorityFeePerGas = transactionMeta
                .transactionParams.maxPriorityFeePerGas!;
            const minMaxPriorityFeePerGas = BnMultiplyByFraction(
                existingMaxPriorityFeePerGas,
                CANCEL_RATE.numerator,
                CANCEL_RATE.denominator
            );
            const maxPriorityFeePerGasValues =
                isFeeMarketEIP1559Values(gasValues) &&
                gasValues.maxPriorityFeePerGas;
            const newMaxPriorityFeePerGas =
                (maxPriorityFeePerGasValues &&
                    validateMinimumIncrease(
                        maxPriorityFeePerGasValues,
                        minMaxPriorityFeePerGas
                    )) ||
                minMaxPriorityFeePerGas;

            txParams = {
                from: transactionMeta.transactionParams.from,
                gasLimit: transactionMeta.transactionParams.gasLimit,
                maxFeePerGas: newMaxFeePerGas,
                maxPriorityFeePerGas: newMaxPriorityFeePerGas,
                type,
                nonce: transactionMeta.transactionParams.nonce,
                to: transactionMeta.transactionParams.from,
                value: constants.Zero,
            };
        }

        // Sign transaction
        const signedTx = await this.signTransaction(txParams, txParams.from!);

        const rawTransaction = bufferToHex(signedTx.serialize());
        const { hash } = await provider.sendTransaction(rawTransaction);

        // Add cancellation transaction with new gas data and status
        const baseTransactionMeta: TransactionMeta = {
            ...transactionMeta,
            id: uuid(),
            time: Date.now(),
            submittedTime: Date.now(),
            blocksDropCount: 0,
        };
        const newTransactionMeta: TransactionMeta = {
            ...baseTransactionMeta,
            transactionParams: {
                ...txParams,
                hash,
                r: bnToHex(signedTx.r!),
                s: bnToHex(signedTx.s!),
                v: BigNumber.from(bnToHex(signedTx.v!)).toNumber(),
            },
            metaType: MetaType.CANCEL,
        };

        transactions.push(newTransactionMeta);
        this.store.updateState({
            transactions: this.trimTransactionsForState(transactions),
        });

        this.hub.emit(`${transactionMeta.id}:cancellation`, transactionMeta);
    }

    /**
     * Attemps to speed up a transaction increasing transaction gasPrice by ten percent.
     *
     * @param transactionID - The ID of the transaction to speed up.
     * @param gasValues - The gas values to use for the speed up transation.
     */
    public async speedUpTransaction(
        transactionID: string,
        gasValues?: GasPriceValue | FeeMarketEIP1559Values
    ): Promise<void> {
        const provider = this._networkController.getProvider();

        if (gasValues) {
            validateGasValues(gasValues);
        }
        const transactionMeta = this.getTransaction(transactionID);

        if (!transactionMeta) {
            throw new Error('The specified transaction does not exist');
        }

        const { transactions } = this.store.getState();

        const type = getTransactionType(transactionMeta.transactionParams);

        let txParams = {} as TransactionParams;
        if (type !== TransactionType.FEE_MARKET_EIP1559) {
            // gasPrice (legacy non EIP1559)
            const minGasPrice = BnMultiplyByFraction(
                transactionMeta.transactionParams.gasPrice!,
                SPEED_UP_RATE.numerator,
                SPEED_UP_RATE.denominator
            );

            const gasPriceFromValues =
                isGasPriceValue(gasValues) && gasValues.gasPrice;

            const newGasPrice =
                (gasPriceFromValues &&
                    validateMinimumIncrease(gasPriceFromValues, minGasPrice)) ||
                minGasPrice;

            txParams = {
                ...transactionMeta.transactionParams,
                gasPrice: newGasPrice,
            };
        } else {
            // maxFeePerGas (EIP1559)
            const existingMaxFeePerGas = transactionMeta.transactionParams
                .maxFeePerGas!;
            const minMaxFeePerGas = BnMultiplyByFraction(
                existingMaxFeePerGas,
                SPEED_UP_RATE.numerator,
                SPEED_UP_RATE.denominator
            );
            const maxFeePerGasValues =
                isFeeMarketEIP1559Values(gasValues) && gasValues.maxFeePerGas;
            const newMaxFeePerGas =
                (maxFeePerGasValues &&
                    validateMinimumIncrease(
                        maxFeePerGasValues,
                        minMaxFeePerGas
                    )) ||
                minMaxFeePerGas;

            // maxPriorityFeePerGas (EIP1559)
            const existingMaxPriorityFeePerGas = transactionMeta
                .transactionParams.maxPriorityFeePerGas!;
            const minMaxPriorityFeePerGas = BnMultiplyByFraction(
                existingMaxPriorityFeePerGas,
                SPEED_UP_RATE.numerator,
                SPEED_UP_RATE.denominator
            );
            const maxPriorityFeePerGasValues =
                isFeeMarketEIP1559Values(gasValues) &&
                gasValues.maxPriorityFeePerGas;
            const newMaxPriorityFeePerGas =
                (maxPriorityFeePerGasValues &&
                    validateMinimumIncrease(
                        maxPriorityFeePerGasValues,
                        minMaxPriorityFeePerGas
                    )) ||
                minMaxPriorityFeePerGas;

            txParams = {
                ...transactionMeta.transactionParams,
                maxFeePerGas: newMaxFeePerGas,
                maxPriorityFeePerGas: newMaxPriorityFeePerGas,
            };
        }

        // Sign transaction
        const signedTx = await this.signTransaction(
            txParams,
            transactionMeta.transactionParams.from!
        );

        const rawTransaction = bufferToHex(signedTx.serialize());
        const { hash } = await provider.sendTransaction(rawTransaction);
        const baseTransactionMeta: TransactionMeta = {
            ...transactionMeta,
            id: uuid(),
            time: Date.now(),
            submittedTime: Date.now(),
            blocksDropCount: 0,
        };
        const newTransactionMeta: TransactionMeta = {
            ...baseTransactionMeta,
            transactionParams: {
                ...txParams,
                hash,
                r: bnToHex(signedTx.r!),
                s: bnToHex(signedTx.s!),
                v: BigNumber.from(bnToHex(signedTx.v!)).toNumber(),
            },
            metaType: MetaType.SPEED_UP,
        };

        transactions.push(newTransactionMeta);
        this.store.updateState({
            transactions: this.trimTransactionsForState(transactions),
        });
        this.hub.emit(`${transactionMeta.id}:speedup`, newTransactionMeta);
    }

    /**
     * Check the status of submitted transactions on the network to determine whether they have
     * been included in a block. Any that have been included in a block are marked as confirmed.
     */
    public async queryTransactionStatuses(
        currentBlockNumber: number
    ): Promise<void> {
        const { transactions } = this.store.getState();
        const { chainId } = this._networkController.network;

        let gotUpdates = false;
        await runPromiseSafely(
            Promise.all(
                transactions.map(async (meta, index) => {
                    const txBelongsToCurrentChain = meta.chainId === chainId;

                    if (!meta.verifiedOnBlockchain && txBelongsToCurrentChain) {
                        const [
                            reconciledTx,
                            updateRequired,
                        ] = await this.blockchainTransactionStateReconciler(
                            meta,
                            currentBlockNumber
                        );
                        if (updateRequired) {
                            transactions[index] = reconciledTx;
                            gotUpdates = updateRequired;
                        }
                    }
                })
            )
        );

        if (gotUpdates) {
            this.store.updateState({
                transactions: this.trimTransactionsForState(transactions),
            });
        }
    }

    /**
     * Updates an existing transaction in state.
     *
     * @param transactionMeta - The new transaction to store in state.
     */
    public updateTransaction(transactionMeta: TransactionMeta): void {
        const { transactions } = this.store.getState();
        transactionMeta.transactionParams = normalizeTransaction(
            transactionMeta.transactionParams
        );
        validateTransaction(transactionMeta.transactionParams);
        const index = transactions.findIndex(
            ({ id }) => transactionMeta.id === id
        );

        // If we're failing on addTransaction, return
        if (index < 0) return;

        // Update transaction
        const { status: oldStatus } = transactions[index];
        transactions[index] = transactionMeta;
        this.store.updateState({
            transactions: this.trimTransactionsForState(transactions),
        });

        // Trigger status update
        if (oldStatus !== transactionMeta.status) {
            this.hub.emit(TransactionEvents.STATUS_UPDATE, transactionMeta);
        }
    }

    /**
     * Clear any possible APPROVED transactions in the state on init
     */
    private wipeApprovedTransactions(): void {
        const nonApprovedTransactions = this.store
            .getState()
            .transactions.filter(
                (t) => t.status !== TransactionStatus.APPROVED
            );

        this.store.updateState({
            transactions: this.trimTransactionsForState(
                nonApprovedTransactions
            ),
        });
    }

    /**
     * Checks on init & network change if there is still SIGNED transactions in the state
     * and whether they were actually submitted to update their status, failing them otherwise
     */
    private checkForSignedTransactions(): void {
        const provider = this._networkController.getProvider();
        const { chainId } = this._networkController.network;
        this.store
            .getState()
            .transactions.filter(
                (t) =>
                    t.status === TransactionStatus.SIGNED &&
                    t.chainId === chainId
            )
            .forEach((signedTx) => {
                this.submitTransaction(provider, signedTx, true);
            });
    }

    /**
     * Removes all transactions from state, optionally based on the current network.
     *
     * @param ignoreNetwork - Determines whether to wipe all transactions, or just those on the
     * current network. If `true`, all transactions are wiped.
     */
    public wipeTransactions(ignoreNetwork?: boolean): void {
        if (ignoreNetwork) {
            this.store.updateState({ transactions: [] });
            return;
        }

        const { chainId: currentChainId } = this._networkController.network;
        const newTransactions = this.store
            .getState()
            .transactions.filter(({ chainId }) => {
                const isCurrentNetwork = chainId === currentChainId;
                return !isCurrentNetwork;
            });

        this.store.updateState({
            transactions: this.trimTransactionsForState(newTransactions),
        });
    }

    /**
     * Trim the amount of transactions that are set on the state. Checks
     * if the length of the tx history is longer then desired persistence
     * limit and then if it is removes the oldest confirmed or rejected tx.
     * Pending or unapproved transactions will not be removed by this
     * operation. For safety of presenting a fully functional transaction UI
     * representation, this function will not break apart transactions with the
     * same nonce, created on the same day, per network. Not accounting for transactions of the same
     * nonce, same day and network combo can result in confusing or broken experiences
     * in the UI. The transactions are then updated using the BaseController store update.
     *
     * @param transactions - The transactions to be applied to the state.
     * @returns The trimmed list of transactions.
     */
    private trimTransactionsForState(
        transactions: TransactionMeta[]
    ): TransactionMeta[] {
        const nonceNetworkSet = new Set();
        const txsToKeep = transactions.reverse().filter((tx) => {
            const { chainId, status, transactionParams, time } = tx;
            if (transactionParams) {
                const key = `${transactionParams.nonce}-${chainId}-${new Date(
                    time
                ).toDateString()}`;
                if (nonceNetworkSet.has(key)) {
                    return true;
                } else if (
                    nonceNetworkSet.size < this.config.txHistoryLimit ||
                    !this.isFinalState(status)
                ) {
                    nonceNetworkSet.add(key);
                    return true;
                }
            }
            return false;
        });
        txsToKeep.reverse();
        return txsToKeep;
    }

    /**
     * Checks whether this transaction has been cancelled or speeded up
     */
    private checkCancel(transaction: TransactionMeta): boolean {
        const { transactions } = this.store.getState();
        return !!transactions.find(
            (t) =>
                t.transactionParams.nonce ===
                    transaction.transactionParams.nonce &&
                compareAddresses(
                    t.transactionParams.from,
                    transaction.transactionParams.from
                ) &&
                t.metaType === MetaType.CANCEL
        );
    }

    /**
     * Determines if the transaction is in a final state.
     *
     * @param status - The transaction status.
     * @returns Whether the transaction is in a final state.
     */
    private isFinalState(status: TransactionStatus): boolean {
        return (
            status === TransactionStatus.REJECTED ||
            status === TransactionStatus.CONFIRMED ||
            status === TransactionStatus.FAILED ||
            status === TransactionStatus.CANCELLED ||
            status === TransactionStatus.DROPPED
        );
    }

    /**
     * Method to verify the state of a transaction using the Blockchain as a source of truth.
     *
     * @param meta - The local transaction to verify on the blockchain.
     * @returns A tuple containing the updated transaction, and whether or not an update was required.
     */
    private async blockchainTransactionStateReconciler(
        meta: TransactionMeta,
        currentBlockNumber: number
    ): Promise<[TransactionMeta, boolean]> {
        const { status } = meta;
        const { hash: transactionHash } = meta.transactionParams;
        const provider = this._networkController.getProvider();

        switch (status) {
            case TransactionStatus.CONFIRMED:
                const txReceipt = await provider.getTransactionReceipt(
                    transactionHash!
                );

                if (!txReceipt) {
                    return [meta, false];
                }

                meta.verifiedOnBlockchain = true;
                meta.transactionReceipt = txReceipt;

                // According to the Web3 docs:
                // TRUE if the transaction was successful, FALSE if the EVM reverted the transaction.
                if (Number(txReceipt.status) === 0) {
                    const error: Error = new Error(
                        'Transaction failed. The transaction was reversed'
                    );

                    this.failTransaction(meta, error);
                    return [meta, false];
                }

                // Transaction was confirmed, check if this transaction
                // replaced another one and transition it to failed
                const { transactions } = this.store.getState();
                [...transactions].forEach((t) => {
                    if (
                        t.transactionParams.nonce ===
                            meta.transactionParams.nonce &&
                        t.id !== meta.id &&
                        compareAddresses(
                            t.transactionParams.from,
                            meta.transactionParams.from
                        )
                    ) {
                        // If nonce is the same but id isn't, the transaction was replaced
                        this.failTransaction(
                            t,
                            new Error(
                                'Transaction failed. The transaction was dropped or replaced by a new one'
                            ),
                            true
                        );
                    }
                });

                return [meta, true];
            case TransactionStatus.SUBMITTED:
                const txObj = await provider.getTransaction(transactionHash!);

                if (!txObj) {
                    const receiptShowsFailedStatus = await this.checkTxReceiptStatusIsFailed(
                        transactionHash,
                        provider
                    );

                    // Case the txObj is evaluated as false, a second check will
                    // determine if the tx failed or it is pending or confirmed
                    if (receiptShowsFailedStatus) {
                        const error: Error = new Error(
                            'Transaction failed. The transaction was dropped or replaced by a new one'
                        );

                        this.failTransaction(meta, error, true);
                        return [meta, false];
                    }
                }

                if (txObj?.blockNumber) {
                    // If transaction is a Blank deposit, wait for the N confirmations required
                    if (meta.blankDepositId) {
                        if (
                            currentBlockNumber - txObj.blockNumber! <
                            DEFAULT_TORNADO_CONFIRMATION
                        ) {
                            return [meta, false];
                        }
                    }

                    meta.status = TransactionStatus.CONFIRMED;
                    meta.confirmationTime =
                        txObj.timestamp && txObj.timestamp * 1000; // Unix timestamp to Java Script timestamp

                    this.emit(TransactionEvents.STATUS_UPDATE, meta);
                    this.hub.emit(`${meta.id}:confirmed`, meta);
                    return [meta, true];
                }

                // Double check if transaction was dropped and receipt keeps returning null
                const networkNonce = await this._nonceTracker.getNetworkNonce(
                    meta.transactionParams.from!
                );

                if (meta.transactionParams.nonce! >= networkNonce) {
                    return [meta, false];
                }

                if (meta.blocksDropCount < BLOCK_UPDATES_BEFORE_DROP) {
                    meta.blocksDropCount += 1;
                    return [meta, false];
                } else {
                    const error: Error = new Error(
                        'Transaction failed. The transaction was dropped or replaced by a new one'
                    );
                    this.failTransaction(meta, error, true);
                    return [meta, false];
                }
            default:
                return [meta, false];
        }
    }

    /**
     * Gets a transaction from the transactions list
     *
     * @param {number} transactionId
     */
    public getTransaction(transactionId: string): TransactionMeta | undefined {
        return this.store
            .getState()
            .transactions.find((t) => t.id === transactionId);
    }

    /**
     * Method to check if a tx has failed according to their receipt
     * According to the Web3 docs:
     * TRUE if the transaction was successful, FALSE if the EVM reverted the transaction.
     * The receipt is not available for pending transactions and returns null.
     *
     * @param txHash - The transaction hash.
     * @returns Whether the transaction has failed.
     */
    private async checkTxReceiptStatusIsFailed(
        txHash: string | undefined,
        provider: InfuraProvider | JsonRpcProvider
    ): Promise<boolean> {
        const txReceipt = await provider.getTransactionReceipt(txHash!);
        if (!txReceipt) {
            // Transaction is pending
            return false;
        }
        return Number(txReceipt.status) === 0;
    }

    /**
     * Estimates required gas for a given transaction.
     *
     * @param transaction - The transaction to estimate gas for.
     * @returns The gas and gas price.
     */
    public async estimateGas(
        transactionMeta: TransactionMeta,
        fallbackGasLimit?: BigNumber
    ): Promise<TransactionGasEstimation> {
        const estimatedTransaction = { ...transactionMeta.transactionParams };
        const {
            gasLimit: providedGasLimit,
            value,
            data,
        } = estimatedTransaction;

        const provider = this._networkController.getProvider();

        // 1. If gas is already defined on the transaction
        if (typeof providedGasLimit !== 'undefined') {
            return { gasLimit: providedGasLimit, estimationSucceeded: true };
        }

        const {
            gasLimit: blockGasLimit,
        } = await this._networkController.getLatestBlock();

        // 2. If to is not defined or this is not a contract address, and there is no data (i.e. the transaction is of type SENT_ETHER) use SEND_GAS_COST (0x5208 or 21000).
        // If the network is a custom network then bypass this check and fetch 'estimateGas'.

        if (typeof transactionMeta.transactionCategory === 'undefined') {
            // If estimateGas was called with no transaction category, determine it
            const {
                transactionCategory,
            } = await this.determineTransactionCategory(
                transactionMeta.transactionParams
            );
            transactionMeta.transactionCategory = transactionCategory;
        }

        // Check if it's a custom chainId
        const txOrCurrentChainId =
            transactionMeta.chainId ?? this._networkController.network.chainId;
        const isCustomNetwork = this._networkController.isChainIdCustomNetwork(
            txOrCurrentChainId
        );

        if (
            !isCustomNetwork &&
            transactionMeta.transactionCategory ===
                TransactionCategories.SENT_ETHER
        ) {
            return {
                gasLimit: BigNumber.from(SEND_GAS_COST),
                estimationSucceeded: true,
            };
        }

        // if data, should be hex string format
        estimatedTransaction.data = !data ? data : addHexPrefix(data);

        // 3. If this is a contract address, safely estimate gas using RPC
        estimatedTransaction.value =
            typeof value === 'undefined' ? constants.Zero : value;

        // If fallback is present, use it instead of block gasLimit
        if (fallbackGasLimit && BigNumber.from(fallbackGasLimit)) {
            estimatedTransaction.gasLimit = BigNumber.from(fallbackGasLimit);
        } else {
            // We take a part of the block gasLimit (95% of it)
            const saferGasLimitBN = BnMultiplyByFraction(blockGasLimit, 19, 20);
            estimatedTransaction.gasLimit = saferGasLimitBN;
        }

        // Estimate Gas
        try {
            const estimatedGasLimit = await provider.estimateGas({
                chainId: txOrCurrentChainId,
                data: estimatedTransaction.data,
                from: estimatedTransaction.from,
                to: estimatedTransaction.to,
                value: estimatedTransaction.value,
            });
            // 4. Pad estimated gas without exceeding the most recent block gasLimit. If the network is a
            // a custom network then return the eth_estimateGas value.

            // 90% of the block gasLimit
            const upperGasLimit = BnMultiplyByFraction(blockGasLimit, 9, 10);

            // Buffered gas
            const bufferedGasLimit = BnMultiplyByFraction(
                estimatedGasLimit,
                3,
                2
            );

            // If estimatedGasLimit is above upperGasLimit, dont modify it
            if (estimatedGasLimit.gt(upperGasLimit) || isCustomNetwork) {
                return {
                    gasLimit: estimatedGasLimit,
                    estimationSucceeded: true,
                };
            }

            // If bufferedGasLimit is below upperGasLimit, use bufferedGasLimit
            if (bufferedGasLimit.lt(upperGasLimit)) {
                return {
                    gasLimit: bufferedGasLimit,
                    estimationSucceeded: true,
                };
            }
            return { gasLimit: upperGasLimit, estimationSucceeded: true };
        } catch (error) {
            log.warn(
                'Error estimating the transaction gas. Fallbacking to block gasLimit'
            );

            // Return TX type associated default fallback gasLimit or block gas limit
            return {
                gasLimit: estimatedTransaction.gasLimit,
                estimationSucceeded: false,
            };
        }
    }

    /**
     * It returns a list of Blank deposit APPROVED transaction metas
     */
    public getBlankDepositTransactions = (
        chainId?: number
    ): TransactionMeta[] => {
        const fromChainId = chainId ?? this._networkController.network.chainId;

        return this.store
            .getState()
            .transactions.filter(
                (t) =>
                    t.transactionCategory ===
                        TransactionCategories.BLANK_DEPOSIT &&
                    t.status !== TransactionStatus.UNAPPROVED &&
                    t.chainId === fromChainId
            );
    };

    /**
     * determineTransactionCategory
     *
     * It determines the transaction category
     *
     * @param {TransactionParams} transactionParams The transaction object
     * @returns {Promise<TransactionCategoryResponse>} The transaction category and method signature
     */
    public async determineTransactionCategory(
        transactionParams: TransactionParams
    ): Promise<TransactionCategoryResponse> {
        const { data, to } = transactionParams;
        let name: string | undefined;
        try {
            name = data && this._erc20Abi.parseTransaction({ data }).name;
        } catch (error) {
            log.debug('Failed to parse transaction data.', error, data);
        }

        const tokenMethodName = [
            TransactionCategories.TOKEN_METHOD_APPROVE,
            TransactionCategories.TOKEN_METHOD_TRANSFER,
            TransactionCategories.TOKEN_METHOD_TRANSFER_FROM,
        ].find((methodName) => methodName === name && name.toLowerCase());

        let result;
        if (data && tokenMethodName) {
            result = tokenMethodName;
        } else if (data && !to) {
            result = TransactionCategories.CONTRACT_DEPLOYMENT;
        }

        let code;
        let methodSignature: ContractMethodSignature | undefined = undefined;

        if (!result) {
            try {
                code = await this._networkController.getProvider().getCode(to!);
            } catch (e) {
                code = null;
                log.warn(e);
            }

            const codeIsEmpty = !code || code === '0x' || code === '0x0';

            result = codeIsEmpty
                ? TransactionCategories.SENT_ETHER
                : TransactionCategories.CONTRACT_INTERACTION;

            // If contract interaction, try to fetch the method signature
            if (result === TransactionCategories.CONTRACT_INTERACTION) {
                try {
                    // Obtain first 4 bytes from transaction data
                    const bytesSignature = data!.slice(0, 10);

                    // Lookup on signature registry contract
                    const unparsedSignature = await this._signatureRegistry.lookup(
                        bytesSignature
                    );

                    // If there was a response, parse the signature
                    methodSignature = unparsedSignature
                        ? this._signatureRegistry.parse(unparsedSignature)
                        : undefined;
                } catch (error) {
                    log.warn(error);
                }
            }
        }

        return { transactionCategory: result, methodSignature };
    }
}

export default TransactionController;
