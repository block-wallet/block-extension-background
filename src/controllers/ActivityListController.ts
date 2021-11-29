import { BigNumber } from '@ethersproject/bignumber';
import { parseUnits } from 'ethers/lib/utils';
import { BaseController } from '../infrastructure/BaseController';
import {
    BlankDepositController,
    PendingWithdrawal,
    PendingWithdrawalStatus,
} from './blank-deposit/BlankDepositController';
import { IncomingTransactionController } from './IncomingTransactionController';
import NetworkController from './NetworkController';
import { PreferencesController } from './PreferencesController';
import { TransactionController } from './transactions/TransactionController';
import {
    getFinalTransactionStatuses,
    TransactionCategories,
    TransactionMeta,
    TransactionStatus,
} from './transactions/utils/types';
import { compareAddresses } from './transactions/utils/utils';

export interface IActivityListState {
    activityList: {
        pending: TransactionMeta[];
        confirmed: TransactionMeta[];
    };
}

export class ActivityListController extends BaseController<IActivityListState> {
    constructor(
        private readonly _transactionsController: TransactionController,
        private readonly _blankDepositsController: BlankDepositController,
        private readonly _incomingTransactionsController: IncomingTransactionController,
        private readonly _preferencesController: PreferencesController,
        private readonly _networkController: NetworkController
    ) {
        super();

        // If any of the following stores were updated trigger the ActivityList update
        this._transactionsController.UIStore.subscribe(this.onStoreUpdate);
        this._blankDepositsController.UIStore.subscribe(this.onStoreUpdate);
        this._incomingTransactionsController.store.subscribe(
            this.onStoreUpdate
        );
        this._preferencesController.store.subscribe(this.onStoreUpdate);
        this._networkController.store.subscribe(this.onStoreUpdate);
        this.onStoreUpdate();
    }

    /**
     * Ensure that 'currency' will be uppercase
     *
     * @param transactionMeta
     * @returns TransactionMeta with currency text uppercase
     */
    private transactionSymbolTransformation = (
        transactionMeta: TransactionMeta
    ): TransactionMeta => {
        if (transactionMeta.transferType?.currency) {
            transactionMeta.transferType.currency =
                transactionMeta.transferType.currency.toUpperCase();
        }
        return transactionMeta;
    };

    /**
     * Triggers on UI store update
     */
    private onStoreUpdate = () => {
        const { selectedAddress } =
            this._preferencesController.store.getState();

        const selectedNetwork = this._networkController.selectedNetwork;

        // Get parsed incoming transactions
        const incomingTransactions = this.parseIncomingTransactions(
            selectedAddress,
            selectedNetwork
        );

        // Get parsed withdrawals
        const { confirmed: confirmedWithdrawals, pending: pendingWithdrawals } =
            this.parseWithdrawalTransactions(selectedAddress);

        // Get parsed transactions
        const {
            confirmed: confirmedTransactions,
            pending: pendingTransactions,
        } = this.parseTransactions(selectedAddress);

        // Concat all and order by time
        const confirmed = incomingTransactions
            .concat(confirmedWithdrawals)
            .concat(confirmedTransactions)
            .sort((a, b) => {
                // If confirmationTime is not set, use the submittedTime
                // which will always be set at this point
                const aTime = a.confirmationTime || a.submittedTime || a.time;
                const bTime = b.confirmationTime || b.submittedTime || b.time;

                if (
                    aTime == bTime &&
                    b.transactionParams.nonce &&
                    a.transactionParams.nonce
                ) {
                    return (
                        b.transactionParams.nonce - a.transactionParams.nonce
                    );
                }

                // Confirmed ones ordered by time descending
                return bTime - aTime;
            })
            .map((c: TransactionMeta) => {
                return this.transactionSymbolTransformation(c);
            });

        // Pendings ordered by time descending
        const pending = pendingWithdrawals
            .concat(pendingTransactions)
            .sort((a, b) => a.time - b.time)
            .map((c: TransactionMeta) => {
                return this.transactionSymbolTransformation(c);
            });

        // Update state
        this.store.setState({
            activityList: {
                confirmed,
                pending,
            },
        });
    };

