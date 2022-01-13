/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Explicitly disabled no-empty-pattern on this file as some actions need generic param typing but receive empty objects.
/* eslint-disable no-empty-pattern */
import type {
    ExternalEventSubscription,
    MessageTypes,
    RequestAccountCreate,
    RequestAccountExportJson,
    RequestAccountExportPK,
    RequestAccountImportJson,
    RequestAccountImportPK,
    RequestAccountRemove,
    RequestAccountRename,
    RequestAccountSelect,
    RequestAddNewSiteWithPermissions,
    RequestAppUnlock,
    RequestBlankCompliance,
    RequestBlankCurrencyDepositsCount,
    RequestBlankDeposit,
    RequestBlankGetDepositNoteString,
    RequestBlankWithdrawalFees,
    RequestBlankHasDepositedFromAddress,
    RequestEnsResolve,
    RequestEnsLookup,
    RequestConfirmPermission,
    RequestConfirmTransaction,
    RequestSendToken,
    RequestGetTokens,
    RequestGetToken,
    RequestGetTokenBalance,
    RequestAddCustomToken,
    RequestAddCustomTokens,
    RequestGetUserTokens,
    RequestPopulateTokenData,
    RequestBlankPairDepositsCount,
    RequestBlankWithdraw,
    RequestExternalRequest,
    RequestGetAccountPermissions,
    RequestNetworkChange,
    RequestPasswordVerify,
    RequestRemoveAccountFromSite,
    RequestSeedPhrase,
    RequestSendEther,
    RequestTypes,
    RequestUpdateSitePermissions,
    RequestVerifySeedPhrase,
    RequestWalletCreate,
    RequestWalletImport,
    RequestIsSwapApproved,
    RequestApproveSwap,
    RequestGetSwapQuote,
    RequestGetSwap,
    RequestExecuteSwap,
    ResponseType,
    SubscriptionMessageTypes,
    TransportRequestMessage,
    RequestSearchToken,
    RequestShowTestNetworks,
    RequestUpdatePopupTab,
    RequestAddAsNewDepositTransaction,
    RequestUpdateDepositTransactionGas,
    RequestApproveDepositTransaction,
    RequestGetDepositTransactionResult,
    RequestCalculateDepositTransactionGasLimit,
    RequestAddAsNewSendTransaction,
    RequestUpdateSendTransactionGas,
    RequestApproveSendTransaction,
    RequestSendTransactionResult,
    RequestCalculateSendTransactionGasLimit,
    RequestRejectTransaction,
    RequestSetIdleTimeout,
    RequestSetMetadata,
    RequestBlankGetInstanceTokenAllowance,
    RequestCalculateApproveTransactionGasLimit,
    RequestDeleteCustomToken,
    RequestAddressBookGetByAddress,
    RequestAddressBookGet,
    RequestAddressBookSet,
    RequestAddressBookDelete,
    RequestAddressBookClear,
    RequestAddressBookGetRecentAddresses,
    RequestCompleteSetup,
    RequestAddNetwork,
    RequestBlankGetLatestDepositDate,
    RequestConfirmDappRequest,
    RequestWalletReset,
    RequestUserSettings,
    RequestCancelTransaction,
    RequestSpeedUpTransaction,
    RequestNextNonce,
} from '../utils/types/communication';

import EventEmitter from 'events';
import { BigNumber, utils } from 'ethers';
import BlankStorageStore from '../infrastructure/stores/BlankStorageStore';
import { Flatten } from '../utils/types/helpers';
import { Messages } from '../utils/types/communication';
import { TransactionMeta } from './transactions/utils/types';
import {
    BlankAppState,
    BlankAppUIState,
} from '../utils/constants/initialState';
import AppStateController from './AppStateController';
import OnboardingController from './OnboardingController';
import BlankProviderController, {
    BlankProviderEvents,
} from './BlankProviderController';
import NetworkController from './NetworkController';
import PermissionsController from './PermissionsController';
import { EnsController } from './EnsController';
import TransactionController, {
    SEND_GAS_COST,
    TransactionGasEstimation,
} from './transactions/TransactionController';
import { PreferencesController } from './PreferencesController';
import { ExchangeRatesController } from './ExchangeRatesController';
import {
    AccountInfo,
    AccountTrackerController,
} from './AccountTrackerController';
import { BlankDepositController } from './blank-deposit/BlankDepositController';

import { GasPricesController } from './GasPricesController';
import { IncomingTransactionController } from './IncomingTransactionController';
import {
    TokenController,
    TokenControllerProps,
} from './erc-20/TokenController';
import { SwapController, Swap } from './SwapController';
import { ITokens, Token } from './erc-20/Token';
import { ImportStrategy, getAccountJson } from '../utils/account';
import { ActivityListController } from './ActivityListController';
import {
    TransferTransaction,
    TransferTransactionPopulatedTransactionParams,
} from './erc-20/transactions/TransferTransaction';
import { TokenOperationsController } from './erc-20/transactions/Transaction';
import { ProviderEvents, ProviderSetupData } from '@blank/provider/types';
import { ApproveTransaction } from './erc-20/transactions/ApproveTransaction';
import {
    AddressBookController,
    AddressBookEntry,
    NetworkAddressBook,
} from './AddressBookController';

import KeyringControllerDerivated from './KeyringControllerDerivated';

import { showSetUpCompleteNotification } from '../utils/notifications';
import { extensionInstances } from '../infrastructure/connection';
import {
    focusWindow,
    openExtensionInBrowser,
    switchToTab,
    closeTab,
} from '../utils/window';
import log from 'loglevel';
import BlockUpdatesController from './BlockUpdatesController';
import { TornadoEventsService } from './blank-deposit/tornado/TornadoEventsService';

import tornadoConfig from './blank-deposit/tornado/config/config';
import ComposedStore from '../infrastructure/stores/ComposedStore';
import BlockFetchController from './BlockFetchController';

export interface BlankControllerProps {
    initState: BlankAppState;
    blankStateStore: BlankStorageStore;
    devTools?: any;
    encryptor?: any;
}

export default class BlankController extends EventEmitter {
    // Controllers
    private readonly appStateController: AppStateController;
    private readonly onboardingController: OnboardingController;
    private readonly networkController: NetworkController;
    private readonly ensController: EnsController;
    private readonly keyringController: KeyringControllerDerivated;
    private readonly accountTrackerController: AccountTrackerController;
    private readonly preferencesController: PreferencesController;
    private readonly transactionController: TransactionController;
    private readonly incomingTransactionController: IncomingTransactionController;
    private readonly tornadoEventsService: TornadoEventsService;
    private readonly blankDepositController: BlankDepositController;
    private readonly exchangeRatesController: ExchangeRatesController;
    private readonly gasPricesController: GasPricesController;
    private readonly blankStateStore: BlankStorageStore;
    private readonly tokenOperationsController: TokenOperationsController;
    private readonly tokenController: TokenController;
    private readonly swapController: SwapController;
    private readonly blankProviderController: BlankProviderController;
    private readonly activityListController: ActivityListController;
    private readonly permissionsController: PermissionsController;
    private readonly addressBookController: AddressBookController;
    private readonly blockFetchController: BlockFetchController;
    private readonly blockUpdatesController: BlockUpdatesController;

    // Stores
    private readonly store: ComposedStore<BlankAppState>;
    private readonly UIStore: ComposedStore<BlankAppUIState>;

    private readonly _devTools: any;

    private subscriptions: Record<string, chrome.runtime.Port>;
    private isSetupComplete: boolean;

