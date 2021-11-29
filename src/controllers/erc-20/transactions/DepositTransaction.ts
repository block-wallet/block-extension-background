/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BigNumber } from '@ethersproject/bignumber';
import { ethers, utils } from 'ethers';
import log from 'loglevel';
import { v4 as uuid } from 'uuid';
import { INoteDeposit } from '../../blank-deposit/notes/INoteDeposit';
import { ITornadoContract } from '../../blank-deposit/tornado/config/ITornadoContract';
import {
    DEPOSIT_GAS_LIMIT,
    TornadoContracts,
} from '../../blank-deposit/tornado/TornadoService';
import { currencyAmountPairToMapKey } from '../../blank-deposit/tornado/utils';
import { CurrencyAmountPair, KnownCurrencies } from '../../blank-deposit/types';
import { FeeData } from '../../GasPricesController';
import { TransactionGasEstimation } from '../../transactions/TransactionController';
import {
    TransactionCategories,
    TransactionMeta,
} from '../../transactions/utils/types';
import {
    tokenAddressParamNotPresentError,
    TokenController,
    transactionIdParamNotPresentError,
} from '../TokenController';
import {
    ApproveTransaction,
    ApproveTransactionPopulatedTransactionParams,
} from './ApproveTransaction';
import {
    PopulatedTransactionParams,
    SignedTransaction,
    SignedTransactionProps,
} from './SignedTransaction';
import { TokenOperationsController } from './Transaction';

/**
 * The fallback (if we can't estimate it) gas limit for a deposit transaction.
 */
export const DEPOSIT_TRANSACTION_FALLBACK_GAS_LIMIT = '0x124f80'; // Hex for 12e5

export interface DepositTransactionProps extends SignedTransactionProps {
    tornadoContracts: TornadoContracts;
    proxyContract: ITornadoContract;
    tokenController: TokenController;
    tokenOperationsController: TokenOperationsController;
}

export interface DepositTransactionPopulatedTransactionParams
    extends PopulatedTransactionParams {
    currencyAmountPair: CurrencyAmountPair;
    nextDeposit: {
        spent?: boolean | undefined;
        deposit: INoteDeposit;
        pair: CurrencyAmountPair;
    };
}

/**
 * Deposit tokens to a wallet
 */
export class DepositTransaction extends SignedTransaction {
    // Tornado Contracts
    private _tornadoContracts: TornadoContracts;
    private _proxyContract!: ITornadoContract;
    private _tokenController: TokenController;
    private _tokenOperationsController: TokenOperationsController;

    constructor(props: DepositTransactionProps) {
        super({
            ...props,
            fallbackTransactionGasLimit: BigNumber.from(
                DEPOSIT_TRANSACTION_FALLBACK_GAS_LIMIT
            ),
        });
        this._tornadoContracts = props.tornadoContracts;
        this._proxyContract = props.proxyContract;
        this._tokenController = props.tokenController;
        this._tokenOperationsController = props.tokenOperationsController;
    }

    /**
     * Populates the deposit transaction from the tornado contract.
     * @param {DepositTransactionPopulatedTransactionParams} populateTransactionParams {
     *  currencyAmountPair: CurrencyAmountPair;
     *  nextDeposit: {
     *   spent?: boolean | undefined;
     *   deposit: INoteDeposit;
     *   pair: CurrencyAmountPair;
     *  };
     * }
     */
    public async populateTransaction(
        populateTransasctionParams: DepositTransactionPopulatedTransactionParams
    ): Promise<ethers.PopulatedTransaction> {
        if (!populateTransasctionParams.currencyAmountPair) {
            throw tokenAddressParamNotPresentError;
        }

        // Get Tornado contract
        const key = currencyAmountPairToMapKey(
            populateTransasctionParams.currencyAmountPair
        );
        if (!this._tornadoContracts.has(key))
            throw new Error('Currency amount pair not supported');

        const { contract } = this._tornadoContracts.get(key)!;

        // Populate unsigned transaction
        return this._proxyContract.populateTransaction.deposit(
            contract.address,
            populateTransasctionParams.nextDeposit.deposit.commitmentHex,
            []
        );
    }

