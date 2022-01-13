import { ethers } from 'ethers';
import { CurrencyAmountPair } from '../types';
import { IBlankDeposit } from '../BlankDeposit';
import { TransactionMeta } from '../../transactions/utils/types';
import { TransactionFeeData } from '../../erc-20/transactions/SignedTransaction';
import { NextDepositResult } from '../notes/INotesService';

export interface IDeposit {
    /**
     * Populates the deposit transaction from the tornado contract.
     * @param currencyAmountPair
     */
    populateDepositTransaction(
        currencyAmountPair: CurrencyAmountPair,
        chainId?: number
    ): Promise<{
        populatedTransaction: ethers.PopulatedTransaction;
        nextDeposit: NextDepositResult['nextDeposit'];
    }>;

    /**
     * Adds an unapproved tornado deposit transaction to the transaction state.
     * @param currencyAmountPair
     * @param populatedTransaction
     * @param feeData The deposit gas fee data
     * @param approveUnlimited OPTIONAL - Approve unlimited amount
     */
    addAsNewDepositTransaction(
        currencyAmountPair: CurrencyAmountPair,
        populatedTransaction: ethers.PopulatedTransaction,
        feeData: TransactionFeeData,
        approveUnlimited?: boolean
    ): Promise<TransactionMeta>;

    /**
     * Updates the gas configuration for an unnaproved deposit transaction.
     * @param transactionId the id of the transaction to be updated.
     * @param feeData The deposit gas fee data
     */
    updateDepositTransactionGas(
        transactionId: string,
        feeData: TransactionFeeData
    ): Promise<void>;

    /**
     * Approves a deposit transaction.
     * @param transactionId the id of the tornado transaction to be approved.
     */
    approveDepositTransaction(
        transactionId: string,
        currencyAmountPair?: CurrencyAmountPair,
        chainId?: number,
        nextDeposit?: NextDepositResult['nextDeposit']
    ): Promise<void>;

    /**
     * Gets the result of a tornado deposit transaction.
     * @param transactionId the id of the tornado deposit transaction to get the result.
     */
    getDepositTransactionResult(transactionId: string): Promise<string>;

    /**
     * deposit
     *
     * It makes a Blank private deposit
     *
     * @param currencyAmountPair The desired deposit currency and amount values
     * @param feeData The deposit gas fee data
     * @param approveUnlimited Whether or not to grant unlimited allowance
     */
    deposit(
        currencyAmountPair: CurrencyAmountPair,
        feeData: TransactionFeeData,
        approveUnlimited?: boolean
    ): Promise<string>;
}

export interface IWithdraw {
    /**
     * withdraw
     *
     * It makes a Blank private withdraw
     *
     * @param note The deposit note
     * @param recipient The whitdrawal recipient
     */
    withdraw(deposit: IBlankDeposit, recipient: string): Promise<string>;
}

export interface IDepositWithdraw extends IDeposit, IWithdraw {}