    constructor(props: BlankControllerProps) {
        super();

        const initState = props.initState;

        this.subscriptions = {};

        this.isSetupComplete = false;

        this._devTools = props.devTools;

        this.blankStateStore = props.blankStateStore;

        // Controllers Initialization
        this.preferencesController = new PreferencesController({
            initState: initState.PreferencesController,
        });

        this.networkController = new NetworkController(
            initState.NetworkController
        );

        this.keyringController = new KeyringControllerDerivated({
            initState: initState.KeyringController,
            encryptor: props.encryptor || undefined,
        });

        this.ensController = new EnsController({
            networkController: this.networkController,
        });

        this.permissionsController = new PermissionsController(
            initState.PermissionsController,
            this.preferencesController
        );

        this.gasPricesController = new GasPricesController(
            initState.GasPricesController,
            this.networkController
        );

        this.tokenOperationsController = new TokenOperationsController({
            networkController: this.networkController,
        });

        this.tokenController = new TokenController(initState.TokenController, {
            tokenOperationsController: this.tokenOperationsController,
            preferencesController: this.preferencesController,
            networkController: this.networkController,
        } as TokenControllerProps);

        this.onboardingController = new OnboardingController(
            initState.OnboardingController,
            this.keyringController
        );

        this.exchangeRatesController = new ExchangeRatesController(
            initState.ExchangeRatesController,
            this.preferencesController,
            this.networkController,
            () => {
                return this.accountTrackerController.getAccountTokens(
                    this.preferencesController.getSelectedAddress()
                );
            }
        );

        this.accountTrackerController = new AccountTrackerController(
            this.keyringController,
            this.networkController,
            this.tokenController,
            this.tokenOperationsController,
            this.preferencesController,
            initState.AccountTrackerController
        );

        this.incomingTransactionController = new IncomingTransactionController(
            this.networkController,
            this.preferencesController,
            this.accountTrackerController,
            initState.IncomingTransactionController
        );

        this.transactionController = new TransactionController(
            this.networkController,
            this.preferencesController,
            this.permissionsController,
            this.gasPricesController,
            initState.TransactionController,
            this.keyringController.signTransaction.bind(this.keyringController)
        );

        this.blockFetchController = new BlockFetchController(
            this.networkController,
            initState.BlockFetchController
        );

        this.blockUpdatesController = new BlockUpdatesController(
            this.networkController,
            this.accountTrackerController,
            this.gasPricesController,
            this.exchangeRatesController,
            this.incomingTransactionController,
            this.transactionController,
            this.blockFetchController,
            initState.BlockUpdatesController
        );

        this.swapController = new SwapController({
            networkController: this.networkController,
            gasPricesController: this.gasPricesController,
            preferencesController: this.preferencesController,
            transactionController: this.transactionController,
            tokenOperationsController: this.tokenOperationsController,
        });

        this.tornadoEventsService = new TornadoEventsService({
            ...tornadoConfig.tornadoEventsService,
            blockUpdatesController: this.blockUpdatesController,
        });

        this.blankDepositController = new BlankDepositController({
            networkController: this.networkController,
            preferencesController: this.preferencesController,
            transactionController: this.transactionController,
            tokenOperationsController: this.tokenOperationsController,
            tokenController: this.tokenController,
            gasPricesController: this.gasPricesController,
            tornadoEventsService: this.tornadoEventsService,
            initialState: initState.BlankDepositController,
        });

        this.activityListController = new ActivityListController(
            this.transactionController,
            this.blankDepositController,
            this.incomingTransactionController,
            this.preferencesController,
            this.networkController
        );

        this.appStateController = new AppStateController(
            initState.AppStateController,
            this.keyringController,
            this.blankDepositController
        );

        this.blankProviderController = new BlankProviderController(
            this.networkController,
            this.transactionController,
            this.permissionsController,
            this.appStateController,
            this.keyringController,
            this.tokenController
        );

        this.addressBookController = new AddressBookController({
            initialState: initState.AddressBookController,
            networkController: this.networkController,
            activityListController: this.activityListController,
            preferencesController: this.preferencesController,
        });

        this.store = new ComposedStore<BlankAppState>({
            NetworkController: this.networkController.store,
            AppStateController: this.appStateController.store,
            OnboardingController: this.onboardingController.store,
            KeyringController: this.keyringController.store,
            AccountTrackerController: this.accountTrackerController.store,
            PreferencesController: this.preferencesController.store,
            TransactionController: this.transactionController.store,
            ExchangeRatesController: this.exchangeRatesController.store,
            GasPricesController: this.gasPricesController.store,
            BlankDepositController: this.blankDepositController.store,
            IncomingTransactionController:
                this.incomingTransactionController.store,
            TokenController: this.tokenController.store,
            PermissionsController: this.permissionsController.store,
            AddressBookController: this.addressBookController.store,
            BlockUpdatesController: this.blockUpdatesController.store,
            BlockFetchController: this.blockFetchController.store,
        });

        this.UIStore = new ComposedStore<BlankAppUIState>({
            NetworkController: this.networkController.store,
            AppStateController: this.appStateController.UIStore,
            OnboardingController: this.onboardingController.store,
            KeyringController: this.keyringController.memStore,
            AccountTrackerController: this.accountTrackerController.store,
            PreferencesController: this.preferencesController.store,
            TransactionController: this.transactionController.UIStore,
            ExchangeRatesController: this.exchangeRatesController.store,
            GasPricesController: this.gasPricesController.store,
            BlankDepositController: this.blankDepositController.UIStore,
            IncomingTransactionController:
                this.incomingTransactionController.store,
            TokenController: this.tokenController.store,
            ActivityListController: this.activityListController.store,
            PermissionsController: this.permissionsController.store,
            AddressBookController: this.addressBookController.store,
            BlankProviderController: this.blankProviderController.store,
            BlockUpdatesController: this.blockUpdatesController.store,
        });

        // Check controllers on app lock/unlock
        this.appStateController.UIStore.subscribe(() => {
            this.manageControllers();
        });

        // Set storage save on state update
        this.store.subscribe(this.storeState);

        // Set devtools callback on state update
        this.store.subscribe(this.devToolSubscription);
    }

    /**
     * Locally persists the state
     */
    private storeState = (state: Record<string, unknown>) => {
        const blankState = state as BlankAppState;
        this.blankStateStore.set('blankState', blankState);
    };

    /**
     * Manages controllers updates
     */
    private manageControllers() {
        // Get active subscriptions
        const activeSubscriptions = Object.keys(this.subscriptions).length;

        // Check if app is unlocked
        const isAppUnlocked =
            this.appStateController.UIStore.getState().isAppUnlocked;

        // Start/stop controllers
        if (activeSubscriptions > 0 && isAppUnlocked) {
            this.blankDepositController.initialize();
        }

        this.blockUpdatesController.setBlockUpdatesStatus(
            isAppUnlocked,
            activeSubscriptions
        );
    }

    /**
     * Subscription to state updates to send to dev tools
     */
    private devToolSubscription = (state: BlankAppState, action?: string) => {
        if (action && typeof this._devTools !== 'undefined') {
            this._devTools.send(`@@BlankAppState/${action}`, state);
        }
    };

    /**
     * Create subscription method
     */
    private createSubscription<TMessageType extends MessageTypes>(
        id: string,
        port: chrome.runtime.Port
    ): (data: SubscriptionMessageTypes[TMessageType]) => void {
        this.subscriptions[id] = port;

        // Check controllers
        this.manageControllers();

        return (subscription: unknown): void => {
            if (this.subscriptions[id]) {
                port.postMessage({ id, subscription });
            }
        };
    }

    /**
     * Unsubscribe method
     *
     * @param id subscription id
     */
    private unsubscribe(id: string): void {
        if (this.subscriptions[id]) {
            log.debug(`Unsubscribing from ${id}`);

            delete this.subscriptions[id];

            // Check controllers
            this.manageControllers();
        } else {
            log.warn(`Unable to unsubscribe from ${id}`);
        }
    }

    /**
     * Generic message handler
     *
     */
    public handler<TMessageType extends MessageTypes>(
        { id, message, request }: TransportRequestMessage<TMessageType>,
        port: chrome.runtime.Port,
        portId: string
    ): void {
        let isPortConnected = true;
        const from = port.name;
        const source = `${from}: ${id}: ${message}`;

        port.onDisconnect.addListener(() => {
            const error = chrome.runtime.lastError;
            isPortConnected = false;
            if (error) {
                log.error(error);
            }
        });

        log.debug('[in]', source);

        const promise = this.handle(id, message, request, port, portId);

        promise
            .then((response): void => {
                log.debug('[out]', source);

                if (!isPortConnected) {
                    throw new Error('Port has been disconnected');
                }

                port.postMessage({ id, response });
            })
            .catch((error: Error): void => {
                log.error('[err]', source, error.message || error);

                // only send message back to port if it's still connected
                if (isPortConnected) {
                    port.postMessage({ error: error.message || error, id });
                }
            });
    }

