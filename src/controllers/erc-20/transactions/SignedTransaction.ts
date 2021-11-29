/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-interface */
import { BigNumber, ethers } from 'ethers';
import { PreferencesController } from '../../PreferencesController';
import {
    TransactionController,
    TransactionGasEstimation,
} from '../../transactions/TransactionController';

import {
    TransactionCategories,
    TransactionMeta,
    TransactionStatus,
} from '../../transactions/utils/types';
import {
    gasMaxFeePerGasParamNotPresentError,
    gasMaxPriorityFeePerGasParamNotPresentError,
    gasPriceParamNotPresentError,
    populatedTransactionParamNotPresentError,
    transactionIdParamNotPresentError,
    transactionNotFound,
} from '../TokenController';
import {
    TokenTransactionController,
    TokenTransactionProps,
} from './Transaction';
import * as transactionUtils from './../../transactions/utils/utils';
import { INITIAL_NETWORKS } from '../../../utils/constants/networks';
import { FeeData } from '../../GasPricesController';
import { bnGreaterThanZero } from '../../../utils/bnUtils';
import { v4 as uuid } from 'uuid';

const GAS_LIMIT = 2e6;

export interface PopulatedTransactionParams {}

/**
 * Interface for token transactions.
 */
export interface ISignedTransaction {
    /**
     * Populates the transaction from the contract.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     */
    populateTransaction(
        populateTransactionParams: PopulatedTransactionParams
    ): Promise<ethers.PopulatedTransaction>;

    /**
     * Calculates the gas limit for a populated transaction. It returns a flag that indicates if the estimation succeeded or defaulted to a fallback price.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     */
    calculateTransactionGasLimit(
        populateTransactionParams: PopulatedTransactionParams
    ): Promise<TransactionGasEstimation>;

    /**
     * Adds an unapproved transaction to the transaction state.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     * @param {FeeData} feeData an object with gas fee data.
     */
    addAsNewTransaction(
        populateTransactionParams: PopulatedTransactionParams,
        feeData: FeeData
    ): Promise<TransactionMeta>;

    /**
     * Updates the gas configuration for an unnaproved transaction.
     * @param {string} transactionId the id of the transaction to be updated.
     * @param {FeeData} feeData an object with gas fee data.
     */
    updateTransactionGas(
        transactionId: string,
        feeData: FeeData
    ): Promise<void>;

    /**
     * Approves a transaction.
     * @param {string} transactionId the id of the transaction to be approved.
     */
    approveTransaction(transactionId: string): Promise<void>;

    /**
     * Gets the result of a transaction.
     * @param {string} transactionId the id of the transaction to get the result.
     */
    getTransactionResult(transactionId: string): Promise<any>;
}

/**
 * Basic props for an abstract signed transaction
 * @member {BigNumber} fallbackTransactionGasLimit - A default fallback gas limit to not use the last block gas limit. Every implementation should configure it.
 */
export interface SignedTransactionProps extends TokenTransactionProps {
    transactionController: TransactionController;
    preferencesController: PreferencesController;
    fallbackTransactionGasLimit?: BigNumber;
}

/**
 * Abstract implementation for token transactions.
 */
