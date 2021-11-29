/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-interface */
import { Flatten } from './helpers';
import { BlankAppUIState } from '../constants/initialState';
import {
    CurrencyAmountPair,
    KnownCurrencies,
} from '../../controllers/blank-deposit/types';
import { IBlankDeposit } from '../../controllers/blank-deposit/BlankDeposit';
import { ComplianceInfo } from '../../controllers/blank-deposit/infrastructure/IBlankDepositService';
import { BigNumber } from '@ethersproject/bignumber';
import { AccountInfo } from '../../controllers/AccountTrackerController';
import { GasPriceValue } from '../../controllers/transactions/TransactionController';
import { ITokens, Token } from '../../controllers/erc-20/Token';
import { TransactionMeta } from '../../controllers/transactions/utils/types';
import { ImportStrategy, ImportArguments } from '../account';
import {
    QuoteParameters,
    SwapParameters,
    Swap,
} from '../../controllers/SwapController';
import {
    ProviderEvents,
    SiteMetadata,
    RequestArguments,
    ProviderSetupData,
} from '@blank/provider/types';

import { FeeData } from '@blank/background/controllers/GasPricesController';

import {
    AddressBookEntry,
    NetworkAddressBook,
} from '@blank/background/controllers/AddressBookController';
import { DappRequestConfirmOptions } from './ethereum';
import { TransactionGasEstimation } from '@blank/background/controllers/transactions/TransactionController';
import {
    PopupTabs,
    UserSettings,
} from '@blank/background/controllers/PreferencesController';

enum ACCOUNT {
    CREATE = 'CREATE_ACCOUNT',
    EXPORT_JSON = 'EXPORT_ACCOUNT_JSON',
    EXPORT_PRIVATE_KEY = 'EXPORT_ACCOUNT_PK',
    IMPORT_JSON = 'IMPORT_ACCOUNT_JSON',
    IMPORT_PRIVATE_KEY = 'IMPORT_ACCOUNT_PK',
    REMOVE = 'REMOVE_ACCOUNT',
    RENAME = 'RENAME_ACCOUNT',
    SELECT = 'SELECT_ACCOUNT',
}

enum APP {
    LOCK = 'LOCK_APP',
    UNLOCK = 'UNLOCK_APP',
    GET_IDLE_TIMEOUT = 'GET_IDLE_TIMEOUT',
    SET_IDLE_TIMEOUT = 'SET_IDLE_TIMEOUT',
    SET_LAST_USER_ACTIVE_TIME = 'SET_LAST_USER_ACTIVE_TIME',
    RETURN_TO_ONBOARDING = 'RETURN_TO_ONBOARDING',
    OPEN_RESET = 'OPEN_RESET',
    SET_USER_SETTINGS = 'SET_USER_SETTINGS',
    UPDATE_POPUP_TAB = 'UPDATE_POPUP_TAB',
}

enum BACKGROUND {
    ACTION = 'ACTION',
}

enum BLANK {
    DEPOSIT = 'DEPOSIT',
    ADD_NEW_DEPOSIT_TRANSACTION = 'DEPOSIT_ADD_UNNAPROVE_TRANSACTION',
    UPDATE_DEPOSIT_TRANSACTION_GAS = 'UPDATE_DEPOSIT_TRANSACTION_GAS',
    APPROVE_DEPOSIT_TRANSACTIION = 'APPROVE_DEPOSIT_TRANSACTIION',
    GET_DEPOSIT_TRANSACTION_RESULT = 'GET_DEPOSIT_TRANSACTION_RESULT',
    CALCULATE_DEPOSIT_TRANSACTION_GAS_LIMIT = 'CALCULATE_DEPOSIT_TRANSACTION_GAS_LIMIT',
    WITHDRAW = 'WITHDRAW',
    COMPLIANCE = 'COMPLIANCE',
    PAIR_DEPOSITS_COUNT = 'PAIR_DEPOSITS_COUNT',
    CURRENCY_DEPOSITS_COUNT = 'CURRENCY_DEPOSITS_COUNT',
    GET_UNSPENT_DEPOSITS = 'GET_UNSPENT_DEPOSITS',
    GET_DEPOSIT_NOTE_STRING = 'GET_DEPOSIT_NOTE_STRING',
    UPDATE_SPENT_NOTES = 'UPDATE_SPENT_NOTES',
    GET_WITHDRAWAL_FEES = 'GET_WITHDRAWAL_GAS_COST',
    FORCE_DEPOSITS_IMPORT = 'FORCE_DEPOSITS_IMPORT',
    HAS_DEPOSITED_FROM_ADDRESS = 'HAS_DEPOSITED_FROM_ADDRESS',
    GET_INSTANCE_ALLOWANCE = 'GET_INSTANCE_ALLOWANCE',
    GET_LATEST_DEPOSIT_DATE = 'GET_LATEST_DEPOSIT_DATE',
}