    /**
     * Request promise handler
     *
     * @param id request ID
     * @param type message Type
     * @param request request type
     * @param port connection port
     */
    private async handle(
        id: string,
        type: MessageTypes,
        request: RequestTypes[MessageTypes],
        port: chrome.runtime.Port,
        portId: string
    ): Promise<ResponseType<MessageTypes>> {
        switch (type) {
            case Messages.ACCOUNT.CREATE:
                return this.accountCreate(request as RequestAccountCreate);
            case Messages.ACCOUNT.EXPORT_JSON:
                return this.accountExportJson(
                    request as RequestAccountExportJson
                );
            case Messages.ACCOUNT.EXPORT_PRIVATE_KEY:
                return this.accountExportPrivateKey(
                    request as RequestAccountExportPK
                );
            case Messages.ACCOUNT.IMPORT_JSON:
                return this.accountImportJson(
                    request as RequestAccountImportJson
                );
            case Messages.ACCOUNT.IMPORT_PRIVATE_KEY:
                return this.accountImportPrivateKey(
                    request as RequestAccountImportPK
                );
            case Messages.ACCOUNT.REMOVE:
                return this.accountRemove(request as RequestAccountRemove);
            case Messages.ACCOUNT.RENAME:
                return this.accountRename(request as RequestAccountRename);
            case Messages.ACCOUNT.SELECT:
                return this.accountSelect(request as RequestAccountSelect);
            case Messages.APP.GET_IDLE_TIMEOUT:
                return this.getIdleTimeout();
            case Messages.APP.SET_IDLE_TIMEOUT:
                return this.setIdleTimeout(request as RequestSetIdleTimeout);
            case Messages.APP.SET_LAST_USER_ACTIVE_TIME:
                return this.setLastUserActiveTime();
            case Messages.APP.LOCK:
                return this.lockApp();
            case Messages.APP.UNLOCK:
                return this.unlockApp(request as RequestAppUnlock);
            case Messages.APP.RETURN_TO_ONBOARDING:
                return this.returnToOnboarding();
            case Messages.APP.OPEN_RESET:
                return this.openReset();
            case Messages.APP.UPDATE_POPUP_TAB:
                return this.updatePopupTab(request as RequestUpdatePopupTab);
            case Messages.BLANK.DEPOSIT:
                return this.blankDeposit(request as RequestBlankDeposit);
            case Messages.BLANK.ADD_NEW_DEPOSIT_TRANSACTION:
                return this.addAsNewDepositTransaction(
                    request as RequestAddAsNewDepositTransaction
                );
            case Messages.BLANK.UPDATE_DEPOSIT_TRANSACTION_GAS:
                return this.updateDepositTransactionGas(
                    request as RequestUpdateDepositTransactionGas
                );
            case Messages.BLANK.APPROVE_DEPOSIT_TRANSACTIION:
                return this.approveDepositTransaction(
                    request as RequestApproveDepositTransaction
                );
            case Messages.BLANK.GET_DEPOSIT_TRANSACTION_RESULT:
                return this.getDepositTransactionResult(
                    request as RequestGetDepositTransactionResult
                );
            case Messages.BLANK.CALCULATE_DEPOSIT_TRANSACTION_GAS_LIMIT:
                return this.calculateDepositTransactionGasLimit(
                    request as RequestCalculateDepositTransactionGasLimit
                );
            case Messages.BLANK.WITHDRAW:
                return this.blankWithdraw(request as RequestBlankWithdraw);
            case Messages.BLANK.COMPLIANCE:
                return this.getComplianceInformation(
                    request as RequestBlankCompliance
                );
            case Messages.BLANK.PAIR_DEPOSITS_COUNT:
                return this.getPairDepositsCount(
                    request as RequestBlankPairDepositsCount
                );
            case Messages.BLANK.CURRENCY_DEPOSITS_COUNT:
                return this.getCurrencyDepositsCount(
                    request as RequestBlankCurrencyDepositsCount
                );
            case Messages.BLANK.GET_UNSPENT_DEPOSITS:
                return this.getUnspentDeposits();
            case Messages.BLANK.GET_DEPOSIT_NOTE_STRING:
                return this.getDepositNoteString(
                    request as RequestBlankGetDepositNoteString
                );
            case Messages.BLANK.UPDATE_SPENT_NOTES:
                return this.updateNotesSpentState();
            case Messages.BLANK.GET_INSTANCE_ALLOWANCE:
                return this.getTornadoInstanceAllowance(
                    request as RequestBlankGetInstanceTokenAllowance
                );
            case Messages.BLANK.GET_WITHDRAWAL_FEES:
                return this.getWithdrawalFees(
                    request as RequestBlankWithdrawalFees
                );
            case Messages.BLANK.HAS_DEPOSITED_FROM_ADDRESS:
                return this.hasDepositedFromAddress(
                    request as RequestBlankHasDepositedFromAddress
                );
            case Messages.BLANK.FORCE_DEPOSITS_IMPORT:
                return this.forceDepositsImport();
            case Messages.BLANK.GET_LATEST_DEPOSIT_DATE:
                return this.getLatestDepositDate(
                    request as RequestBlankGetLatestDepositDate
                );
            case Messages.DAPP.CONFIRM_REQUEST:
                return this.confirmDappRequest(
                    request as RequestConfirmDappRequest
                );
            case Messages.EXTERNAL.REQUEST:
                return this.externalRequestHandle(
                    request as RequestExternalRequest,
                    portId
                );
            case Messages.EXTERNAL.SETUP_PROVIDER:
                return this.setupProvider(portId);
            case Messages.EXTERNAL.SET_METADATA:
                return this.setProviderMetadata(
                    request as RequestSetMetadata,
                    portId
                );
            case Messages.NETWORK.CHANGE:
                return this.networkChange(request as RequestNetworkChange);
            case Messages.NETWORK.SET_SHOW_TEST_NETWORKS:
                return this.setShowTestNetworks(
                    request as RequestShowTestNetworks
                );
            case Messages.NETWORK.ADD_NETWORK:
                return this.addNetwork(request as RequestAddNetwork);
            case Messages.PASSWORD.VERIFY:
                return this.passwordVerify(request as RequestPasswordVerify);
            // case Messages.PASSWORD.CHANGE:
            //   return this.passwordChange(request as RequestPasswordChange)
            case Messages.PERMISSION.ADD_NEW:
                return this.addNewSiteWithPermissions(
                    request as RequestAddNewSiteWithPermissions
                );
            case Messages.PERMISSION.CONFIRM:
                return this.confirmPermission(
                    request as RequestConfirmPermission
                );
            case Messages.PERMISSION.GET_ACCOUNT_PERMISSIONS:
                return this.getAccountPermissions(
                    request as RequestGetAccountPermissions
                );
            case Messages.PERMISSION.REMOVE_ACCOUNT_FROM_SITE:
                return this.removeAccountFromSite(
                    request as RequestRemoveAccountFromSite
                );
            case Messages.PERMISSION.UPDATE_SITE_PERMISSIONS:
                return this.updateSitePermissions(
                    request as RequestUpdateSitePermissions
                );
            case Messages.STATE.GET:
                return this.getState();
            case Messages.TRANSACTION.CONFIRM:
                return this.confirmTransaction(
                    request as RequestConfirmTransaction
                );
            case Messages.TRANSACTION.REJECT:
                return this.rejectTransaction(
                    request as RequestRejectTransaction
                );
            case Messages.ENS.RESOLVE_NAME:
                return this.ensResolve(request as RequestEnsResolve);
            case Messages.ENS.LOOKUP_ADDRESS:
                return this.ensLookup(request as RequestEnsLookup);
            case Messages.TRANSACTION.GET_LATEST_GAS_PRICE:
                return this.getLatestGasPrice();
            case Messages.TRANSACTION.SEND_ETHER:
                return this.sendEther(request as RequestSendEther);
            case Messages.TRANSACTION.ADD_NEW_SEND_TRANSACTION:
                return this.addAsNewSendTransaction(
                    request as RequestAddAsNewSendTransaction
                );
            case Messages.TRANSACTION.UPDATE_SEND_TRANSACTION_GAS:
                return this.updateSendTransactionGas(
                    request as RequestUpdateSendTransactionGas
                );
            case Messages.TRANSACTION.APPROVE_SEND_TRANSACTION:
                return this.approveSendTransaction(
                    request as RequestApproveSendTransaction
                );
            case Messages.TRANSACTION.GET_SEND_TRANSACTION_RESULT:
                return this.getSendTransactionResult(
                    request as RequestSendTransactionResult
                );
            case Messages.TRANSACTION.CALCULATE_SEND_TRANSACTION_GAS_LIMIT:
                return this.calculateSendTransactionGasLimit(
                    request as RequestCalculateSendTransactionGasLimit
                );
            case Messages.TRANSACTION.CALCULATE_APPROVE_TRANSACTION_GAS_LIMIT:
                return this.calculateApproveTransactionGasLimit(
                    request as RequestCalculateApproveTransactionGasLimit
                );
            case Messages.TRANSACTION.CANCEL_TRANSACTION:
                return this.cancelTransaction(
                    request as RequestCancelTransaction
                );
            case Messages.TRANSACTION.SPEED_UP_TRANSACTION:
                return this.speedUpTransaction(
                    request as RequestSpeedUpTransaction
                );
            case Messages.TRANSACTION.GET_NEXT_NONCE:
                return this.getNextNonce(request as RequestNextNonce);
            case Messages.WALLET.CREATE:
                return this.walletCreate(request as RequestWalletCreate);
            case Messages.WALLET.IMPORT:
                return this.walletImport(request as RequestWalletImport);
            case Messages.WALLET.RESET:
                return this.walletReset(request as RequestWalletReset);
            case Messages.WALLET.VERIFY_SEED_PHRASE:
                return this.verifySP(request as RequestVerifySeedPhrase);
            case Messages.WALLET.SETUP_COMPLETE:
                return this.completeSetup(request as RequestCompleteSetup);
            case Messages.WALLET.REQUEST_SEED_PHRASE:
                return this.getSeedPhrase(request as RequestSeedPhrase);
            case Messages.STATE.SUBSCRIBE:
                return this.stateSubscribe(id, port);
            case Messages.TOKEN.GET_BALANCE:
                return this.getTokenBalance(request as RequestGetTokenBalance);
            case Messages.TOKEN.GET_TOKENS:
                return this.getTokens(request as RequestGetTokens);
            case Messages.TOKEN.GET_USER_TOKENS:
                return this.getUserTokens(request as RequestGetUserTokens);
            case Messages.TOKEN.GET_TOKEN:
                return this.getToken(request as RequestGetToken);
            case Messages.TOKEN.ADD_CUSTOM_TOKEN:
                return this.addCustomToken(request as RequestAddCustomToken);
            case Messages.TOKEN.DELETE_CUSTOM_TOKEN:
                return this.deleteCustomToken(
                    request as RequestDeleteCustomToken
                );
            case Messages.TOKEN.ADD_CUSTOM_TOKENS:
                return this.addCustomTokens(request as RequestAddCustomTokens);
            case Messages.TOKEN.SEND_TOKEN:
                return this.sendToken(request as RequestSendToken);
            case Messages.TOKEN.POPULATE_TOKEN_DATA:
                return this.populateTokenData(
                    request as RequestPopulateTokenData
                );
            case Messages.TOKEN.SEARCH_TOKEN:
                return this.searchTokenInAssetsList(
                    request as RequestSearchToken
                );
            case Messages.EXTERNAL.EVENT_SUBSCRIPTION:
                return this.blankProviderEventSubscribe(id, port, portId);
            case Messages.SWAP.IS_APPROVED:
                return this.isSwapApproved(request as RequestIsSwapApproved);
            case Messages.SWAP.APPROVE:
                return this.approveSwap(request as RequestApproveSwap);
            case Messages.SWAP.GET_QUOTE:
                return this.getSwapQuote(request as RequestGetSwapQuote);
            case Messages.SWAP.GET_SWAP:
                return this.getSwap(request as RequestGetSwap);
            case Messages.SWAP.EXECUTE_SWAP:
                return this.executeSwap(request as RequestExecuteSwap);
            case Messages.ADDRESS_BOOK.CLEAR:
                return this.addressBookClear(
                    request as RequestAddressBookClear
                );
            case Messages.ADDRESS_BOOK.DELETE:
                return this.addressBookDelete(
                    request as RequestAddressBookDelete
                );
            case Messages.ADDRESS_BOOK.SET:
                return this.addressBookSet(request as RequestAddressBookSet);
            case Messages.ADDRESS_BOOK.GET:
                return this.addressBookGet(request as RequestAddressBookGet);
            case Messages.ADDRESS_BOOK.GET_BY_ADDRESS:
                return this.addressBookByAddress(
                    request as RequestAddressBookGetByAddress
                );
            case Messages.ADDRESS_BOOK.GET_RECENT_ADDRESSES:
                return this.addressBookGetRecentAddresses(
                    request as RequestAddressBookGetRecentAddresses
                );
            case Messages.APP.SET_USER_SETTINGS:
                return this.setUserSettings(request as RequestUserSettings);
            default:
                throw new Error(`Unable to handle message of type ${type}`);
        }
    }

