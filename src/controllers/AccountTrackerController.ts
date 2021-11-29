/* eslint-disable @typescript-eslint/no-non-null-assertion */
import NetworkController, { NetworkEvents } from './NetworkController';
import { BaseController } from '../infrastructure/BaseController';
import { BigNumber, ethers } from 'ethers';
import {
    ImportStrategy,
    ImportArguments,
    importHandler,
} from '../utils/account';
import {
    NATIVE_TOKEN_ADDRESS,
    TokenController,
    TokenControllerEvents,
} from './erc-20/TokenController';
import { Token } from './erc-20/Token';
import { toChecksumAddress } from 'ethereumjs-util';
import { TokenOperationsController } from './erc-20/transactions/Transaction';
import { Mutex } from 'async-mutex';
import initialState from '../utils/constants/initialState';
import log from 'loglevel';
import KeyringControllerDerivated from './KeyringControllerDerivated';
import {
    BalanceMap,
    getAddressBalances as getAddressBalancesFromSingleCallBalancesContract,
    isSingleCallBalancesContractAvailable,
} from '../utils/balance-checker/balanceChecker';
import { cloneDeep } from 'lodash';

export interface AccountBalanceToken {
    token: Token;
    balance: BigNumber;
}
export interface AccountBalanceTokens {
    [address: string]: AccountBalanceToken;
}
export interface AccountBalance {
    nativeTokenBalance: BigNumber;
    tokens: AccountBalanceTokens;
}

export interface AccountBalances {
    [chainId: number]: AccountBalance;
}

export interface AccountInfo {
    address: string;
    name: string;
    index: number; // for sorting purposes
    external: boolean; // indicates if it was derivated from the seed phrase (false) or imported (true)
    balances: AccountBalances;
}

export interface Accounts {
    [address: string]: AccountInfo;
}

export interface AccountTrackerState {
    accounts: Accounts;
    isAccountTrackerLoading: boolean;
}

export enum AccountTrackerEvents {
    ACCOUNT_ADDED = 'ACCOUNT_ADDED',
    ACCOUNT_REMOVED = 'ACCOUNT_REMOVED',
    CLEARED_ACCOUNTS = 'CLEARED_ACCOUNTS',
}

export class AccountTrackerController extends BaseController<AccountTrackerState> {
    private readonly _mutex: Mutex;
    constructor(
        private readonly _keyringController: KeyringControllerDerivated,
        private readonly _networkController: NetworkController,
        private readonly _tokenController: TokenController,
        private readonly _tokenOperationsController: TokenOperationsController,
        initialState: AccountTrackerState = {
            accounts: {},
            isAccountTrackerLoading: false,
        }
    ) {
        super(initialState);
        this._mutex = new Mutex();

        _networkController.on(NetworkEvents.NETWORK_CHANGE, async () => {
            this.store.updateState({ isAccountTrackerLoading: true });
            try {
                // Update the account balances
                await this.updateAccounts(
                    Object.keys(this.store.getState().accounts)
                );
            } catch (err) {
                log.warn(
                    'An error ocurred while updating the accounts',
                    err.message
                );
            } finally {
                this.store.updateState({ isAccountTrackerLoading: false });
            }
        });
        _tokenController.on(
            TokenControllerEvents.USER_TOKEN_CHANGE,
            async () => {
                try {
                    // Update the account balances
                    await this.updateAccounts();
                } catch (err) {
                    log.warn(
                        'An error ocurred while updating the accouns',
                        err.message
                    );
                }
            }
        );
    }

    /**
     * Adds the primary account to the account tracker
     *
     * @param address account address
     * @param name new name
     */
    public addPrimaryAccount(address: string): void {
        // Checksum address
        address = toChecksumAddress(address);

        const primaryAccountInfo: AccountInfo = {
            address,
            name: 'Account 1',
            external: false,
            index: 0, // first account
            balances: {},
        };

        this.store.updateState({
            accounts: { [address]: primaryAccountInfo },
        });

        // Emit account update
        this.emit(AccountTrackerEvents.ACCOUNT_ADDED, address);

        this.updateAccounts();
    }