    /**
     * Calculates the gas limit for a tornado deposit transaction.
     * @param {DepositTransactionPopulatedTransactionParams} populateTransactionParams {
     *  currencyAmountPair: CurrencyAmountPair;
     *  nextDeposit: {
     *   spent?: boolean | undefined;
     *   deposit: INoteDeposit;
     *   pair: CurrencyAmountPair;
     *  };
     * }
     */
    public async calculateTransactionGasLimit(
        populateTransactionParams: DepositTransactionPopulatedTransactionParams
    ): Promise<TransactionGasEstimation> {
        const populatedTransaction = await this.populateTransaction(
            populateTransactionParams
        );

        // when calculating gas for an ETH deposit, the value of the tx has to be set
        if (
            populateTransactionParams.currencyAmountPair.currency ==
            KnownCurrencies.ETH
        ) {
            populatedTransaction.value = utils.parseEther(
                populateTransactionParams.currencyAmountPair.amount
            );
        }

        return this._calculateTransactionGasLimit(populatedTransaction);
    }

    /**
     * getTokenAllowance
     *
     * @param {CurrencyAmountPair} currencyAmountPair The pair to check allowance against
     * @returns The currently granted token allowance
     */
    public async getTokenAllowance(
        currencyAmountPair: CurrencyAmountPair
    ): Promise<BigNumber> {
        // Get Tornado contract
        const key = currencyAmountPairToMapKey(currencyAmountPair);
        if (!this._tornadoContracts.has(key))
            throw new Error('Currency amount pair not supported');

        const { tokenAddress } = this._tornadoContracts.get(key)!;

        // Ensure having the token address
        let erc20ContractAddress = tokenAddress;
        if (!erc20ContractAddress) {
            const token = await this._tokenController.search(
                currencyAmountPair.currency,
                true
            );
            if (!('address' in token[0])) {
                throw new Error(
                    'Specified token has no address nor it has been found in the tokens list'
                );
            }
            erc20ContractAddress = token[0].address;
        }

        // Check for allowance
        return this._tokenOperationsController.allowance(
            erc20ContractAddress,
            this._preferencesController.getSelectedAddress(),
            this._proxyContract.address
        );
    }