    /**
     * parseTransactions
     *
     * @param selectedAddress The user selected address
     * @returns The list of the user pending and confirmed transactions
     */
    private parseTransactions(selectedAddress: string) {
        // Filter by user outgoing transactions only
        const fromUser = (transaction: TransactionMeta) =>
            compareAddresses(
                transaction.transactionParams.from,
                selectedAddress
            );

        // Whether the transaction is on one of its final states
        const isOnFinalState = (t: TransactionMeta) =>
            getFinalTransactionStatuses().includes(t.status);

        const { transactions } =
            this._transactionsController.UIStore.getState();
        const userTransactions = transactions.filter(fromUser);
        return {
            confirmed: userTransactions.filter(isOnFinalState),
            pending: userTransactions.filter(
                (t) => t.status === TransactionStatus.SUBMITTED
            ),
        };
    }

    /**
     * parseIncomingTransactions
     *
     * @param selectedAddress The user selected address
     * @param selectedNetwork The user selected network
     * @returns The user incoming transactions
     */
    private parseIncomingTransactions(
        selectedAddress: string,
        selectedNetwork: string
    ) {
        const { incomingTransactions } =
            this._incomingTransactionsController.store.getState();

        return incomingTransactions &&
            selectedAddress in incomingTransactions &&
            selectedNetwork in incomingTransactions[selectedAddress]
            ? Object.values(
                  incomingTransactions[selectedAddress][selectedNetwork].list
              )
            : [];
    }

    /**
     * parseWithdrawalTransactions
     *
     * @returns The user pending and confirmed withdrawals
     */
    private parseWithdrawalTransactions(selectedAddress: string) {
        const { pendingWithdrawals } =
            this._blankDepositsController.UIStore.getState();

        const { nativeCurrency } = this._networkController.network;

        if (!pendingWithdrawals) {
            return {
                confirmed: [],
                pending: [],
            };
        }

        const statusMap: {
            [key in PendingWithdrawalStatus]: TransactionStatus;
        } = {
            [PendingWithdrawalStatus.PENDING]: TransactionStatus.SUBMITTED,
            [PendingWithdrawalStatus.UNSUBMITTED]: TransactionStatus.SUBMITTED,
            [PendingWithdrawalStatus.CONFIRMED]: TransactionStatus.CONFIRMED,
            [PendingWithdrawalStatus.MINED]: TransactionStatus.CONFIRMED,
            [PendingWithdrawalStatus.FAILED]: TransactionStatus.FAILED,
            [PendingWithdrawalStatus.REJECTED]: TransactionStatus.REJECTED,
        };

        const mapFc = (w: PendingWithdrawal) => {
            const decimals = w.decimals || nativeCurrency.decimals; // Default to ETH
            const value = parseUnits(w.pair.amount, decimals).sub(
                w.fee ? BigNumber.from(w.fee) : BigNumber.from(0)
            );

            return {
                id: w.depositId,
                status: statusMap[
                    w.status || PendingWithdrawalStatus.UNSUBMITTED
                ],
                time: w.time,
                confirmationTime: w.time,

                transactionParams: {
                    to: w.toAddress,
                    value,
                    hash: w.transactionHash,
                    // Set withdrawal fee on gasPrice for the sake of providing it to the UI
                    gasPrice: w.fee,
                },
                transferType: {
                    amount: value,
                    decimals: w.decimals,
                    currency: w.pair.currency.toUpperCase(),
                },
                transactionReceipt: w.transactionReceipt,
                transactionCategory: TransactionCategories.BLANK_WITHDRAWAL,
                loadingGasValues: false,
            } as TransactionMeta;
        };

        const confirmed = pendingWithdrawals
            .filter(
                (w) =>
                    w.status &&
                    [
                        PendingWithdrawalStatus.CONFIRMED,
                        PendingWithdrawalStatus.FAILED,
                        PendingWithdrawalStatus.REJECTED,
                    ].includes(w.status) &&
                    w.toAddress === selectedAddress
            )
            .map(mapFc);

        const pending = pendingWithdrawals
            .filter((w) =>
                [
                    PendingWithdrawalStatus.PENDING,
                    PendingWithdrawalStatus.UNSUBMITTED,
                ].includes(w.status || PendingWithdrawalStatus.UNSUBMITTED)
            )
            .map(mapFc);

        return { confirmed, pending };
    }

    /**
     * Removes all activities from state
     *
     */
    public clearActivities(): void {
        this.store.setState({
            activityList: {
                pending: [],
                confirmed: [],
            },
        });
    }
}