export abstract class SignedTransaction
    extends TokenTransactionController
    implements ISignedTransaction
{
    protected readonly _transactionController: TransactionController;
    protected readonly _preferencesController: PreferencesController;
    private readonly _fallbackTransactionGasLimit?: BigNumber;

    constructor(props: SignedTransactionProps) {
        super(props);
        this._preferencesController = props.preferencesController;
        this._transactionController = props.transactionController;
        this._fallbackTransactionGasLimit = props.fallbackTransactionGasLimit;
    }

    /**
     * Populates the transaction from the contract.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     */
    public abstract populateTransaction(
        populateTransactionParams: PopulatedTransactionParams
    ): Promise<ethers.PopulatedTransaction>;

    /**
     * Calculates the gas limit for a populated transaction.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     */
    public abstract calculateTransactionGasLimit(
        populateTransactionParams: PopulatedTransactionParams
    ): Promise<TransactionGasEstimation>;

    /**
     * Calculates the gas limit for a populated transaction.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     */
    protected async _calculateTransactionGasLimit(
        populatedTransaction: ethers.PopulatedTransaction
    ): Promise<TransactionGasEstimation> {
        populatedTransaction.from =
            this._preferencesController.getSelectedAddress();

        const normalizedTransactionParams =
            transactionUtils.normalizeTransaction({
                ...populatedTransaction,
            });

        transactionUtils.validateTransaction(normalizedTransactionParams);

        const transactionMeta: TransactionMeta = {
            id: uuid(),
            chainId: this._networkController.network.chainId,
            origin: 'blank',
            status: TransactionStatus.UNAPPROVED,
            time: Date.now(),
            verifiedOnBlockchain: false,
            loadingGasValues: true,
            blocksDropCount: 0,
            transactionParams: normalizedTransactionParams,
        };

        transactionMeta.origin = 'blank';
        return this._transactionController.estimateGas(
            transactionMeta,
            this._fallbackTransactionGasLimit
        );
    }

    /**
     * Adds an unapproved transaction to the transaction state.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     * @param {FeeData} feeData an object with gas fee data.
     */
    public abstract addAsNewTransaction(
        populateTransactionParams: PopulatedTransactionParams,
        feeData: FeeData
    ): Promise<TransactionMeta>;

    /**
     * Adds an unapproved transaction to the transaction state.
     * @param {PopulatedTransactionParams} populateTransactionParams depends on the case, the necessary data for the contract.
     * @param {FeeData} feeData an object with gas fee data.
     */
    protected async _addAsNewTransaction(
        populatedTransaction: ethers.PopulatedTransaction,
        feeData: FeeData,
        transactionCategory?: TransactionCategories
    ): Promise<TransactionMeta> {
        if (!populatedTransaction) {
            throw populatedTransactionParamNotPresentError;
        }

        if (await this._networkController.getEIP1559Compatibility()) {
            if (!bnGreaterThanZero(feeData.maxFeePerGas)) {
                throw gasMaxFeePerGasParamNotPresentError;
            }
            if (!bnGreaterThanZero(feeData.maxPriorityFeePerGas)) {
                throw gasMaxPriorityFeePerGasParamNotPresentError;
            }
        } else {
            if (!bnGreaterThanZero(feeData.gasPrice)) {
                throw gasPriceParamNotPresentError;
            }
        }

        const { chainId } = this._networkController.network;

        // If we are not in mainnet the gas limit is fixed but if we aren't
        // the gas limit is calculated.
        feeData.gasLimit =
            chainId != INITIAL_NETWORKS['MAINNET'].chainId
                ? feeData.gasLimit || BigNumber.from(GAS_LIMIT)
                : feeData.gasLimit;

        const { transactionMeta: meta } =
            await this._transactionController.addTransaction(
                {
                    ...populatedTransaction,
                    from: this._preferencesController.getSelectedAddress(),
                    ...feeData,
                },
                'blank'
            );

        meta.transactionCategory = transactionCategory;
        this._transactionController.updateTransaction(meta);

        return meta;
    }

    /**
     * Updates the gas configuration for an unnaproved transaction.
     * @param {string} transactionId the id of the transaction to be updated.
     * @param {FeeData} feeData an object with gas fee data.
     */
    public async updateTransactionGas(
        transactionId: string,
        feeData: FeeData
    ): Promise<void> {
        if (!transactionId) {
            throw transactionIdParamNotPresentError;
        }

        const transactionMeta =
            this._transactionController.getTransaction(transactionId);

        if (!transactionMeta) {
            throw transactionNotFound;
        }

        if (feeData.gasLimit) {
            transactionMeta.transactionParams.gasLimit = feeData.gasLimit;
        }

        if (feeData.gasPrice) {
            transactionMeta.transactionParams.gasPrice = feeData.gasPrice;
        }

        if (feeData.maxFeePerGas) {
            transactionMeta.transactionParams.maxFeePerGas =
                feeData.maxFeePerGas;
        }

        if (feeData.maxPriorityFeePerGas) {
            transactionMeta.transactionParams.maxPriorityFeePerGas =
                feeData.maxPriorityFeePerGas;
        }

        return this._transactionController.updateTransaction(transactionMeta);
    }

    /**
     * Approves a transaction.
     * @param {void} transactionId the id of the transaction to be approved.
     */
    async approveTransaction(transactionId: string): Promise<void> {
        if (!transactionId) {
            throw transactionIdParamNotPresentError;
        }
        return this._transactionController.approveTransaction(transactionId);
    }

    /**
     * Gets the result of a transaction.
     * @param {string} transactionId the id of the transaction to get the result.
     */
    public abstract getTransactionResult(transactionId: string): Promise<any>;
}