    /**
     * Creates a new account
     *
     * @param name new account's name
     */
    public async createAccount(name: string): Promise<AccountInfo> {
        // Create the account in vault
        const account = await this._keyringController.createAccount();

        // Get new created account
        const newAccount = toChecksumAddress(account);

        // Get current accounts
        const trackedAccounts = this.store.getState().accounts;

        // Calculates new account index
        const accountIndex = this._getNewAccountIndex(trackedAccounts);

        // Add new account to the account tracker
        const accountInfo: AccountInfo = {
            address: newAccount,
            name: name,
            index: accountIndex,
            external: false,
            balances: {},
        };
        trackedAccounts[newAccount] = accountInfo;

        // Update state
        this.store.updateState({
            accounts: trackedAccounts,
        });

        await this.updateAccounts([newAccount]);

        // Emit account update
        this.emit(AccountTrackerEvents.ACCOUNT_ADDED, newAccount);

        return accountInfo;
    }

    /**
     * Imports an account with the specified import strategy.
     * Each strategy represents a different way of serializing an Ethereum key pair.
     *
     * @param {ImportStrategy} strategy - A unique identifier for an account import strategy.
     * @param {ImportArguments} args - The data required by that strategy to import an account.
     */
    public async importAccount(
        strategy: ImportStrategy,
        importArgs: ImportArguments[typeof strategy],
        name: string
    ): Promise<AccountInfo> {
        const privateKey = await importHandler[strategy](
            importArgs as {
                privateKey: string;
                input: string;
                password: string;
            }
        );

        const newAccount = toChecksumAddress(
            await this._keyringController.importAccount(privateKey)
        );

        // Get current tracked accounts
        const trackedAccounts = this.store.getState().accounts;

        // Calculates new account index
        const accountIndex = this._getNewAccountIndex(trackedAccounts);

        // Add new account to the account tracker
        const accountInfo: AccountInfo = {
            address: newAccount,
            name: name,
            external: true, // imported account
            index: accountIndex,
            balances: {},
        };
        trackedAccounts[newAccount] = accountInfo;

        // Update state
        this.store.updateState({
            accounts: trackedAccounts,
        });

        await this.updateAccounts([newAccount]);

        // Emit account update
        this.emit(AccountTrackerEvents.ACCOUNT_ADDED, newAccount);

        return accountInfo;
    }

    /**
     * Removes account
     *
     * @param address - account to be removed
     */
    public async removeAccount(address: string): Promise<void> {
        const { accounts } = this.store.getState();

        if (!accounts[address]) {
            throw new Error('Account not found');
        }

        // Remove from account tracker
        delete accounts[address];

        // Update state
        this.store.updateState({ accounts });

        // Emit account removal
        this.emit(AccountTrackerEvents.ACCOUNT_REMOVED, address);
    }

    /**
     * Renames selected account
     *
     * @param address account address
     * @param name new name
     */
    public renameAccount(address: string, name: string): void {
        const { accounts } = this.store.getState();

        if (!accounts[address]) {
            throw new Error('Account not found');
        }

        accounts[address] = { ...accounts[address], name: name };

        // save accounts state
        this.store.updateState({ accounts });
    }

    /**
     * BalanceChecker is deployed on main eth (test)nets and requires a single call.
     * For all other networks, call this._updateAccount for each account in state.
     * if @param addresses is present this method will only update those accounts.
     *
     * @returns {Promise<void | void[]>} - After all account balances updated
     * @param {string[]?} addresses
     */
    public async updateAccounts(addresses?: string[]): Promise<void> {
        const release = !addresses
            ? await this._mutex.acquire()
            : () => {
                  return;
              };

        try {
            // Get addresses from state
            const _addresses =
                addresses || Object.keys(this.store.getState().accounts);

            // Get network chainId
            const { chainId } = this._networkController.network;

            // Provider is immutable, so reference won't be lost
            const provider = this._networkController.getProvider();

            // Tokens to fetch balance
            const assetAddressToGetBalance = [
                NATIVE_TOKEN_ADDRESS,
                ...(await this._tokenController.getContractAddresses(chainId)),
            ];

            for (let i = 0; i < _addresses.length; i++) {
                // If the chain changed we abort these operations
                if (chainId == this._networkController.network.chainId) {
                    // Set $BLANK as visible on network change if available
                    await this._tokenController.setBlankToken(
                        _addresses[i],
                        chainId
                    );
                    await this._updateAccountBalance(
                        chainId,
                        provider,
                        _addresses[i],
                        assetAddressToGetBalance
                    );
                }
            }

            return;
        } finally {
            release();
        }
    }

