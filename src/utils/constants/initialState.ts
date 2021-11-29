import {
    KeyringControllerState,
    KeyringControllerMemState,
} from 'eth-keyring-controller';
import { ValuesOf } from '../types/helpers';
import { IObservableStore } from '../../infrastructure/stores/ObservableStore';

import { AccountTrackerState } from '../../controllers/AccountTrackerController';
import {
    AppStateControllerMemState,
    AppStateControllerState,
} from '../../controllers/AppStateController';
import { OnboardingControllerState } from '../../controllers/OnboardingController';
import { PreferencesControllerState } from '../../controllers/PreferencesController';
import {
    BlankDepositControllerStoreState,
    BlankDepositControllerUIStoreState,
} from '../../controllers/blank-deposit/BlankDepositController';
import { ExchangeRatesControllerState } from '../../controllers/ExchangeRatesController';
import { GasPricesControllerState } from '../../controllers/GasPricesController';
import { BigNumber } from '@ethersproject/bignumber';

import { TokenControllerState } from '../../controllers/erc-20/TokenController';
import { IncomingTransactionControllerState } from '../../controllers/IncomingTransactionController';
import { INITIAL_NETWORKS } from './networks';
import { IActivityListState } from '../../controllers/ActivityListController';
import { PermissionsControllerState } from '../../controllers/PermissionsController';

import {
    AddressBook,
    AddressBookControllerMemState,
} from '@blank/background/controllers/AddressBookController';
import { BlankProviderControllerState } from '@blank/background/controllers/BlankProviderController';
import { IAccountTokens } from '@blank/background/controllers/erc-20/Token';
import { NetworkControllerState } from '../../controllers/NetworkController';
import { BlockUpdatesControllerState } from '@blank/background/controllers/BlockUpdatesController';
import {
    TransactionControllerState,
    TransactionVolatileControllerState,
} from '@blank/background/controllers/transactions/TransactionController';

export type BlankAppState = {
    AccountTrackerController: AccountTrackerState;
    AppStateController: AppStateControllerState;
    KeyringController: KeyringControllerState;
    OnboardingController: OnboardingControllerState;
    PreferencesController: PreferencesControllerState;
    TransactionController: TransactionControllerState;
    BlankDepositController: BlankDepositControllerStoreState;
    BlockUpdatesController: BlockUpdatesControllerState;
    ExchangeRatesController: ExchangeRatesControllerState;
    GasPricesController: GasPricesControllerState;
    IncomingTransactionController: IncomingTransactionControllerState;
    TokenController: TokenControllerState;
    PermissionsController: PermissionsControllerState;
    NetworkController: NetworkControllerState;
    AddressBookController: AddressBookControllerMemState;
};

export type BlankAppUIState = {
    AccountTrackerController: AccountTrackerState;
    AppStateController: AppStateControllerMemState;
    KeyringController: KeyringControllerMemState;
    OnboardingController: OnboardingControllerState;
    PreferencesController: PreferencesControllerState;
    TransactionController: TransactionVolatileControllerState;
    BlankDepositController: BlankDepositControllerUIStoreState;
    BlockUpdatesController: BlockUpdatesControllerState;
    ExchangeRatesController: ExchangeRatesControllerState;
    GasPricesController: GasPricesControllerState;
    IncomingTransactionController: IncomingTransactionControllerState;
    ActivityListController: IActivityListState;
    TokenController: TokenControllerState;
    PermissionsController: PermissionsControllerState;
    NetworkController: NetworkControllerState;
    AddressBookController: AddressBookControllerMemState;
    BlankProviderController: BlankProviderControllerState;
};

export type BlankAppStoreConfig<S> = {
    [controller in keyof Partial<S>]: IObservableStore<ValuesOf<S>>;
};

const initialState: BlankAppState = {
    AddressBookController: {
        addressBook: {} as AddressBook,
        recentAddresses: {} as AddressBook,
    },
    AccountTrackerController: {
        accounts: {},
        isAccountTrackerLoading: false,
    },
    AppStateController: {
        idleTimeout: 5,
        lastActiveTime: new Date().getTime(),
    },
    BlockUpdatesController: { blockData: {} },
    KeyringController: {
        isUnlocked: false,
        keyringTypes: {},
        keyrings: [],
        vault: '',
    },
    OnboardingController: {
        isOnboarded: false,
        isSeedPhraseBackedUp: false,
    },
    PreferencesController: {
        selectedAddress: '',
        localeInfo: 'en-US',
        nativeCurrency: 'usd',
        showTestNetworks: false,
        popupTab: 'activity',
        settings: {
            hideAddressWarning: false, // Shown by default
        },
    },
    TransactionController: {
        transactions: [],
    },
    BlankDepositController: {
        vaultState: { vault: '' },
        pendingWithdrawals: {
            mainnet: { pending: [] },
            goerli: { pending: [] },
        },
    },
    NetworkController: {
        selectedNetwork: 'mainnet',
        availableNetworks: INITIAL_NETWORKS,
        isNetworkChanging: false,
        isUserNetworkOnline: true,
        isProviderNetworkOnline: true,
    },
    ExchangeRatesController: {
        exchangeRates: { ETH: 0 },
        networkNativeCurrency: {
            symbol: 'ETH',
            // Default Coingecko id for ETH rates
            coingeckoPlatformId: 'ethereum',
        },
    },
    GasPricesController: {
        gasPriceData: {
            1: {
                gasPrices: {
                    average: { gasPrice: BigNumber.from(0) },
                    fast: { gasPrice: BigNumber.from(0) },
                    slow: { gasPrice: BigNumber.from(0) },
                },
                isEIP1559Compatible: undefined,
            },
        },
    },
    IncomingTransactionController: {
        incomingTransactions: {},
    },
    TokenController: {
        userTokens: {} as IAccountTokens,
        deletedUserTokens: {} as IAccountTokens,
    },
    PermissionsController: {
        permissions: {},
        permissionRequests: {},
    },
};

export default initialState;
