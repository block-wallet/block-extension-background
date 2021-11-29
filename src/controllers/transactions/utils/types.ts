/* eslint-disable @typescript-eslint/no-explicit-any */
import { TransactionReceipt } from '@ethersproject/abstract-provider';
import { BigNumber, Transaction } from 'ethers';
import { CurrencyAmountPair } from '../../blank-deposit/types';
import { ContractMethodSignature } from '../SignatureRegistry';

/**
 * TransactionParams
 * @link https://github.com/ethers-io/ethers.js/issues/321
 * @link https://github.com/ethers-io/ethers.js/issues/299
 */

export type TransactionParams = Partial<Transaction>;

export enum MetaType {
    REGULAR = 'REGULAR',
    CANCEL = 'CANCEL',
    SPEED_UP = 'SPEED_UP',
}

/**
 * TransactionMeta
 */
export interface TransactionMeta {
    id: string;
    origin?: string;
    rawTransaction?: string;
    status: TransactionStatus;
    time: number;
    submittedTime?: number;

    /**
     * Counts how many blocks have passed since a transaction with a higher nonce was confirmed
     */
    blocksDropCount: number;

    confirmationTime?: number;
    chainId?: number;
    transactionParams: TransactionParams;
    transactionReceipt?: TransactionReceipt;
    transactionCategory?: TransactionCategories;
    methodSignature?: ContractMethodSignature;
    transferType?: TransferType;
    metaType?: MetaType;
    loadingGasValues: boolean;
    depositPair?: CurrencyAmountPair;
    blankDepositId?: string;
    verifiedOnBlockchain?: boolean;
    gasEstimationFailed?: boolean;
    error?: {
        message: string;
        stack?: string;
    };
}

/**
 * The status of the transaction. Each status represents the state of the transaction internally
 * in the wallet. Some of these correspond with the state of the transaction on the network, but
 * some are wallet-specific.
 */
export enum TransactionStatus {
    FAILED = 'FAILED',
    DROPPED = 'DROPPED',
    CANCELLED = 'CANCELLED',
    SIGNED = 'SIGNED',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    SUBMITTED = 'SUBMITTED',
    CONFIRMED = 'CONFIRMED',
    UNAPPROVED = 'UNAPPROVED',
}

/**
 * It returns a list of final transaction states
 */
export const getFinalTransactionStatuses = (): TransactionStatus[] => [
    TransactionStatus.FAILED,
    TransactionStatus.REJECTED,
    TransactionStatus.DROPPED,
    TransactionStatus.CANCELLED,
    TransactionStatus.CONFIRMED,
];

/**
 * The possible Categories of a transaction
 */
export enum TransactionCategories {
    BLANK_DEPOSIT = 'blankDeposit',
    BLANK_WITHDRAWAL = 'blankWithdrawal',
    INCOMING = 'incoming',
    SENT_ETHER = 'sentEther',
    CONTRACT_DEPLOYMENT = 'contractDeployment',
    CONTRACT_INTERACTION = 'contractInteraction',
    TOKEN_METHOD_APPROVE = 'approve',
    TOKEN_METHOD_TRANSFER = 'transfer',
    TOKEN_METHOD_TRANSFER_FROM = 'transferfrom',
    BLANK_SWAP = 'blankSwap',
}

/**
 * Transaction events emitted by the controller
 */
export enum TransactionEvents {
    UNAPPROVED_TRANSACTION = 'UNAPPROVED_TRANSACTION',
    STATUS_UPDATE = 'STATUS_UPDATE',
}

/**
 * Metadata for displaying on the UI ActivityList
 */
export interface TransferType {
    currency: string;
    amount: BigNumber;
    decimals: number;
    logo?: string;
    to?: string;
}

/**
 * Ethereum transaction types
 */
export enum TransactionType {
    LEGACY = 0,
    ACCESS_LIST_EIP2930 = 1,
    FEE_MARKET_EIP1559 = 2,
}