enum DAPP {
    CONFIRM_REQUEST = 'CONFIRM_DAPP_REQUEST',
}

export enum EXTERNAL {
    EVENT_SUBSCRIPTION = 'EVENT_SUBSCRIPTION',
    REQUEST = 'EXTERNAL_REQUEST',
    SETUP_PROVIDER = 'SETUP_PROVIDER',
    SET_METADATA = 'SET_METADATA',
}

enum NETWORK {
    CHANGE = 'NETWORK_CHANGE',
    SET_SHOW_TEST_NETWORKS = 'SHOW_TEST_NETWORKS',
    ADD_NETWORK = 'ADD_NETWORK',
}

enum PASSWORD {
    VERIFY = 'VERIFY_PASSWORD',
    CHANGE = 'CHANGE_PASSWORD',
}

enum PERMISSION {
    ADD_NEW = 'ADD_NEW_SITE_PERMISSIONS',
    CONFIRM = 'CONFIRM_PERMISSION_REQUEST',
    GET_ACCOUNT_PERMISSIONS = 'GET_ACCOUNT_PERMISSIONS',
    REMOVE_ACCOUNT_FROM_SITE = 'REMOVE_ACCOUNT_FROM_SITE',
    UPDATE_SITE_PERMISSIONS = 'UPDATE_SITE_PERMISSIONS',
}

enum STATE {
    GET = 'GET_STATE',
    SUBSCRIBE = 'STATE_SUBSCRIBE',
}

enum ENS {
    LOOKUP_ADDRESS = 'LOOKUP_ADDRESS_ENS',
    RESOLVE_NAME = 'RESOLVE_ENS_NAME',
}

enum TRANSACTION {
    ADD_NEW_SEND_TRANSACTION = 'ADD_NEW_SEND_TRANSACTION',
    UPDATE_SEND_TRANSACTION_GAS = 'UPDATE_SEND_TRANSACTION_GAS',
    APPROVE_SEND_TRANSACTION = 'APPROVE_SEND_TRANSACTION',
    GET_SEND_TRANSACTION_RESULT = 'GET_SEND_TRANSACTION_RESULT',
    CALCULATE_SEND_TRANSACTION_GAS_LIMIT = 'CALCULATE_SEND_TRANSACTION_GAS_LIMIT',
    CALCULATE_APPROVE_TRANSACTION_GAS_LIMIT = 'CALCULATE_APPROVE_TRANSACTION_GAS_LIMIT',
    CONFIRM = 'CONFIRM_TRANSACTION',
    REJECT = 'REJECT_TRANSACTION',
    GET_LATEST_GAS_PRICE = 'GET_LATEST_GAS_PRICE',
    GET_LATEST_BASE_FEE = 'GET_LATEST_BASE_FEE',
    SEND_ETHER = 'SEND_ETHER',
    CANCEL_TRANSACTION = 'CANCEL_TRANSACTION',
    SPEED_UP_TRANSACTION = 'SPEED_UP_TRANSACTION',
}

