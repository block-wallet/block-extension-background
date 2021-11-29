import { BlankAppState } from '../../../../src/utils/constants/initialState';
import { BigNumber } from '@ethersproject/bignumber';
import reconcileState from '../../../../src/infrastructure/stores/migrator/reconcileState';
import { expect } from 'chai';
import { INITIAL_NETWORKS } from '@blank/background/utils/constants/networks';
import { AddressBook } from '@blank/background/controllers/AddressBookController';
import { TransactionControllerState } from '@blank/background/controllers/transactions/TransactionController';

const persistedState = {
    AddressBookController: {
        addressBook: {} as AddressBook,
        recentAddresses: {} as AddressBook,
    },
    AccountTrackerController: {
        isAccountTrackerLoading: false,
        accounts: {
            '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb': {
                address: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
                balance: BigNumber.from(0),
                name: 'Account1',
            },

            '0xd7d4e99b3e796a528590f5f6b84c2b2f967e7ccb': {
                address: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
                balance: BigNumber.from(0),
                name: 'Account2',
            },
        },
    },
    AppStateController: {
        idleTimeout: 5,
        lastActiveTime: 100000,
    },
    BlankDepositController: {
        pendingWithdrawals: {
            goerli: { pending: [] },
            mainnet: { pending: [] },
        },
        vaultState: {
            vault: 'encrypted-deposits-vault',
        },
    },
    ExchangeRatesController: {
        exchangeRates: { ETH: 2786.23, USDT: 1 },
        networkNativeCurrency: {
            symbol: 'ETH',
            // Default Coingecko id for ETH rates
            coingeckoCurrencyId: 'ethereum',
        },
    },
    GasPricesController: {
        gasPriceData: {
            5: {
                gasPrices: {
                    average: BigNumber.from('2000000000'),
                    fast: BigNumber.from('2000000000'),
                    slow: BigNumber.from('2000000000'),
                },
            },
        },
    },
    IncomingTransactionController: {
        incomingTransactions: {
            '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb': {} as any,
            '0xd7d4e99b3e796a528590f5f6b84c2b2f967e7ccb': {} as any,
        },
    },
    KeyringController: {
        isUnlocked: false,
        keyringTypes: {},
        keyrings: [],
        vault: 'encrypted-vault',
    },
    OnboardingController: { isOnboarded: true, isSeedPhraseBackedUp: false },
    PreferencesController: {
        localeInfo: 'en-GB',
        nativeCurrency: 'GBP',
        selectedAddress: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
        showTestNetworks: true,
        userTokens: { USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
    },
    NetworkController: {
        selectedNetwork: 'mainnet',
        isNetworkChanging: false,
        isUserNetworkOnline: true,
        isProviderNetworkOnline: true,
    },
    TransactionController: { transactions: [] },
    BlockUpdatesController: { blockData: { 5: -1 } },
};

const initialState: BlankAppState & {
    OnboardingController: { newAddedKeyOnLevel2: boolean };
    PreferencesController: { newAddedKeyOnLevel2: string };
} = {
    BlockUpdatesController: { blockData: { 5: -1 } },
    AddressBookController: {
        addressBook: {} as AddressBook,
        recentAddresses: {} as AddressBook,
    },
    PermissionsController: {
        permissions: {},
        permissionRequests: {},
    },
    AccountTrackerController: {
        isAccountTrackerLoading: false,
        accounts: {},
    },
    AppStateController: {
        idleTimeout: 5,
        lastActiveTime: 100000,
    },
    KeyringController: {
        isUnlocked: false,
        keyringTypes: {},
        keyrings: [],
        vault: '',
    },
    NetworkController: {
        selectedNetwork: 'mainnet',
        availableNetworks: INITIAL_NETWORKS,
        isNetworkChanging: false,
        isUserNetworkOnline: true,
        isProviderNetworkOnline: true,
    },
    OnboardingController: {
        isOnboarded: false,
        isSeedPhraseBackedUp: false,
        newAddedKeyOnLevel2: false,
    },
    PreferencesController: {
        selectedAddress: '',
        localeInfo: 'en-US',
        nativeCurrency: 'usd',
        newAddedKeyOnLevel2: '',
        showTestNetworks: false,
        popupTab: 'activity',
        settings: { hideAddressWarning: false },
    },
    TransactionController: {
        transactions: [],
    } as TransactionControllerState,
    BlankDepositController: {
        vaultState: { vault: '' },
        pendingWithdrawals: {
            mainnet: { pending: [] },
            goerli: { pending: [] },
        },
    },
    ExchangeRatesController: {
        exchangeRates: { ETH: 0, DAI: 0 }, // DAI shouldn't be added (level 3)
        networkNativeCurrency: {
            symbol: 'ETH',
            // Default Coingecko id for ETH rates
            coingeckoPlatformId: 'ethereum',
        },
    },
    GasPricesController: {
        gasPriceData: {
            5: {
                gasPrices: {
                    average: { gasPrice: BigNumber.from(0) },
                    fast: { gasPrice: BigNumber.from(0) },
                    slow: { gasPrice: BigNumber.from(0) },
                },
            },
        },
    },
    IncomingTransactionController: {
        incomingTransactions: {},
    },
    TokenController: {
        userTokens: {} as any,
        deletedUserTokens: {} as any,
    },
};

describe('State reconciler', () => {
    it('Should reconcile two levels of the persisted state with the initial state correctly', () => {
        const newState = reconcileState<any>(persistedState, initialState);
        expect(newState).to.be.deep.equal({
            BlockUpdatesController: { blockData: { 5: -1 } },
            AddressBookController: {
                addressBook: {} as AddressBook,
                recentAddresses: {} as AddressBook,
            },
            AccountTrackerController: {
                isAccountTrackerLoading: false,
                accounts: {
                    '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb': {
                        address: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
                        balance: BigNumber.from(0),
                        name: 'Account1',
                    },

                    '0xd7d4e99b3e796a528590f5f6b84c2b2f967e7ccb': {
                        address: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
                        balance: BigNumber.from(0),
                        name: 'Account2',
                    },
                },
            },
            AppStateController: {
                idleTimeout: 5,
                lastActiveTime: 100000,
            },
            BlankDepositController: {
                pendingWithdrawals: {
                    goerli: { pending: [] },
                    mainnet: { pending: [] },
                },
                vaultState: {
                    vault: 'encrypted-deposits-vault',
                },
            },
            ExchangeRatesController: {
                exchangeRates: { ETH: 2786.23, USDT: 1 },
                networkNativeCurrency: {
                    symbol: 'ETH',
                    // Default Coingecko id for ETH rates
                    coingeckoCurrencyId: 'ethereum',
                },
            },
            GasPricesController: {
                gasPriceData: {
                    5: {
                        gasPrices: {
                            average: BigNumber.from('2000000000'),
                            fast: BigNumber.from('2000000000'),
                            slow: BigNumber.from('2000000000'),
                        },
                    },
                },
            },
            IncomingTransactionController: {
                incomingTransactions: {
                    '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb': {} as any,
                    '0xd7d4e99b3e796a528590f5f6b84c2b2f967e7ccb': {} as any,
                },
            },
            KeyringController: {
                isUnlocked: false,
                keyringTypes: {},
                keyrings: [],
                vault: 'encrypted-vault',
            },
            OnboardingController: {
                isOnboarded: true,
                isSeedPhraseBackedUp: false,
                newAddedKeyOnLevel2: false,
            },
            NetworkController: {
                selectedNetwork: 'mainnet',
                availableNetworks: INITIAL_NETWORKS,
                isNetworkChanging: false,
                isUserNetworkOnline: true,
                isProviderNetworkOnline: true,
            },
            PreferencesController: {
                localeInfo: 'en-GB',
                nativeCurrency: 'GBP',
                selectedAddress: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
                newAddedKeyOnLevel2: '',
                userTokens: {
                    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
                },
                showTestNetworks: true,
                popupTab: 'activity',
                settings: {
                    hideAddressWarning: false,
                },
            },
            TransactionController: {
                transactions: [],
                // unapprovedTransactions: {},
            },
            TokenController: {
                userTokens: {},
                deletedUserTokens: {},
            },
            PermissionsController: {
                permissions: {},
                permissionRequests: {},
            },
        });
    });
});