    /**
     * It returns the date of the latest deposit made
     * for the specified currency/amount pair
     *
     * @param pair The currency amount pair to look for
     */
    public async getLatestDepositDate({
        pair,
    }: RequestBlankGetLatestDepositDate): Promise<Date> {
        return this.blankDepositController.getLatestDepositDate(pair);
    }

    /**
     * Adds a new account to the default (first) HD seed phrase Keyring.
     *
     */
    private async accountCreate({
        name,
    }: RequestAccountCreate): Promise<AccountInfo> {
        return this.accountTrackerController.createAccount(name);
    }

    /**
     * Returns account json data to export
     * Encrypted with password
     *
     * @param address account address
     * @param password Encrypting password
     * @returns Exported account info in JSON format
     */
    private async accountExportJson({
        address,
        password,
        encryptPassword,
    }: RequestAccountExportJson): Promise<string> {
        try {
            await this.keyringController.verifyPassword(password);
            const privateKey = await this.keyringController.exportAccount(
                address
            );
            return getAccountJson(privateKey, encryptPassword);
        } catch (error) {
            log.warn(error);
            throw Error('Error exporting account');
        }
    }

    /**
     * Returns account json data to export
     * Encrypted with password
     *
     * @param address account address
     * @param password Encrypting password
     * @returns Exported account info in JSON format
     */
    private async accountExportPrivateKey({
        address,
        password,
    }: RequestAccountExportPK): Promise<string> {
        try {
            await this.keyringController.verifyPassword(password);
            return await this.keyringController.exportAccount(address);
        } catch (error) {
            log.warn(error);
            throw Error('Error exporting account');
        }
    }

    /**
     * Imports an account using a json file
     *
     * @param importArgs Import data
     * @param name Imported account name
     * @returns Imported account info
     */
    private async accountImportJson({
        importArgs,
        name,
    }: RequestAccountImportJson): Promise<AccountInfo> {
        return this.accountTrackerController.importAccount(
            ImportStrategy.JSON_FILE,
            importArgs,
            name
        );
    }

    /**
     * Imports an account using the private key
     *
     * @param importArgs Import data
     * @param name Imported account name
     * @returns Imported account info
     */
    private async accountImportPrivateKey({
        importArgs,
        name,
    }: RequestAccountImportPK): Promise<AccountInfo> {
        return this.accountTrackerController.importAccount(
            ImportStrategy.PRIVATE_KEY,
            importArgs,
            name
        );
    }

    /**
     * Removes an account from state / storage.
     *
     * @param address address to be deleted - hex
     */
    private async accountRemove({
        address,
    }: RequestAccountRemove): Promise<boolean> {
        await this.accountTrackerController.removeAccount(address);
        return true;
    }

    /**
     * Renames selected account
     *
     * @param address account address
     * @param name new name
     */
    private async accountRename({
        address,
        name,
    }: RequestAccountRename): Promise<boolean> {
        this.accountTrackerController.renameAccount(address, name);
        return true;
    }