enum WALLET {
    CREATE = 'CREATE_WALLET',
    IMPORT = 'IMPORT_WALLET',
    VERIFY_SEED_PHRASE = 'VERIFY_SEED_PHRASE',
    REQUEST_SEED_PHRASE = 'REQUEST_SEED_PHRASE',
    SETUP_COMPLETE = 'SETUP_COMPLETE',
    RESET = 'RESET',
}

enum TOKEN {
    GET_BALANCE = 'GET_TOKEN_BALANCE',
    GET_TOKENS = 'GET_TOKENS',
    GET_USER_TOKENS = 'GET_USER_TOKENS',
    GET_TOKEN = 'GET_TOKEN',
    ADD_CUSTOM_TOKEN = 'ADD_CUSTOM_TOKEN',
    DELETE_CUSTOM_TOKEN = 'DELETE_CUSTOM_TOKEN',
    ADD_CUSTOM_TOKENS = 'ADD_CUSTOM_TOKENS',
    SEND_TOKEN = 'SEND_TOKEN',
    POPULATE_TOKEN_DATA = 'POPULATE_TOKEN_DATA',
    SEARCH_TOKEN = 'SEARCH_TOKEN',
}

enum SWAP {
    IS_APPROVED = 'IS_SWAP_APPROVED',
    APPROVE = 'APPROVE_SWAP',
    GET_QUOTE = 'GET_SWAP_QUOTE',
    GET_SWAP = 'GET_SWAP',
    EXECUTE_SWAP = 'EXECUTE_SWAP',
}

enum ADDRESS_BOOK {
    CLEAR = 'CLEAR',
    DELETE = 'DELETE',
    SET = 'SET',
    GET = 'GET',
    GET_BY_ADDRESS = 'GET_BY_ADDRESS',
    GET_RECENT_ADDRESSES = 'GET_RECENT_ADDRESSES',
}

export const Messages = {
    ACCOUNT,
    APP,
    BACKGROUND,
    BLANK,
    DAPP,
    EXTERNAL,
    NETWORK,
    PASSWORD,
    PERMISSION,
    STATE,
    ENS,
    TRANSACTION,
    WALLET,
    TOKEN,
    SWAP,
    ADDRESS_BOOK,
};

