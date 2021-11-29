/* eslint-disable @typescript-eslint/no-non-null-assertion */
import axios from 'axios';
import { BaseController } from '../infrastructure/BaseController';
import {
    TransactionCategories,
    TransactionMeta,
    TransactionStatus,
} from './transactions/utils/types';
import NetworkController, { NetworkEvents } from './NetworkController';
import { AccountTrackerController } from './AccountTrackerController';
import { BigNumber } from 'ethers';
import { PreferencesController } from './PreferencesController';
import { Network } from '../utils/constants/networks';
import { showIncomingTransactionNotification } from '../utils/notifications';

export interface IncomingTransactionControllerState {
    incomingTransactions: {
        [account: string]: {
            [key: string]: {
                list: { [txHash: string]: TransactionMeta };
                lastBlockQueried: number;
            };
        };
    };
}

interface EtherscanTransaction {
    blockNumber: number;
    timeStamp: number;
    isError: string;
    to: string;
    from: string;
    hash: string;
    nonce: number;
    input: string;
    value: string;
    gasPrice: string;
    gas: string;
}

export class IncomingTransactionController extends BaseController<IncomingTransactionControllerState> {
    private _chainId?: number;
    private _networkName?: string;

    constructor(
        private readonly _networkController: NetworkController,
        private readonly _preferencesController: PreferencesController,
        _accountTrackerController: AccountTrackerController,
        initialState: IncomingTransactionControllerState
    ) {
        super(initialState);

        this._chainId = _networkController.network.chainId;
        this._networkName = _networkController.network.name;

        _networkController.on(
            NetworkEvents.NETWORK_CHANGE,
            ({ chainId, name }: Network) => {
                this._chainId = chainId;
                this._networkName = name;
            }
        );

        // Show incoming transaction notification
        this.on('INCOMING_TRANSACTION', async (chainId, address) => {
            showIncomingTransactionNotification(chainId, address);
        });
    }

    public updateIncomingTransactions = async (): Promise<void> => {
        // If network is not supported, do not query
        if (this._networkName) {
            // We check now only for the selected account as we don't have a multiple address single call
            // (etherscan issuing errors due to rate limitation)
            const selectedAddress =
                this._preferencesController.getSelectedAddress();
            const updatedAccounts = await this._formAddressState(
                selectedAddress
            );
            this.setIncomingTransactionState(updatedAccounts);
        }
    };

    private _fetchTransactions = async (
        address: string,
        fromBlock: number
    ): Promise<{ result: EtherscanTransaction[]; status: string }> => {
        const etherscanAPI = this._networkController.network.etherscanApiUrl;

        const result = await axios.get<{
            status: string;
            message: string;
            result: EtherscanTransaction[];
        }>(`${etherscanAPI}/api`, {
            params: {
                module: 'account',
                action: 'txlist',
                address,
                startblock: fromBlock,
                endBlock: 'latest',
                page: 1,
            },
            timeout: 30000,
        });

        return result.data;
    };

    private _formatTransaction = (
        etherscanTransaction: EtherscanTransaction
    ) => {
        const time = Number(etherscanTransaction.timeStamp) * 1000;
        return {
            transactionReceipt: {
                blockNumber: Number(etherscanTransaction.blockNumber),
            },
            time,
            confirmationTime: time,
            status:
                parseInt(etherscanTransaction.isError) === 0
                    ? TransactionStatus.CONFIRMED
                    : TransactionStatus.FAILED,
            transactionParams: {
                to: etherscanTransaction.to,
                from: etherscanTransaction.from,
                value: BigNumber.from(etherscanTransaction.value),
                hash: etherscanTransaction.hash,
                nonce: Number(etherscanTransaction.nonce),
                data: etherscanTransaction.input,
                gasPrice: BigNumber.from(etherscanTransaction.gasPrice),
                gasLimit: BigNumber.from(etherscanTransaction.gas),
                chainId: this._chainId,
            },
            transactionCategory: TransactionCategories.INCOMING,
        } as Partial<TransactionMeta>;
    };

    private _formAddressState = async (
        address: string
    ): Promise<IncomingTransactionControllerState['incomingTransactions']> => {
        // if the user should be notified about the new incoming transactions
        // should be false, if this is the first query for this address
        let notify: boolean;

        let currentAddressTxs: {
            // eslint-disable-next-line
            list: any;
            lastBlockQueried: number;
        };

        // By setting network name here, we assure that if network changes in the middle
        // what'll be stored is from the original network
        const networkName = this._networkName;

        const { incomingTransactions } = this.store.getState();

        if (
            incomingTransactions &&
            address in incomingTransactions &&
            networkName! in incomingTransactions[address]
        ) {
            currentAddressTxs = incomingTransactions[address][networkName!];
            notify = true;
        } else {
            currentAddressTxs = { list: {}, lastBlockQueried: 0 };
            notify = false;
        }

        const { result, status } = await this._fetchTransactions(
            address,
            currentAddressTxs.lastBlockQueried
        );

        if (!(status === '1' && Array.isArray(result) && result.length > 0)) {
            return {
                ...incomingTransactions,
                [address]: {
                    ...incomingTransactions[address],
                    [networkName!]: currentAddressTxs,
                },
            };
        }

        const formattedIncomingTransactions = result
            .filter((trx) => trx.to.toUpperCase() === address.toUpperCase())
            .map((cv) => this._formatTransaction(cv))
            .sort(
                (a, b) =>
                    b.transactionReceipt!.blockNumber! -
                    a.transactionReceipt!.blockNumber!
            );

        if (formattedIncomingTransactions.length > 0) {
            if (notify) {
                this.emit(
                    'INCOMING_TRANSACTION',
                    String(this._chainId),
                    address
                );
            }
        } else {
            return {
                ...incomingTransactions,
                [address]: {
                    ...incomingTransactions[address],
                    [networkName!]: currentAddressTxs,
                },
            };
        }

        formattedIncomingTransactions.forEach((tx) => {
            const hash = tx.transactionParams?.hash;
            currentAddressTxs.list[hash!] = tx as TransactionMeta;
        });

        return {
            ...incomingTransactions,
            [address]: {
                ...incomingTransactions[address],
                [networkName!]: {
                    list: currentAddressTxs.list,
                    lastBlockQueried:
                        formattedIncomingTransactions[0].transactionReceipt!
                            .blockNumber! + 1,
                },
            },
        };
    };

    private setIncomingTransactionState = (
        transactions: IncomingTransactionControllerState['incomingTransactions']
    ) => {
        this.store.setState({ incomingTransactions: transactions });
    };
}