    /**
     * Updates selected account
     *
     * @param address address to be selected
     */
    private async accountSelect({
        address,
    }: RequestAccountSelect): Promise<boolean> {
        this.preferencesController.setSelectedAddress(address);
        return true;
    }

    /**
     * Returns the time in minutes for the extension auto block
     *
     */
    private async getIdleTimeout(): Promise<number> {
        return this.store.flatState.idleTimeout;
    }

    /**
     * Set a custom time in minutes for the extension auto block
     *
     * @param idleTimeout the new timeout in minutes, should be greater than zero
     */
    private async setIdleTimeout({
        idleTimeout,
    }: RequestSetIdleTimeout): Promise<void> {
        return this.appStateController.setIdleTimeout(idleTimeout);
    }

    /**
     * Update last user active time
     *
     */
    private async setLastUserActiveTime(): Promise<void> {
        return this.appStateController.setLastActiveTime();
    }

    /**
     * Locks the vault and the app
     *
     */
    private async lockApp(): Promise<boolean> {
        await this.appStateController.lock();
        return true;
    }

    /**
     * Unlocks the vault and the app
     *
     * @param password user's password
     */
    private async unlockApp({ password }: RequestAppUnlock): Promise<boolean> {
        try {
            await this.appStateController.unlock(password);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Creates a new onboarding tab or focuses the current open one
     *
     */
    private returnToOnboarding() {
        let onboardingInstance: string | null = null;

        // Check if there is any open onboarding tab
        for (const instance in extensionInstances) {
            if (
                extensionInstances[instance].port.sender?.url?.includes(
                    'tab.html'
                )
            ) {
                onboardingInstance = instance;
            }
        }

        if (onboardingInstance) {
            const tab = extensionInstances[onboardingInstance].port.sender?.tab;
            if (tab && tab.id && tab.windowId) {
                // Focus window
                focusWindow(tab.windowId);
                // Switch to tab
                switchToTab(tab.id);
            }
        } else {
            // Open new onboarding tab
            openExtensionInBrowser();
        }
    }

    /**
     * Opens a new reset tab and closes every other extension tab
     *
     */
    private openReset() {
        // Close every other extension instance tab
        for (const instance in extensionInstances) {
            if (
                extensionInstances[instance].port.sender?.url?.includes(
                    'tab.html'
                ) &&
                instance
            ) {
                const tab = extensionInstances[instance].port.sender?.tab;
                if (tab && tab.id && tab.windowId) {
                    // Focus window
                    focusWindow(tab.windowId);
                    // Close tab
                    closeTab(tab.id);
                }
            }
        }

        // Open new onboarding tab
        openExtensionInBrowser('reset');
    }

    /**
     * It forces an asynchronous deposits reconstruction
     * The vault must be initialized in order to do so
     */
    private forceDepositsImport() {
        this.blankDepositController.importDeposits();
    }

    /**
     * It returns the withdrawal operation gas cost
     */
    private async getWithdrawalFees({ pair }: RequestBlankWithdrawalFees) {
        return this.blankDepositController.getWithdrawalFees(pair);
    }
    /**
     * It checks for possible spent notes and updates their internal state
     */
    private async updateNotesSpentState() {
        return this.blankDepositController.updateNotesSpentState();
    }

    /**
     * It returns the deposit formatted note
     */
    private async getDepositNoteString(
        request: RequestBlankGetDepositNoteString
    ) {
        return this.blankDepositController.getDepositNoteString(request.id);
    }

    /**
     * It returns the list of unspent deposits ordered by timestamp
     * with their notes string removed
     */
    private async getUnspentDeposits() {
        return this.blankDepositController.getDeposits();
    }

    /**
     * It returns the currency/amount pair unspent deposits count
     */
    private async getCurrencyDepositsCount(
        request: RequestBlankCurrencyDepositsCount
    ) {
        return this.blankDepositController.getCurrencyDepositsCount(
            request.currency
        );
    }

    /**
     * It returns the currency/amount pair unspent deposits count
     */
    private async getPairDepositsCount(request: RequestBlankPairDepositsCount) {
        return this.blankDepositController.getUnspentDepositsCount(
            request.pair
        );
    }

    private async getTornadoInstanceAllowance({
        pair,
    }: RequestBlankGetInstanceTokenAllowance): Promise<BigNumber> {
        return this.blankDepositController.getInstanceTokenAllowance(pair);
    }

    /**
     * Method to confirm a transaction
     *
     * @param id - id of the transaction being confirmed.
     * @param feeData - fee data selected by the user. Will update transaction's data if needed.
     * @param advancedData - advanced data that can be changed by the user to apply to the transaction. For now customNonce
     */
    private async confirmTransaction({
        id,
        feeData,
        advancedData,
    }: RequestConfirmTransaction) {
        const meta = this.transactionController.getTransaction(id);

        if (!meta) {
            throw new Error('The specified transaction was not found');
        }

        // If found, update the transaction fee & advanced data related values
        this.transactionController.updateTransaction({
            ...meta,
            transactionParams: {
                ...meta.transactionParams,
                gasLimit: feeData.gasLimit || meta.transactionParams.gasLimit,
                gasPrice: feeData.gasPrice || meta.transactionParams.gasPrice,
                maxPriorityFeePerGas:
                    feeData.maxPriorityFeePerGas ||
                    meta.transactionParams.maxPriorityFeePerGas,
                maxFeePerGas:
                    feeData.maxFeePerGas || meta.transactionParams.maxFeePerGas,

                nonce:
                    advancedData?.customNonce || meta.transactionParams.nonce, // custom nonce update
            },
            flashbots: advancedData?.flashbots || meta.flashbots, // flashbots update
        });

        return this.transactionController.approveTransaction(id);
    }

    /**
     * Method to reject transaction proposed by external source
     *
     * @param transactionMeta - transaction data
     * @param tabId - id of the tab where the extension is opened (needed to close the window)
     */
    private rejectTransaction = async ({
        transactionId,
    }: RequestRejectTransaction) => {
        return this.transactionController.rejectTransaction(transactionId);
    };

    /**
     * It returns information of a deposit for compliance purposes
     */
    private async getComplianceInformation(request: RequestBlankCompliance) {
        const deposit = await this.blankDepositController.getDeposit(
            request.id
        );
        return this.blankDepositController.getComplianceInformation(deposit);
    }

    /**
     * hasDepositedFromAddress
     *
     * @returns Whether or not the user has made at least one deposit from this address in the past
     */
    private async hasDepositedFromAddress({
        pair,
        withdrawAddress,
    }: RequestBlankHasDepositedFromAddress) {
        let depositsMadeFromWithdrawalAddress = (
            await this.blankDepositController.getDeposits(false)
        ).filter((d) => d.depositAddress === withdrawAddress);

        // If pair was provided filter for that as well
        if (pair) {
            depositsMadeFromWithdrawalAddress =
                depositsMadeFromWithdrawalAddress.filter(
                    (d) =>
                        d.pair.amount === pair.amount &&
                        d.pair.currency === pair.currency
                );
        }

        return depositsMadeFromWithdrawalAddress.length !== 0;
    }

    /**
     * It makes a Blank withdrawal from the oldest deposit note
     * of the specified currency amount pair
     *
     * @param request The Blank withdraw request
     */
    private async blankWithdraw({
        pair,
        accountAddressOrIndex,
    }: RequestBlankWithdraw) {
        // Pick a deposit randomly
        const deposit = await this.blankDepositController.getDepositToWithdraw(
            pair
        );

        let address = undefined;
        if (typeof accountAddressOrIndex === 'string') {
            // If it is an address, check if it's valid
            if (!utils.isAddress(accountAddressOrIndex)) {
                throw new Error('Invalid address');
            }
            address = accountAddressOrIndex;
        } else if (typeof accountAddressOrIndex === 'number') {
            const account =
                await this.accountTrackerController.getAccountByIndex(
                    accountAddressOrIndex
                );

            address = account.address;
        }

        // Trigger withdraw
        try {
            const hash = await this.blankDepositController.withdraw(
                deposit,
                address
            );
            return hash;
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }
    }

    /**
     * It makes a Blank deposit
     *
     * @param request The Blank deposit request
     */
    private async blankDeposit({
        pair,
        unlimitedAllowance = false,
        feeData,
    }: RequestBlankDeposit) {
        try {
            const hash = await this.blankDepositController.deposit(
                pair,
                feeData,
                unlimitedAllowance
            );
            return hash;
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }
    }

    private async addAsNewDepositTransaction({
        currencyAmountPair,
        feeData,
        unlimitedAllowance = false,
    }: RequestAddAsNewDepositTransaction): Promise<TransactionMeta> {
        try {
            return this.blankDepositController.addAsNewDepositTransaction(
                currencyAmountPair,
                feeData,
                unlimitedAllowance
            );
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }
    }

    private async updateDepositTransactionGas({
        transactionId,
        feeData,
    }: RequestUpdateDepositTransactionGas): Promise<void> {
        try {
            return this.blankDepositController.updateDepositTransactionGas(
                transactionId,
                feeData
            );
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }
    }

    private async approveDepositTransaction({
        transactionId,
    }: RequestApproveDepositTransaction): Promise<void> {
        try {
            return this.blankDepositController.approveDepositTransaction(
                transactionId
            );
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }
    }

    private async getDepositTransactionResult({
        transactionId,
    }: RequestGetDepositTransactionResult): Promise<string> {
        try {
            return this.blankDepositController.getDepositTransactionResult(
                transactionId
            );
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }
    }

    private async calculateDepositTransactionGasLimit({
        currencyAmountPair,
    }: RequestCalculateDepositTransactionGasLimit): Promise<TransactionGasEstimation> {
        try {
            return this.blankDepositController.calculateDepositTransactionGasLimit(
                currencyAmountPair
            );
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }
    }

    /**
     * Confirms or rejects the selected dapp request
     *
     */
    private async confirmDappRequest({
        id,
        isConfirmed,
        confirmOptions,
    }: RequestConfirmDappRequest): Promise<void> {
        return this.blankProviderController.handleDappRequest(
            id,
            isConfirmed,
            confirmOptions
        );
    }

    /**
     * Handles the request sent by in-page provider from the DAPP
     *
     */
    private async externalRequestHandle(
        request: RequestExternalRequest,
        portId: string
    ): Promise<unknown> {
        return this.blankProviderController.handle(portId, request);
    }

    /**
     * Returns provider setup data
     *
     */
    private async setupProvider(portId: string): Promise<ProviderSetupData> {
        return this.blankProviderController.setupProvider(portId);
    }

    /**
     * Initialize provider site metadata
     *
     */
    private async setProviderMetadata(
        { siteMetadata }: RequestSetMetadata,
        portId: string
    ) {
        return this.blankProviderController.setMetadata(siteMetadata, portId);
    }

    /**
     * Change network method
     *
     * @param networkName network name
     */
    private async networkChange({
        networkName,
    }: RequestNetworkChange): Promise<boolean> {
        return this.networkController.setNetwork(networkName);
    }

    /**
     * Sets show test networks flag
     *
     * @param showTestNetworks flag value
     */
    private async setShowTestNetworks({
        showTestNetworks,
    }: RequestShowTestNetworks): Promise<boolean> {
        this.preferencesController.showTestNetworks = showTestNetworks;
        return true;
    }

    /**
     * Sets popup page tab flag
     *
     * @param popupPageTab flag value
     */
    private async updatePopupTab({
        popupTab,
    }: RequestUpdatePopupTab): Promise<void> {
        this.preferencesController.popupTab = popupTab;
    }

    /**
     *
     * @param name name of the network
     * @param chainId chain identifier of the network
     * @param rpcUrl
     * @param currencySymbol
     * @param blockExporerUrl
     */
    private async addNetwork({
        name,
        chainId,
        rpcUrl,
        currencySymbol,
        blockExplorerUrl,
    }: RequestAddNetwork): Promise<void> {
        //return this.preferencesController.addNetwork(...);
        return;
    }

    /**
     * Password validation method
     *
     * @param password
     */
    private async passwordVerify({
        password,
    }: RequestPasswordVerify): Promise<boolean> {
        try {
            await this.keyringController.verifyPassword(password);
            return true;
        } catch {
            return false;
        }
    }

    // Permissions

    private async addNewSiteWithPermissions({
        accounts,
        origin,
        siteMetadata,
    }: RequestAddNewSiteWithPermissions) {
        return this.permissionsController.addNewSite(
            origin,
            siteMetadata,
            accounts
        );
    }

    private async confirmPermission({
        id,
        accounts,
    }: RequestConfirmPermission) {
        return this.permissionsController.handlePermissionRequest(id, accounts);
    }

    private async getAccountPermissions({
        account,
    }: RequestGetAccountPermissions) {
        return this.permissionsController.getAccountPermissions(account);
    }

    private async removeAccountFromSite({
        origin,
        account,
    }: RequestRemoveAccountFromSite) {
        return this.permissionsController.removeAccount(origin, account);
    }

    private async updateSitePermissions({
        origin,
        accounts,
    }: RequestUpdateSitePermissions) {
        return this.permissionsController.updateSite(origin, accounts);
    }

    /**
     * Get UI State
     *
     */
    private getState(): Flatten<BlankAppUIState> {
        return this.UIStore.flatState;
    }

    /**
     * Resolve ENS name
     *
     * @param name to resolve
     */
    private async ensResolve({
        name,
    }: RequestEnsResolve): Promise<string | null> {
        return this.ensController.resolveName(name);
    }

    /**
     * Lookup address for ENS
     *
     * @param address to lookup
     */
    private async ensLookup({
        address,
    }: RequestEnsLookup): Promise<string | null> {
        return this.ensController.lookupAddress(address);
    }

    /**
     * Send ethereum method
     *
     * @param to recipient
     * @param feeData gas fee data
     * @param value amount
     */
    private async sendEther({
        to,
        value,
        feeData,
        advancedData,
    }: RequestSendEther): Promise<string> {
        // Add unapproved trasaction
        const {
            transactionMeta: { id },
        } = await this.transactionController.addTransaction(
            {
                to,
                from: this.preferencesController.getSelectedAddress(),
                value,
                ...feeData,
                nonce: advancedData.customNonce,
            },
            'blank'
        );

        // Approve it
        try {
            await this.transactionController.approveTransaction(id);
        } catch (e: any) {
            const errorMessage =
                (e.error?.body
                    ? JSON.parse(e.error?.body).error?.message
                    : e.reason) ?? e.message;

            throw new Error(errorMessage);
        }

        // Return transaction hash
        const transaction = this.transactionController.getTransaction(id);
        return transaction!.transactionParams.hash!;
    }

    /**
     * Generate an unaproved transfer transaction
     *
     * @param tokenAddress erc20 token address
     * @param to recipient
     * @param feeData gas fee Data
     * @param value amount
     */
    private async addAsNewSendTransaction({
        address,
        to,
        value,
        feeData,
    }: RequestAddAsNewSendTransaction): Promise<TransactionMeta> {
        if (this.tokenController.isNativeToken(address)) {
            const { transactionMeta } =
                await this.transactionController.addTransaction(
                    {
                        to,
                        from: this.preferencesController.getSelectedAddress(),
                        value: BigNumber.from(value),
                        ...feeData,
                    },
                    'blank'
                );

            const { nativeCurrency, iconUrls } = this.networkController.network;
            const logo = iconUrls ? iconUrls[0] : '';

            // Set native currency meta for displaying purposes
            transactionMeta.transferType = {
                amount: transactionMeta.transactionParams.value!,
                currency: nativeCurrency.symbol,
                decimals: nativeCurrency.decimals,
                logo,
                to,
            };
            this.transactionController.updateTransaction(transactionMeta);

            return transactionMeta;
        } else {
            const transferTransaction = this.getTransferTransaction();

            return transferTransaction.addAsNewTransaction(
                {
                    tokenAddress: address,
                    to,
                    amount: value,
                } as TransferTransactionPopulatedTransactionParams,
                feeData
            );
        }
    }

    /**
     * Update the gas for a send transaction
     *
     * @param transactionId of the transaction meta to update
     * @param feeData gas fee data
     */
    private async updateSendTransactionGas({
        transactionId,
        feeData,
    }: RequestUpdateSendTransactionGas): Promise<void> {
        const transferTransaction = this.getTransferTransaction();

        return transferTransaction.updateTransactionGas(transactionId, feeData);
    }

    /**
     * Approve a send transaction
     *
     * @param transactionId of the transaction to approve
     */
    private async approveSendTransaction({
        transactionId,
    }: RequestApproveSendTransaction): Promise<void> {
        const transferTransaction = this.getTransferTransaction();

        return transferTransaction.approveTransaction(transactionId);
    }

    /**
     * Get the result of a send transaction
     *
     * @param transactionId to get result
     */
    private async getSendTransactionResult({
        transactionId,
    }: RequestSendTransactionResult): Promise<string> {
        const transferTransaction = this.getTransferTransaction();

        return transferTransaction.getTransactionResult(transactionId);
    }

    /**
     * It returns the current network latest gas price
     */
    private async getLatestGasPrice(): Promise<BigNumber> {
        return BigNumber.from(this.gasPricesController.getFeeData().gasPrice!);
    }

    /**
     * Calculate the gas limit for an approve transaction
     */
    private async calculateApproveTransactionGasLimit({
        tokenAddress,
        spender,
        amount,
    }: RequestCalculateApproveTransactionGasLimit): Promise<TransactionGasEstimation> {
        const approveTransaction = new ApproveTransaction({
            transactionController: this.transactionController,
            preferencesController: this.preferencesController,
            networkController: this.networkController,
        });

        spender =
            spender === 'deposit'
                ? this.blankDepositController.proxyContractAddress
                : spender;

        return approveTransaction.calculateTransactionGasLimit({
            tokenAddress,
            spender,
            amount,
        });
    }

    private cancelTransaction({
        transactionId,
        gasValues,
    }: RequestCancelTransaction): Promise<void> {
        return this.transactionController.cancelTransaction(
            transactionId,
            gasValues
        );
    }

    private speedUpTransaction({
        transactionId,
        gasValues,
    }: RequestSpeedUpTransaction): Promise<void> {
        return this.transactionController.speedUpTransaction(
            transactionId,
            gasValues
        );
    }

    /**
     * Calculate the gas limit for a send transaction
     */
    private async calculateSendTransactionGasLimit({
        address,
        to,
        value,
    }: RequestCalculateSendTransactionGasLimit): Promise<TransactionGasEstimation> {
        if (
            this.tokenController.isNativeToken(address) &&
            !this.networkController.network.isCustomNetwork
        ) {
            return {
                gasLimit: BigNumber.from(SEND_GAS_COST),
                estimationSucceeded: true,
            };
        } else if (this.tokenController.isNativeToken(address)) {
            const { chainId } = this.networkController.network;
            return this.transactionController.estimateGas(
                {
                    transactionParams: {
                        to,
                        from: this.preferencesController.getSelectedAddress(),
                    },
                    chainId,
                } as TransactionMeta,
                //On L2 networks (Arbitrum for now), added fallback gas limit value to 1,200,000 to use in case estimation fails.
                BigNumber.from('0x0c3500')
            );
        } else {
            const transferTransaction = this.getTransferTransaction();

            return transferTransaction.calculateTransactionGasLimit({
                tokenAddress: address,
                to,
                amount: value,
            } as TransferTransactionPopulatedTransactionParams);
        }
    }

    private getTransferTransaction(): TransferTransaction {
        return new TransferTransaction({
            transactionController: this.transactionController,
            tokenController: this.tokenController,
            preferencesController: this.preferencesController,
            networkController: this.networkController,
        });
    }

    /**
     * Account creation method
     *
     * @param password
     * @returns String - seed phrase
     */
    private async walletCreate({
        password,
    }: RequestWalletCreate): Promise<void> {
        // Create keyring
        await this.keyringController.createNewVaultAndKeychain(password);

        // Initialize vault
        await this.blankDepositController.initializeVault(password);

        // Get account
        const account = (await this.keyringController.getAccounts())[0];

        // Set selected address
        this.preferencesController.setSelectedAddress(account);

        // Set account tracker
        this.accountTrackerController.addPrimaryAccount(account);

        // Unlock when account is created so vault will be ready after onboarding
        return this.appStateController.unlock(password);
    }

    /**
     * Imports an existing account
     *
     * @param password
     * @param seedPhrase imported wallet seed phrase
     */
    private async walletImport({
        password,
        seedPhrase,
        reImport,
    }: RequestWalletImport): Promise<boolean> {
        // Clear accounts in accountTracker
        this.accountTrackerController.clearAccounts();

        // Clear unapproved transactions
        this.transactionController.clearUnapprovedTransactions();

        // Clear all activities
        this.activityListController.clearActivities();

        // Clear all tokens
        this.tokenController.clearTokens();

        // Create new vault
        await this.keyringController.createNewVaultAndRestore(
            password,
            seedPhrase
        );

        // Initialize deposit vault
        if (!reImport) {
            await this.blankDepositController.initializeVault(password);
        } else {
            await this.blankDepositController.reinitializeVault(password);
        }

        // Set Seed Phrase Backed up
        this.onboardingController.isSeedPhraseBackedUp = true;

        // Get account
        const account = (await this.keyringController.getAccounts())[0];

        // Set selected address
        this.preferencesController.setSelectedAddress(account);

        // Set account tracker
        this.accountTrackerController.addPrimaryAccount(account);

        // Unlock when account is created so vault will be ready after onboarding
        await this.appStateController.unlock(password);

        // Asynchronously import the deposits
        await this.blankDepositController.initialize();

        this.blankDepositController.importDeposits(password, seedPhrase);

        return true;
    }

    /**
     * Resets wallet with seed phrase
     *
     * @param password
     * @param seedPhrase imported wallet seed phrase
     */
    private async walletReset({
        password,
        seedPhrase,
    }: RequestWalletReset): Promise<boolean> {
        return this.walletImport({ password, seedPhrase, reImport: true });
    }

    /**
     * It returns the user seed phrase if the password provided is correct
     *
     * @param password The user password
     * @throws If password is invalid
     * @returns The wallet seed phrase
     */
    private async getSeedPhrase({
        password,
    }: RequestSeedPhrase): Promise<string> {
        try {
            const seedPhrase = await this.keyringController.verifySeedPhrase(
                password
            );
            return seedPhrase;
        } catch (error) {
            log.warn(error);
            throw Error('Error verifying seed phrase');
        }
    }

    /**
     * Method to verify if the user has correctly completed the seed phrase challenge
     *
     * @param seedPhrase
     */
    private async verifySP({
        password,
        seedPhrase,
    }: RequestVerifySeedPhrase): Promise<boolean> {
        let vaultSeedPhrase = '';
        try {
            vaultSeedPhrase = await this.keyringController.verifySeedPhrase(
                password
            );
        } catch (error) {
            log.warn(error);
            throw Error('Error verifying seed phrase');
        }
        if (seedPhrase === vaultSeedPhrase) {
            this.onboardingController.isSeedPhraseBackedUp = true;
            return true;
        } else {
            throw new Error('Seed Phrase is not valid');
        }
    }

    /**
     * Method to mark setup process as complete and to fire a notification.
     *
     */
    private async completeSetup({}: RequestCompleteSetup): Promise<void> {
        if (!this.isSetupComplete) {
            showSetUpCompleteNotification();
            this.isSetupComplete = true;
        }
    }

    /**
     * State subscription method
     *
     */
    private stateSubscribe(id: string, port: chrome.runtime.Port): boolean {
        const cb = this.createSubscription<typeof Messages.STATE.SUBSCRIBE>(
            id,
            port
        );

        const sendState = () => {
            const flatState = this.UIStore.flatState;
            cb(flatState);
        };

        this.UIStore.subscribe(sendState);

        port.onDisconnect.addListener((): void => {
            this.unsubscribe(id);
            this.UIStore.unsubscribe(sendState);
        });

        return true;
    }

    /**
     * Provider event subscription method
     *
     */
    private blankProviderEventSubscribe(
        id: string,
        port: chrome.runtime.Port,
        portId: string
    ): boolean {
        const cb = this.createSubscription<
            typeof Messages.EXTERNAL.EVENT_SUBSCRIPTION
        >(id, port);

        const handleSubscription = (eventData: ExternalEventSubscription) => {
            switch (eventData.eventName) {
                case ProviderEvents.accountsChanged:
                    cb(
                        this.blankProviderController.handleAccountUpdates(
                            portId,
                            eventData
                        )
                    );
                    break;
                case ProviderEvents.message:
                    if (eventData.portId === portId) {
                        cb({
                            eventName: eventData.eventName,
                            payload: eventData.payload,
                        });
                    }
                    break;
                default:
                    cb(eventData);
                    break;
            }
        };

        this.blankProviderController.on(
            BlankProviderEvents.SUBSCRIPTION_UPDATE,
            handleSubscription
        );

        port.onDisconnect.addListener((): void => {
            this.unsubscribe(id);
            this.blankProviderController.off(
                BlankProviderEvents.SUBSCRIPTION_UPDATE,
                handleSubscription
            );
        });

        return true;
    }

    /**
     * Get all the erc20 tokens method
     *
     */
    private async getTokens({ chainId }: RequestGetTokens): Promise<ITokens> {
        return this.tokenController.getTokens(chainId);
    }

    /**
     * Get all the erc20 tokens that the user added method
     *
     */
    private async getUserTokens({
        accountAddress,
        chainId,
    }: RequestGetUserTokens): Promise<ITokens> {
        return this.tokenController.getUserTokens(accountAddress, chainId);
    }

    /**
     * get erc20 token method
     *
     * @param tokenAddress erc20 token address
     */
    private async getToken({
        tokenAddress,
        accountAddress,
        chainId,
    }: RequestGetToken): Promise<Token> {
        return this.tokenController.getToken(
            tokenAddress,
            accountAddress,
            chainId
        );
    }

    /**
     * Get balance for a single token address
     *
     * @returns token balance for that account
     */
    private async getTokenBalance({
        tokenAddress,
        account,
    }: RequestGetTokenBalance): Promise<BigNumber> {
        return this.tokenOperationsController.balanceOf(tokenAddress, account);
    }

    /**
     * Searches inside the assets list for tokens that matches the criteria
     *
     * @param query The user input query to search for (address, name, symbol)
     */
    private async searchTokenInAssetsList({
        query,
        exact,
        accountAddress,
        chainId,
    }: RequestSearchToken): Promise<Token[]> {
        return this.tokenController.search(
            query,
            exact,
            accountAddress,
            chainId
        );
    }

    /**
     * Add custom erc20 token method
     *
     * @param address erc20 token address
     * @param name erc20 token name
     * @param symbol erc20 token symbol
     * @param decimals erc20 token decimals
     * @param logo erc20 token logo
     * @param type erc20 token type
     */
    private async addCustomToken({
        address,
        name,
        symbol,
        decimals,
        logo,
        type,
    }: RequestAddCustomToken): Promise<void | void[]> {
        return this.tokenController.addCustomToken(
            new Token(address, name, symbol, decimals, logo, type)
        );
    }

    /**
     * Delete a custom erc20 tokens method
     *
     * @param address of the ERC20 token to delete
     */
    private async deleteCustomToken({
        address,
        accountAddress,
        chainId,
    }: RequestDeleteCustomToken): Promise<void> {
        return this.tokenController.deleteUserToken(
            address,
            accountAddress,
            chainId
        );
    }

    /**
     * Add custom erc20 tokens method
     *
     * @param tokens erc20 tokens array
     */
    private async addCustomTokens({
        tokens,
        accountAddress,
        chainId,
    }: RequestAddCustomTokens): Promise<void | void[]> {
        return this.tokenController.addCustomTokens(
            tokens,
            accountAddress,
            chainId
        );
    }

    /**
     * Send erc20 token method
     *
     * @param tokenAddress erc20 token address
     * @param to recipient
     * @param feeData gas fee data
     * @param value amount
     */
    private async sendToken({
        tokenAddress,
        to,
        value,
        feeData,
        advancedData,
    }: RequestSendToken): Promise<string> {
        /**
         * Old Method
         */
        //return this.tokenController.transfer(tokenAddress, to, value, gasPrice);

        const transferTransaction = this.getTransferTransaction();

        return transferTransaction.do(
            tokenAddress,
            to,
            value,
            feeData,
            advancedData
        );
    }

    /**
     * Search the token in the blockchain
     *
     * @param tokenAddress erc20 token address
     */
    private async populateTokenData({
        tokenAddress,
    }: RequestPopulateTokenData): Promise<Token> {
        return this.tokenOperationsController.populateTokenData(tokenAddress);
    }

    /**
     * Check if a token is already approved for a swap
     *
     * @param amount amount to swap
     * @param tokenAddress token address
     */
    private async isSwapApproved({
        amount,
        tokenAddress,
    }: RequestIsSwapApproved): Promise<boolean> {
        return this.swapController.isApproved(amount, tokenAddress);
    }

    /**
     * Approve a token for swaps
     *
     * @param amount amount to swap
     * @param tokenAddress token address
     */
    private async approveSwap({
        tokenAddress,
    }: RequestApproveSwap): Promise<boolean> {
        return this.swapController.approveSender(tokenAddress);
    }

    /**
     * Get a quote for a swap
     *
     * @param quoteParams QuoteParameters
     */
    private async getSwapQuote({
        quoteParams,
    }: RequestGetSwapQuote): Promise<BigNumber> {
        return this.swapController.getQuote(quoteParams);
    }

    /**
     * Get details for a swap
     *
     * @param swapParams SwapParameters
     */
    private async getSwap({ swapParams }: RequestGetSwap): Promise<Swap> {
        return this.swapController.getSwap(swapParams);
    }

    /**
     * Execute a swap
     *
     * @param swap a Swap
     */
    private async executeSwap({ swap }: RequestExecuteSwap): Promise<string> {
        return this.swapController.executeSwap(swap); // returns transaction hash
    }

    /**
     * Remove all entries in the book
     *
     */
    private async addressBookClear({}: RequestAddressBookClear): Promise<boolean> {
        return this.addressBookController.clear();
    }

    /**
     * Remove a contract entry by address
     *
     * @param address - Recipient address to delete
     */
    private async addressBookDelete({
        address,
    }: RequestAddressBookDelete): Promise<boolean> {
        return this.addressBookController.delete(address);
    }

    /**
     * Add or update a contact entry by address
     *
     * @param address - Recipient address to add or update
     * @param name - Nickname to associate with this address
     * @param note - User's note about address
     * @returns - Boolean indicating if the address was successfully set
     */
    private async addressBookSet({
        address,
        name,
        note,
    }: RequestAddressBookSet): Promise<boolean> {
        return this.addressBookController.set(address, name, note);
    }

    /**
     * Get the contacts
     *
     * @returns - A map with the entries
     */
    private async addressBookGet({}: RequestAddressBookGet): Promise<NetworkAddressBook> {
        return this.addressBookController.get();
    }

    /**
     * Get the contacts
     *
     * @param address - Recipient address to search
     *
     * @returns - A address book entry
     */
    private async addressBookByAddress({
        address,
    }: RequestAddressBookGetByAddress): Promise<AddressBookEntry | undefined> {
        return this.addressBookController.getByAddress(address);
    }

    /**
     * Get the recent addresses with which the wallet has interacted
     *
     * @param limit - Optional. The maximun number of recent address to return.
     *
     * @returns - A map with the entries
     */
    private async addressBookGetRecentAddresses({
        limit,
    }: RequestAddressBookGetRecentAddresses): Promise<NetworkAddressBook> {
        return this.addressBookController.getRecentAddresses(limit);
    }

    /**
     * Sets user settings collection
     *
     * @param settings user settings
     */
    private async setUserSettings({
        settings,
    }: RequestUserSettings): Promise<boolean> {
        this.preferencesController.settings = settings;
        return true;
    }

    /**
     * Gets the next nonce for the provided address
     * @param address network address to get the nonce from
     *
     * @returns - Nonce number
     */
    private async getNextNonce({
        address,
    }: RequestNextNonce): Promise<number | undefined> {
        return this.transactionController.getNextNonce(address);
    }
}