// [MessageType]: [RequestType, ResponseType, SubscriptionMessageType?]
export interface RequestSignatures {
    [Messages.ACCOUNT.CREATE]: [RequestAccountCreate, AccountInfo];
    [Messages.ACCOUNT.EXPORT_JSON]: [RequestAccountExportJson, string];
    [Messages.ACCOUNT.EXPORT_PRIVATE_KEY]: [RequestAccountExportPK, string];
    [Messages.ACCOUNT.IMPORT_JSON]: [RequestAccountImportJson, AccountInfo];
    [Messages.ACCOUNT.IMPORT_PRIVATE_KEY]: [
        RequestAccountImportPK,
        AccountInfo
    ];
    [Messages.ACCOUNT.REMOVE]: [RequestAccountRemove, boolean];
    [Messages.ACCOUNT.RENAME]: [RequestAccountRename, boolean];
    [Messages.ACCOUNT.SELECT]: [RequestAccountSelect, boolean];
    [Messages.APP.GET_IDLE_TIMEOUT]: [undefined, number];
    [Messages.APP.SET_IDLE_TIMEOUT]: [RequestSetIdleTimeout, void];
    [Messages.APP.SET_LAST_USER_ACTIVE_TIME]: [undefined, void];
    [Messages.APP.LOCK]: [undefined, boolean];
    [Messages.APP.UNLOCK]: [RequestAppUnlock, boolean];
    [Messages.APP.RETURN_TO_ONBOARDING]: [undefined, void];
    [Messages.APP.OPEN_RESET]: [undefined, void];
    [Messages.APP.SET_USER_SETTINGS]: [RequestUserSettings, UserSettings];
    [Messages.APP.UPDATE_POPUP_TAB]: [RequestUpdatePopupTab, void];
    [Messages.BACKGROUND.ACTION]: [];
    [Messages.BLANK.DEPOSIT]: [RequestBlankDeposit, string];
    [Messages.BLANK.ADD_NEW_DEPOSIT_TRANSACTION]: [
        RequestAddAsNewDepositTransaction,
        TransactionMeta
    ];
    [Messages.BLANK.UPDATE_DEPOSIT_TRANSACTION_GAS]: [
        RequestUpdateDepositTransactionGas,
        void
    ];
    [Messages.BLANK.APPROVE_DEPOSIT_TRANSACTIION]: [
        RequestApproveDepositTransaction,
        void
    ];
    [Messages.BLANK.GET_DEPOSIT_TRANSACTION_RESULT]: [
        RequestGetDepositTransactionResult,
        string
    ];
    [Messages.BLANK.CALCULATE_DEPOSIT_TRANSACTION_GAS_LIMIT]: [
        RequestCalculateDepositTransactionGasLimit,
        TransactionGasEstimation
    ];
    [Messages.BLANK.WITHDRAW]: [RequestBlankWithdraw, string];
    [Messages.BLANK.COMPLIANCE]: [RequestBlankCompliance, ComplianceInfo];
    [Messages.BLANK.PAIR_DEPOSITS_COUNT]: [
        RequestBlankPairDepositsCount,
        number
    ];
    [Messages.BLANK.CURRENCY_DEPOSITS_COUNT]: [
        RequestBlankCurrencyDepositsCount,
        ResponseBlankCurrencyDepositsCount
    ];
    [Messages.BLANK.GET_UNSPENT_DEPOSITS]: [undefined, IBlankDeposit[]];
    [Messages.BLANK.GET_DEPOSIT_NOTE_STRING]: [
        RequestBlankGetDepositNoteString,
        string
    ];
    [Messages.BLANK.UPDATE_SPENT_NOTES]: [undefined, void];
    [Messages.BLANK.GET_WITHDRAWAL_FEES]: [
        RequestBlankWithdrawalFees,
        ResponseBlankWithdrawalFees
    ];
    [Messages.BLANK.FORCE_DEPOSITS_IMPORT]: [undefined, void];
    [Messages.BLANK.HAS_DEPOSITED_FROM_ADDRESS]: [
        RequestBlankHasDepositedFromAddress,
        boolean
    ];
    [Messages.BLANK.GET_INSTANCE_ALLOWANCE]: [
        RequestBlankGetInstanceTokenAllowance,
        BigNumber
    ];
    [Messages.BLANK.GET_LATEST_DEPOSIT_DATE]: [
        RequestBlankGetLatestDepositDate,
        Date
    ];
    [Messages.DAPP.CONFIRM_REQUEST]: [RequestConfirmDappRequest, void];
    [Messages.EXTERNAL.REQUEST]: [RequestExternalRequest, unknown];
    [Messages.EXTERNAL.SETUP_PROVIDER]: [undefined, ProviderSetupData];
    [Messages.EXTERNAL.SET_METADATA]: [RequestSetMetadata, boolean];
    [Messages.NETWORK.CHANGE]: [RequestNetworkChange, boolean];
    [Messages.NETWORK.SET_SHOW_TEST_NETWORKS]: [
        RequestShowTestNetworks,
        boolean
    ];
    [Messages.NETWORK.ADD_NETWORK]: [RequestAddNetwork, void];
    [Messages.PASSWORD.VERIFY]: [RequestPasswordVerify, boolean];
    [Messages.PASSWORD.CHANGE]: [RequestPasswordChange, boolean];
    [Messages.PERMISSION.ADD_NEW]: [RequestAddNewSiteWithPermissions, boolean];
    [Messages.PERMISSION.CONFIRM]: [RequestConfirmPermission, boolean];
    [Messages.PERMISSION.GET_ACCOUNT_PERMISSIONS]: [
        RequestGetAccountPermissions,
        string[]
    ];
    [Messages.PERMISSION.REMOVE_ACCOUNT_FROM_SITE]: [
        RequestRemoveAccountFromSite,
        boolean
    ];
    [Messages.PERMISSION.UPDATE_SITE_PERMISSIONS]: [
        RequestUpdateSitePermissions,
        boolean
    ];
    [Messages.STATE.GET]: [undefined, ResponseGetState];
    [Messages.ENS.RESOLVE_NAME]: [RequestEnsResolve, string | null];
    [Messages.ENS.LOOKUP_ADDRESS]: [RequestEnsLookup, string | null];
    [Messages.TRANSACTION.CONFIRM]: [RequestConfirmTransaction, string];
    [Messages.TRANSACTION.REJECT]: [RequestRejectTransaction, boolean];
    [Messages.TRANSACTION.GET_LATEST_GAS_PRICE]: [undefined, BigNumber];
    [Messages.TRANSACTION.GET_LATEST_BASE_FEE]: [undefined, BigNumber];
    [Messages.TRANSACTION.CONFIRM]: [RequestConfirmTransaction, string];
    [Messages.TRANSACTION.SEND_ETHER]: [RequestSendEther, string];
    [Messages.TRANSACTION.ADD_NEW_SEND_TRANSACTION]: [
        RequestAddAsNewSendTransaction,
        TransactionMeta
    ];
    [Messages.TRANSACTION.UPDATE_SEND_TRANSACTION_GAS]: [
        RequestUpdateSendTransactionGas,
        void
    ];
    [Messages.TRANSACTION.APPROVE_SEND_TRANSACTION]: [
        RequestApproveSendTransaction,
        void
    ];
    [Messages.TRANSACTION.GET_SEND_TRANSACTION_RESULT]: [
        RequestSendTransactionResult,
        string
    ];
    [Messages.TRANSACTION.CALCULATE_APPROVE_TRANSACTION_GAS_LIMIT]: [
        RequestCalculateApproveTransactionGasLimit,
        TransactionGasEstimation
    ];
    [Messages.TRANSACTION.CALCULATE_SEND_TRANSACTION_GAS_LIMIT]: [
        RequestCalculateSendTransactionGasLimit,
        TransactionGasEstimation
    ];
    [Messages.TRANSACTION.CANCEL_TRANSACTION]: [RequestCancelTransaction, void];
    [Messages.TRANSACTION.SPEED_UP_TRANSACTION]: [
        RequestSpeedUpTransaction,
        void
    ];
    [Messages.WALLET.CREATE]: [RequestWalletCreate, void];
    [Messages.WALLET.IMPORT]: [RequestWalletImport, boolean];
    [Messages.WALLET.VERIFY_SEED_PHRASE]: [RequestVerifySeedPhrase, boolean];
    [Messages.WALLET.REQUEST_SEED_PHRASE]: [RequestSeedPhrase, string];
    [Messages.WALLET.SETUP_COMPLETE]: [RequestCompleteSetup, void];
    [Messages.WALLET.RESET]: [RequestWalletReset, boolean];
    [Messages.STATE.SUBSCRIBE]: [undefined, boolean, StateSubscription];
    [Messages.TOKEN.GET_BALANCE]: [RequestGetTokenBalance, BigNumber];
    [Messages.TOKEN.GET_TOKENS]: [RequestGetTokens, ITokens];
    [Messages.TOKEN.GET_USER_TOKENS]: [RequestGetUserTokens, ITokens];
    [Messages.TOKEN.GET_TOKEN]: [RequestGetToken, Token];
    [Messages.TOKEN.ADD_CUSTOM_TOKEN]: [RequestAddCustomToken, void | void[]];
    [Messages.TOKEN.DELETE_CUSTOM_TOKEN]: [RequestDeleteCustomToken, void];
    [Messages.TOKEN.ADD_CUSTOM_TOKENS]: [RequestAddCustomTokens, void | void[]];
    [Messages.TOKEN.SEND_TOKEN]: [RequestSendToken, string];
    [Messages.TOKEN.POPULATE_TOKEN_DATA]: [RequestPopulateTokenData, Token];
    [Messages.TOKEN.SEARCH_TOKEN]: [RequestSearchToken, Token[]];
    [Messages.EXTERNAL.EVENT_SUBSCRIPTION]: [
        undefined,
        boolean,
        ExternalEventSubscription
    ];
    [Messages.SWAP.IS_APPROVED]: [RequestIsSwapApproved, boolean];
    [Messages.SWAP.APPROVE]: [RequestApproveSwap, boolean];
    [Messages.SWAP.GET_QUOTE]: [RequestGetSwapQuote, BigNumber];
    [Messages.SWAP.GET_SWAP]: [RequestGetSwap, Swap];
    [Messages.SWAP.EXECUTE_SWAP]: [RequestExecuteSwap, string];
    [Messages.ADDRESS_BOOK.CLEAR]: [RequestAddressBookClear, boolean];
    [Messages.ADDRESS_BOOK.DELETE]: [RequestAddressBookDelete, boolean];
    [Messages.ADDRESS_BOOK.SET]: [RequestAddressBookSet, boolean];
    [Messages.ADDRESS_BOOK.GET]: [RequestAddressBookGet, NetworkAddressBook];
    [Messages.ADDRESS_BOOK.GET_BY_ADDRESS]: [
        RequestAddressBookGetByAddress,
        AddressBookEntry | undefined
    ];
    [Messages.ADDRESS_BOOK.GET_RECENT_ADDRESSES]: [
        RequestAddressBookGetRecentAddresses,
        NetworkAddressBook
    ];
}