    /**
     * Adds an unapproved tornado deposit transaction to the transaction state.
     * @param {CurrencyAmountPair} currencyAmountPair: CurrencyAmountPair;
     * @param {ethers.PopulatedTransaction} populateTransactionParams {
     *  nextDeposit: {
     *   spent?: boolean | undefined;
     *   deposit: INoteDeposit;
     *   pair: CurrencyAmountPair;
     *  };
     * }
     * @param {FeeData} feeData an object with gas fee data.
     * @param {boolean} approveUnlimited Whether or not to grant unlimited allowance
     */
    public async addAsNewDepositTransaction(
        currencyAmountPair: CurrencyAmountPair,
        populatedTransaction: ethers.PopulatedTransaction,
        feeData: FeeData,
        approveUnlimited = false
    ): Promise<TransactionMeta> {
        // Get Tornado contract
        const key = currencyAmountPairToMapKey(currencyAmountPair);
        if (!this._tornadoContracts.has(key))
            throw new Error('Currency amount pair not supported');

        const { decimals, tokenAddress } = this._tornadoContracts.get(key)!;

        // Parse total
        const depositValue = utils.parseUnits(
            currencyAmountPair.amount,
            decimals
        );

        // Add value or approve deposit amount
        if (currencyAmountPair.currency === KnownCurrencies.ETH) {
            // Add value for ETH instance
            populatedTransaction.value = depositValue;
        } else {
            // Ensure having the token address
            let erc20ContractAddress = tokenAddress;
            if (!erc20ContractAddress) {
                const token = await this._tokenController.search(
                    currencyAmountPair.currency,
                    true
                );
                if (!('address' in token[0])) {
                    throw new Error(
                        'Specified token has no address nor it has been found in the tokens list'
                    );
                }
                erc20ContractAddress = token[0].address;
            }

            // Check for allowance
            const allowance = await this._tokenOperationsController.allowance(
                erc20ContractAddress,
                this._preferencesController.getSelectedAddress(),
                this._proxyContract.address
            );

            // If allowance isn't enough approve for the deposit or total amount
            if (allowance.lt(depositValue)) {
                const approveTransaction = new ApproveTransaction({
                    networkController: this._networkController,
                    transactionController: this._transactionController,
                    preferencesController: this._preferencesController,
                });

                const { gasLimit } =
                    await approveTransaction.calculateTransactionGasLimit({
                        tokenAddress: erc20ContractAddress,
                        spender: this._proxyContract.address,
                        amount: approveUnlimited ? 'UNLIMITED' : depositValue,
                    } as ApproveTransactionPopulatedTransactionParams);

                const hasApproved = await approveTransaction.do(
                    erc20ContractAddress,
                    this._proxyContract.address,
                    approveUnlimited ? 'UNLIMITED' : depositValue,
                    // Replacing gasLimit with a correct gasLimit for this kind of transaction,
                    // because the original is set for the deposit and it is much higher than the gasLimit needed for an approval
                    { ...feeData, gasLimit }
                );

                if (!hasApproved) {
                    throw new Error(
                        'Error approving the deposit value spending allowance'
                    );
                }
            }
        }

        // Send transaction to the pool
        const meta = await this.addAsNewTransaction(
            populatedTransaction,
            feeData
        );

        meta.blankDepositId = uuid();

        try {
            if (currencyAmountPair.currency === KnownCurrencies.ETH) {
                const { nativeCurrency, iconUrls } =
                    this._networkController.network;
                const logo = iconUrls ? iconUrls[0] : '';
                meta.transferType = {
                    amount: depositValue,
                    currency: nativeCurrency.symbol,
                    decimals: nativeCurrency.decimals,
                    logo,
                };
            } else {
                const { symbol, logo } = await this._tokenController.getToken(
                    tokenAddress!
                );
                // Set TransferType for displaying purposes
                meta.transferType = {
                    amount: depositValue,
                    currency: symbol,
                    decimals,
                    logo,
                };
            }

            // Set depositPair to prevent resending a faulty pair from UI
            meta.depositPair = currencyAmountPair;

            this._transactionController.updateTransaction(meta);
        } catch (error) {
            log.error(
                'Unable to fetch token data on Transfer transaction generation'
            );
        }

        return meta;
    }

    /**
     * Adds an unapproved deposit transaction to the transaction state.
     * @param {ethers.PopulatedTransaction} populateTransactionParams depends on the case, the necessary data for the contract.
     * @param {FeeData} feeData an object with gas fee data.
     */
    public async addAsNewTransaction(
        populatedTransaction: ethers.PopulatedTransaction,
        feeData: FeeData
    ): Promise<TransactionMeta> {
        feeData.gasLimit =
            feeData.gasLimit || BigNumber.from(DEPOSIT_GAS_LIMIT);
        return this._addAsNewTransaction(
            populatedTransaction,
            feeData,
            TransactionCategories.BLANK_DEPOSIT
        );
    }

    /**
     * Gets the result of a tornado deposit transaction.
     * @param {string} transactionId the id of the tornado deposit transaction to get the result.
     */
    public async getTransactionResult(transactionId: string): Promise<string> {
        if (!transactionId) {
            throw transactionIdParamNotPresentError;
        }
        const transactionMeta =
            this._transactionController.getTransaction(transactionId)!;

        return transactionMeta.transactionParams.hash!;
    }
}