    /**
     * Updates current address balances from balanceChecker deployed contract instance.
     *
     * @param {number} chainId
     * @param provider
     * @param {string} accountAddress
     * @param {string[]} assetAddressToGetBalance
     */
    private async _updateAccountBalance(
        chainId: number,
        provider:
            | ethers.providers.InfuraProvider
            | ethers.providers.StaticJsonRpcProvider,
        accountAddress: string,
        assetAddressToGetBalance: string[]
    ) {
        // We try to fetch the balances from the SingleBalancesContract and fallback
        // to the regular getBalances call in case it fails or it is not available.
        try {
            const zero = BigNumber.from('0x00');

            // Clean the current data.
            const account = cloneDeep(
                this.store.getState().accounts[accountAddress]
            );
            if (!account.balances) {
                account.balances = {};
            }
            account.balances[chainId] = {
                nativeTokenBalance: zero,
                tokens: {},
            } as AccountBalance;

            // Adding the user custom tokens to the list
            const userTokens =
                await this._tokenController.getUserTokenContractAddresses(
                    accountAddress,
                    chainId
                );

            userTokens.forEach((token) => {
                if (!assetAddressToGetBalance.includes(token)) {
                    assetAddressToGetBalance.push(token);
                }
            });

            // Removing the deleted tokens
            const deletedUserTokens =
                await this._tokenController.getDeletedUserTokenContractAddresses(
                    accountAddress,
                    chainId
                );

            deletedUserTokens.forEach((token) => {
                const i = assetAddressToGetBalance.indexOf(token);
                if (i > -1) {
                    assetAddressToGetBalance.splice(i, 1);
                }
            });

            // We should keep this calls splitted by account because the limit of gas of the block:
            /*
                "The current block gas limit is around 8 million, and this function uses approximately 500,000 gas per 100 balances.
                So you should limit yourself to around 1,000 total balance calls (addresses * tokens)"

                https://medium.com/@wbobeirne/get-all-eth-token-balances-for-multiple-addresses-in-a-single-node-call-4d0bcd1e5625
            */

            const balances = await this._getAddressBalances(
                chainId,
                provider,
                accountAddress,
                assetAddressToGetBalance
            );

            for (const tokenAddress in balances) {
                const balance = balances[tokenAddress];

                // eth: always visible
                if (this._tokenController.isNativeToken(tokenAddress)) {
                    account.balances[chainId].nativeTokenBalance = balance;
                } else {
                    if (balance.gt(zero) || userTokens.includes(tokenAddress)) {
                        // Ensure Token is added to accounts object
                        const token = await this._tokenController.getToken(
                            tokenAddress,
                            accountAddress,
                            chainId
                        );

                        if (token) {
                            if (
                                balance.gt(zero) &&
                                !userTokens.includes(tokenAddress)
                            ) {
                                await this._tokenController.addCustomToken(
                                    token,
                                    accountAddress,
                                    chainId,
                                    true
                                );
                            }

                            account.balances[chainId].tokens[tokenAddress] = {
                                token,
                                balance,
                            };
                        }
                    }
                }
            }

            this.store.updateState({
                accounts: {
                    ...this.store.getState().accounts,
                    [accountAddress]: {
                        ...this.store.getState().accounts[accountAddress],
                        balances: {
                            ...this.store.getState().accounts[accountAddress]
                                .balances,
                            [chainId]: account.balances[chainId],
                        },
                    },
                },
            });
        } catch (error) {
            log.warn(
                'Blank Account Tracker single call balance fetch failed',
                error
            );
        }
    }