export type MessageTypes = keyof RequestSignatures;

export type RequestTypes = {
    [MessageType in keyof RequestSignatures]: RequestSignatures[MessageType][0];
};

export interface RequestAccountCreate {
    name: string;
}

export interface RequestAccountExportJson {
    address: string;
    password: string;
    encryptPassword: string;
}

export interface RequestAccountExportPK {
    address: string;
    password: string;
}

export interface RequestAccountImportJson {
    importArgs: ImportArguments[ImportStrategy.JSON_FILE];
    name: string;
}

export interface RequestAccountImportPK {
    importArgs: ImportArguments[ImportStrategy.PRIVATE_KEY];
    name: string;
}

export interface RequestAccountRemove {
    address: string;
}

export interface RequestAccountRename {
    address: string;
    name: string;
}

export interface RequestAccountSelect {
    address: string;
}

export interface RequestAppUnlock {
    password: string;
}

export interface RequestSetIdleTimeout {
    idleTimeout: number;
}

export interface RequestConfirmDappRequest {
    id: string;
    isConfirmed: boolean;
    confirmOptions?: DappRequestConfirmOptions;
}

export type RequestExternalRequest = RequestArguments;

export interface RequestSetMetadata {
    siteMetadata: SiteMetadata;
}

export interface RequestBlankDeposit {
    pair: CurrencyAmountPair;
    unlimitedAllowance?: boolean;
    feeData: FeeData;
}

export interface RequestAddAsNewDepositTransaction {
    currencyAmountPair: CurrencyAmountPair;
    unlimitedAllowance?: boolean;
    feeData: FeeData;
}

export interface RequestUpdateDepositTransactionGas {
    transactionId: string;
    feeData: FeeData;
}

export interface RequestApproveDepositTransaction {
    transactionId: string;
}

export interface RequestGetDepositTransactionResult {
    transactionId: string;
}

export interface RequestCalculateDepositTransactionGasLimit {
    currencyAmountPair: CurrencyAmountPair;
}

export interface RequestBlankWithdraw {
    pair: CurrencyAmountPair;
    accountAddressOrIndex?: string | number;
}

export interface RequestBlankGetDepositNoteString {
    id: string;
}

export interface RequestBlankCompliance {
    id: string;
}

export interface RequestBlankPairDepositsCount {
    pair: CurrencyAmountPair;
}

export interface RequestBlankCurrencyDepositsCount {
    currency: KnownCurrencies;
}

export type ResponseBlankCurrencyDepositsCount = {
    pair: CurrencyAmountPair;
    count: number;
}[];

export interface RequestBlankWithdrawalFees {
    pair: CurrencyAmountPair;
}

export interface RequestBlankGetInstanceTokenAllowance {
    pair: CurrencyAmountPair;
}