    /**
     * It tries to fetch the balances from the single call contract but if it is not working or it
     * is not available the fallback will be the individual fetching.
     * @param {number} chainId
     * @param provider
     * @param {string} accountAddress
     * @param {string[]} assetAddressToGetBalance
     * @returns {BalanceMap} A object with all the balances
     */
    private async _getAddressBalances(
        chainId: number,
        provider:
            | ethers.providers.InfuraProvider
            | ethers.providers.StaticJsonRpcProvider,
        accountAddress: string,
        assetAddressToGetBalance: string[]
    ): Promise<BalanceMap> {
        try {
            // If contract is available fetch balances via it, otherwise make call for each one
            if (isSingleCallBalancesContractAvailable(chainId)) {
                try {
                    return getAddressBalancesFromSingleCallBalancesContract(
                        provider,
                        accountAddress,
                        assetAddressToGetBalance,
                        chainId
                    );
                } catch (error) {
                    log.warn(
                        'Error in _getAddressBalances calling getAddressBalancesFromSingleCallBalancesContract',
                        error
                    );
                    return this._getAddressBalancesFromMultipleCallBalances(
                        chainId,
                        provider,
                        accountAddress,
                        assetAddressToGetBalance
                    );
                }
            } else {
                return this._getAddressBalancesFromMultipleCallBalances(
                    chainId,
                    provider,
                    accountAddress,
                    assetAddressToGetBalance
                );
            }
        } catch (error) {
            log.warn('Error in _getAddressBalances', error);
            throw error;
        }
    }

    /**
     * It fetches the balances one by one from the asset contract
     * @param provider
     * @param {string} accountAddress
     * @param {string[]} assetAddressToGetBalance
     * @returns {BalanceMap} A object with all the balances
     */
    private async _getAddressBalancesFromMultipleCallBalances(
        chainId: number,
        provider:
            | ethers.providers.InfuraProvider
            | ethers.providers.StaticJsonRpcProvider,
        accountAddress: string,
        assetAddressToGetBalance: string[]
    ): Promise<BalanceMap> {
        try {
            const balances: BalanceMap = {};

            if (chainId == 1) {
                // Mainnet has a huge list of tokens so we can't request them all.
                assetAddressToGetBalance = [
                    NATIVE_TOKEN_ADDRESS,
                    ...(await this._tokenController.getUserTokenContractAddresses()),
                ];
            }

            // Get all user's token balances
            const tokenBalances = await Promise.allSettled(
                assetAddressToGetBalance.map((tokenAddress) => {
                    if (this._tokenController.isNativeToken(tokenAddress)) {
                        return provider.getBalance(accountAddress);
                    }
                    return this._tokenOperationsController.balanceOf(
                        tokenAddress,
                        accountAddress
                    );
                })
            );

            tokenBalances.map((balance, i) => {
                if (balance.status === 'fulfilled') {
                    const tokenAddress: string = assetAddressToGetBalance[i];

                    balances[tokenAddress] = balance.value;
                }
            });

            return balances;
        } catch (error) {
            log.warn(
                'Error in _getAddressBalancesFromMultipleCallBalances',
                error
            );
            throw error;
        }
    }

    /**
     * Removes all addresses and associated balances
     *
     */
    public clearAccounts(): void {
        this.store.updateState({
            accounts: initialState.AccountTrackerController.accounts,
        });

        // Emit account removal
        this.emit(AccountTrackerEvents.CLEARED_ACCOUNTS);
    }

    /**
     * getAccountTokens
     *
     * @param accountAddress The account address
     * @returns The list of the specified address tokens
     */
    public getAccountTokens(
        accountAddress: string,
        chainId: number = this._networkController.network.chainId
    ): AccountBalanceTokens {
        if (accountAddress in this.store.getState().accounts) {
            if (
                this.store.getState().accounts[accountAddress].balances &&
                chainId in
                    this.store.getState().accounts[accountAddress].balances
            ) {
                return this.store.getState().accounts[accountAddress].balances[
                    chainId
                ].tokens;
            }
        }
        return {} as AccountBalanceTokens;
    }

    /**
     * It returns an account by its Keyring index
     *
     * @param accountIndex The account index
     */
    public async getAccountByIndex(accountIndex: number): Promise<AccountInfo> {
        // If it's an account index retrieve address from Keyring
        const accounts = await this._keyringController.getAccounts();

        if (!(accountIndex in accounts)) {
            throw new Error('Invalid account index');
        }

        const accountAddress = accounts[accountIndex];
        return this.store.getState().accounts[accountAddress] as AccountInfo;
    }

    /**
     * Calculates the next account index to use when creating or importing a new one.
     * @param accounts collection of stored accounts
     * @returns index
     */
    private _getNewAccountIndex(accounts: {
        [address: string]: AccountInfo;
    }): number {
        return (
            Math.max(
                ...Object.values(accounts).map(function (a) {
                    return a.index;
                })
            ) + 1
        );
    }
}