export interface RequestBlankGetLatestDepositDate {
    pair: CurrencyAmountPair;
}

export interface ResponseBlankWithdrawalFees {
    gasFee: BigNumber;
    relayerFee: BigNumber;
    totalFee: BigNumber;
    total: BigNumber;
}

export interface RequestBlankHasDepositedFromAddress {
    pair?: CurrencyAmountPair;
    withdrawAddress: string;
}

export interface RequestNetworkChange {
    networkName: string;
}

export interface RequestShowTestNetworks {
    showTestNetworks: boolean;
}
export interface RequestAddNetwork {
    name: string;
    rpcUrl: string;
    chainId: string;
    currencySymbol: string;
    blockExplorerUrl: string;
}

export interface RequestPasswordVerify {
    password: string;
}

export interface RequestPasswordChange {
    password: string;
}

export interface RequestEnsResolve {
    name: string;
}

export interface RequestEnsLookup {
    address: string;
}

export interface RequestAddNewSiteWithPermissions {
    accounts: string[];
    origin: string;
    siteMetadata: SiteMetadata;
}

export interface RequestConfirmPermission {
    id: string;
    accounts: string[] | null;
}

export interface RequestGetAccountPermissions {
    account: string;
}

export interface RequestRemoveAccountFromSite {
    origin: string;
    account: string;
}

export interface RequestUpdateSitePermissions {
    origin: string;
    accounts: string[] | null;
}

export interface RequestConfirmTransaction {
    id: string;
    feeData: FeeData;
}

export interface RequestSendEther {
    to: string;
    value: BigNumber;
    feeData: FeeData;
}

export interface RequestWalletCreate {
    password: string;
}

export interface RequestSeedPhrase {
    password: string;
}
export interface RequestCompleteSetup {}

export interface RequestWalletImport {
    password: string;
    seedPhrase: string;
    reImport?: boolean;
}

export interface RequestWalletReset {
    password: string;
    seedPhrase: string;
}

export interface RequestVerifySeedPhrase {
    password: string;
    seedPhrase: string;
}

export interface RequestGetTokenBalance {
    tokenAddress: string;
    account: string;
}

export interface RequestGetTokens {
    chainId?: number;
}
export interface RequestGetUserTokens {
    accountAddress?: string;
    chainId?: number;
}

export interface RequestGetToken {
    tokenAddress: string;
    accountAddress?: string;
    chainId?: number;
}

export interface RequestAddCustomToken {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logo: string;
    type: string;
}
export interface RequestDeleteCustomToken {
    address: string;
    accountAddress?: string;
    chainId?: number;
}

export interface RequestAddCustomTokens {
    tokens: RequestAddCustomToken[];
    accountAddress?: string;
    chainId?: number;
}

export interface RequestSendToken {
    tokenAddress: string;
    to: string;
    value: BigNumber;
    feeData: FeeData;
}

export interface RequestAddAsNewSendTransaction {
    address: string;
    to: string;
    value: BigNumber;
    feeData: FeeData;
}

export interface RequestUpdateSendTransactionGas {
    transactionId: string;
    feeData: FeeData;
}

export interface RequestApproveSendTransaction {
    transactionId: string;
}

export interface RequestSendTransactionResult {
    transactionId: string;
}

export interface RequestCalculateSendTransactionGasLimit {
    address: string;
    to: string;
    value: BigNumber;
}

export interface RequestCancelTransaction {
    transactionId: string;
    gasValues?: GasPriceValue;
}

export interface RequestSpeedUpTransaction {
    transactionId: string;
    gasValues?: GasPriceValue;
}

export interface RequestCalculateApproveTransactionGasLimit {
    tokenAddress: string;
    spender: string;
    amount: BigNumber | 'UNLIMITED';
}

export interface RequestPopulateTokenData {
    tokenAddress: string;
}

export interface RequestSearchToken {
    query: string;
    exact?: boolean;
    accountAddress?: string;
    chainId?: number;
}

export interface RequestIsSwapApproved {
    amount: BigNumber;
    tokenAddress: string;
}

export interface RequestApproveSwap {
    tokenAddress: string;
    customGasPrice?: BigNumber;
}

export interface RequestGetSwapQuote {
    quoteParams: QuoteParameters;
}

export interface RequestGetSwap {
    swapParams: SwapParameters;
}

export interface RequestExecuteSwap {
    swap: Swap;
}

export interface RequestRejectTransaction {
    transactionId: string;
}

export interface RequestAddressBookClear {}

export interface RequestAddressBookDelete {
    address: string;
}

export interface RequestAddressBookSet {
    address: string;
    name: string;
    note?: string;
}

export interface RequestAddressBookGet {}
export interface RequestAddressBookGetByAddress {
    address: string;
}
export interface RequestAddressBookGetRecentAddresses {
    limit?: number;
}
export interface RequestUserSettings {
    settings: UserSettings;
}

export interface RequestUpdatePopupTab {
    popupTab: PopupTabs;
}

export type ResponseTypes = {
    [MessageType in keyof RequestSignatures]: RequestSignatures[MessageType][1];
};

export type ResponseType<TMessageType extends keyof RequestSignatures> =
    RequestSignatures[TMessageType][1];

export interface ResponseBlankGetWithdrawalGasCost {
    estimatedGas: BigNumber;
    fee: BigNumber;
    total: BigNumber;
}

export type ResponseGetState = Flatten<BlankAppUIState>;

export type SubscriptionMessageTypes = {
    [MessageType in keyof RequestSignatures]: RequestSignatures[MessageType][2];
};

export type StateSubscription = Flatten<BlankAppUIState>;

export interface ExternalEventSubscription {
    eventName: ProviderEvents;
    payload: any;
}

export interface TransportRequestMessage<TMessageType extends MessageTypes> {
    id: string;
    message: TMessageType;
    request: RequestTypes[TMessageType];
}

export interface WindowTransportRequestMessage
    extends TransportRequestMessage<EXTERNAL> {
    origin: Origin;
}

export interface TransportResponseMessage<TMessageType extends MessageTypes> {
    error?: string;
    id: string;
    response?: ResponseTypes[TMessageType];
    subscription?: SubscriptionMessageTypes[TMessageType];
}

export interface WindowTransportResponseMessage
    extends TransportResponseMessage<EXTERNAL> {
    origin: Origin;
}

export enum Origin {
    BACKGROUND = 'BLANK_BACKGROUND',
    EXTENSION = 'BLANK_EXTENSION',
    PROVIDER = 'BLANK_PROVIDER',
}

export interface ExtensionInstances {
    [id: string]: { port: chrome.runtime.Port };
}

export interface ProviderInstances {
    [id: string]: ProviderInstance;
}

export interface ProviderInstance {
    port: chrome.runtime.Port;
    tabId: number;
    origin: string;
    siteMetadata: SiteMetadata;
}

export interface Handler {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    subscriber?: (data: any) => void;
}

export type Handlers = Record<string, Handler>;

export enum BackgroundActions {
    CLOSE_WINDOW = 'CLOSE_WINDOW',
}
