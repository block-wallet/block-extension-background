import {
    DappRequest,
    DappRequestParams,
    DappRequestType,
    JSONRPCMethod,
    ProviderError,
    SignatureTypes,
    TransactionRequest,
    sigVersion,
    RawSignatureData,
    WindowRequest,
    WindowRequestArguments,
    DappReq,
    ExtProviderMethods,
    WatchAssetParameters,
    SwitchEthereumChainParameters,
    AddEthereumChainParameter,
    WatchAssetReq,
    DappRequestConfirmOptions,
    SubscriptionParams,
    SubscriptionType,
    Subscription,
    Block,
} from '../utils/types/ethereum';
import { v4 as uuid } from 'uuid';
import { BaseController } from '../infrastructure/BaseController';
import {
    ProviderEvents,
    RequestArguments,
    ProviderSetupData,
    ChainChangedInfo,
    EthSubscription,
    ProviderConnectInfo,
} from '@blank/provider/types';
import { isEmpty } from 'lodash';
import AppStateController, {
    AppStateControllerMemState,
} from './AppStateController';
import NetworkController, {
    NetworkControllerState,
    NetworkEvents,
} from './NetworkController';
import { ethers } from 'ethers';
import {
    ExternalEventSubscription,
    Handler,
    Handlers,
} from '../utils/types/communication';
import {
    TransactionController,
    TransactionVolatileControllerState,
} from './transactions/TransactionController';
import PermissionsController, {
    PermissionsControllerState,
} from './PermissionsController';
import { closeExtensionInstance, openPopup } from '../utils/popup';
import {
    extensionInstances,
    providerInstances,
} from '../infrastructure/connection';
import { normalizeMessageData, validateSignature } from '../utils/signature';
import { hexValue } from 'ethers/lib/utils';
import {
    ACTIONS_TIME_INTERVALS_DEFAULT_VALUES,
    Network,
} from '../utils/constants/networks';
import { validateWatchAssetReq } from '../utils/token';
import { TokenController } from './erc-20/TokenController';
import { Token } from './erc-20/Token';
import { validateChainId } from '../utils/ethereumChain';
import log from 'loglevel';
import KeyringControllerDerivated from './KeyringControllerDerivated';
import { randomBytes } from '../utils/randomBytes';
import BlockUpdatesController, {
    BlockUpdatesEvents,
} from './block-updates/BlockUpdatesController';
import { Filter } from '@ethersproject/abstract-provider';
import {
    parseBlock,
    validateLogSubscriptionRequest,
} from '../utils/subscriptions';
import { ActionIntervalController } from './block-updates/ActionIntervalController';
import { focusWindow, switchToTab } from '../utils/window';

export enum BlankProviderEvents {
    SUBSCRIPTION_UPDATE = 'SUBSCRIPTION_UPDATE',
}

interface ActiveSubscriptions {
    [id: string]: Subscription;
}

interface LastRequest {
    time: number;
    tabId: number;
    windowId: number;
}

export interface BlankProviderControllerState {
    dappRequests: { [id: string]: DappRequest<DappRequestType> };
}

/**
 * Blank ethereum provider controller
 *
 */
export default class BlankProviderController extends BaseController<BlankProviderControllerState> {
    private readonly _providerSubscriptionUpdateIntervalController: ActionIntervalController;
    private _unlockHandlers: Handler[];
    private _requestHandlers: Handlers;
    private _activeSubscriptions: ActiveSubscriptions;
    private _isConnected: boolean;
    private _lastRequest: LastRequest | null;

    constructor(
        private readonly _networkController: NetworkController,
        private readonly _transactionController: TransactionController,
        private readonly _permissionsController: PermissionsController,
        private readonly _appStateController: AppStateController,
        private readonly _keyringController: KeyringControllerDerivated,
        private readonly _tokenController: TokenController,
        private readonly _blockUpdatesController: BlockUpdatesController
    ) {
        super({ dappRequests: {} });

        this._providerSubscriptionUpdateIntervalController =
            new ActionIntervalController(this._networkController);
        this._unlockHandlers = [];
        this._requestHandlers = {};
        this._activeSubscriptions = {};
        this._isConnected = false;
        this._lastRequest = null;

        // Setup connection status
        this._handleConnectionStatus(this._networkController.store.getState());

        this._networkController.store.subscribe(this._handleConnectionStatus);

        // Network change updates
        this._networkController.on(
            NetworkEvents.NETWORK_CHANGE,
            async ({ chainId }: Network) => {
                const networkVersion = await this._getNetworkVersion();

                // Emit network change event
                // Needed to comply with: EIP1193 https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1193.md
                this._emitChainChanged({
                    chainId: hexValue(chainId),
                    networkVersion,
                });

                // Remove existing subscriptions
                this._activeSubscriptions = {};
            }
        );

        // Set watchers
        this._blockUpdatesController.on(
            BlockUpdatesEvents.BLOCK_UPDATES_SUBSCRIPTION,
            this.handleBlockUpdatesSubscriptions
        );

        this._transactionController.UIStore.subscribe(
            this._stateWatcher.TRANSACTIONS
        );

        this._appStateController.UIStore.subscribe(this._stateWatcher.LOCK);

        this._permissionsController.store.subscribe(
            this._stateWatcher.PERMISSIONS
        );

        this.store.subscribe(this._stateWatcher.DAPP);
    }

    /**
     * Callback method to handle subscriptions that
     * is triggered every block update.
     *
     * @param chainId The current network chainId
     * @param previousBlockNumber The previous update block number
     * @param newBlockNumber The new update block number
     */
    public handleBlockUpdatesSubscriptions = (
        chainId: number,
        previousBlockNumber: number,
        newBlockNumber: number
    ): void => {
        const network = this._networkController.getNetworkFromChainId(chainId);
        const interval =
            network?.actionsTimeIntervals.providerSubscriptionsUpdate ||
            ACTIONS_TIME_INTERVALS_DEFAULT_VALUES.providerSubscriptionsUpdate;

        this._providerSubscriptionUpdateIntervalController.tick(
            interval,
            async () => {
                for (const subscriptionId in this._activeSubscriptions) {
                    this._activeSubscriptions[subscriptionId].notification(
                        chainId,
                        previousBlockNumber,
                        newBlockNumber
                    );
                }
            }
        );
    };

    /**
     * Setup the provider id and saves the site metadata
     *
     * @returns provider setup data
     */
    public setupProvider = async (
        portId: string
    ): Promise<ProviderSetupData> => {
        const accounts = this._accountsRequest(portId);

        if (!this._isConnected) {
            return { accounts } as ProviderSetupData;
        }

        const chainId = await this._getChainId();
        const networkVersion = await this._getNetworkVersion();

        return {
            accounts,
            chainId,
            networkVersion,
        };
    };

    /**
     * Set icon url for the given provider instance port id
     */
    public setIcon = (iconURL: string, portId: string): void => {
        // Update site metadata
        providerInstances[portId].siteMetadata.iconURL = iconURL;
    };

    /**
     * Handle account updates for each origin
     *
     */
    public handleAccountUpdates = (
        portId: string,
        eventData: ExternalEventSubscription
    ): ExternalEventSubscription => {
        eventData.payload = this._accountsRequest(portId);

        return eventData;
    };

    /**
     * It rejects all pending DApp requests
     *
     * @param ignoreSwitchNetwork If true switch network requests won't be cancelled
     */
    public cancelPendingDAppRequests(ignoreSwitchNetwork = false): void {
        // Get active requests
        const requests = { ...this.store.getState().dappRequests };

        for (const [id, handler] of Object.entries(requests)) {
            if (
                !ignoreSwitchNetwork ||
                handler.type !== DappReq.SWITCH_NETWORK
            ) {
                this._requestHandlers[id].reject(
                    new Error(ProviderError.USER_REJECTED_REQUEST)
                );

                // Delete each request and its handler
                delete this._requestHandlers[id];
                delete requests[id];
            }
        }

        this.store.updateState({
            dappRequests: requests,
        });
    }

    /**
     * Reject all unlock awaits
     */
    public rejectUnlocks = (): void => {
        this._unlockHandlers.forEach((handler) => {
            handler.reject(new Error(ProviderError.USER_REJECTED_REQUEST));
        });

        this._unlockHandlers = [];
    };

    //=============================================================================
    // ETHEREUM METHODS
    //=============================================================================

    /**
     * Ethereum requests handler
     *
     * @param portId Request origin port id
     * @param method String name of the method requested from external source
     * @param params Parameters passed to the method called from external source
     */
    public handle = async (
        portId: string,
        { method, params }: RequestArguments
    ): Promise<unknown> => {
        if (!providerInstances[portId]) {
            log.error(`No data has been found for provider ${portId}`);
            throw new Error(ProviderError.UNAUTHORIZED);
        }

        switch (method) {
            case JSONRPCMethod.eth_blockNumber:
                return this._blockUpdatesController.getBlockNumber();
            case JSONRPCMethod.eth_accounts:
                return this._accountsRequest(portId, true);
            case JSONRPCMethod.eth_chainId:
                return this._getChainId();
            case JSONRPCMethod.eth_getCode:
                if (params) {
                    if (
                        (params as Record<string, unknown>[]).length < 2 &&
                        !(params as Record<string, unknown>[]).includes(
                            'latest' as unknown as Record<string, unknown>
                        )
                    ) {
                        (params as Record<string, unknown>[]).push(
                            'latest' as unknown as Record<string, unknown>
                        );
                    }
                }
                return this._networkController
                    .getProvider()
                    .send(method, params as unknown[]);
            case JSONRPCMethod.eth_requestAccounts:
                return this._connectionRequest(portId);
            case JSONRPCMethod.eth_sendTransaction:
                return this._handleSendTransaction(
                    params as [TransactionRequest],
                    portId
                );
            case JSONRPCMethod.eth_signTypedData:
            case JSONRPCMethod.eth_signTypedData_v1:
            case JSONRPCMethod.eth_signTypedData_v3:
            case JSONRPCMethod.eth_signTypedData_v4:
            case JSONRPCMethod.personal_sign:
                return this._handleMessageSigning(
                    method,
                    params as RawSignatureData[SignatureTypes],
                    portId
                );
            case JSONRPCMethod.eth_subscribe:
                return this._createSubscription(
                    params as unknown as SubscriptionParams,
                    portId
                );
            case JSONRPCMethod.eth_unsubscribe:
                return this._handleUnsubscribe(params as string[]);
            case JSONRPCMethod.wallet_addEthereumChain:
                return this._handleAddEthereumChain(
                    params as [AddEthereumChainParameter],
                    portId
                );
            case JSONRPCMethod.wallet_getPermissions:
                return this._handleGetPermissions(portId);
            case JSONRPCMethod.wallet_requestPermissions:
                return this._handleWalletRequestPermissions(
                    params as Record<string, unknown>[],
                    portId
                );
            case JSONRPCMethod.wallet_switchEthereumChain:
                return this._handleSwitchEthereumChain(
                    params as [SwitchEthereumChainParameters],
                    portId
                );
            case JSONRPCMethod.wallet_watchAsset:
                return this._handleWalletWatchAsset(
                    params as unknown as WatchAssetParameters,
                    portId
                );
            case JSONRPCMethod.web3_sha3:
                return this._sha3(params);
            default:
                // If it's a standard json rpc request, forward it to the provider
                if (ExtProviderMethods.includes(method)) {
                    return this._networkController
                        .getProvider()
                        .send(method, params as unknown[]);
                } else {
                    log.error(`Unsupported method: ${method}`);
                    throw new Error(ProviderError.UNSUPPORTED_METHOD);
                }
        }
    };

    /**
     * Internal method to handle external method eth_sendTransaction
     *
     * @param params - Object with transaction data (TransactionRequest)
     * @param portId Request origin port id
     */
    private _handleSendTransaction = async (
        params: [TransactionRequest],
        portId: string
    ): Promise<string> => {
        const { result } = await this._transactionController.addTransaction({
            transaction: params[0],
            origin: providerInstances[portId].origin,
            originId: portId,
        });

        return result;
    };

    /**
     * Internal method to apply keccak256 function to given data eth_sha3
     *
     * @dev Ethereum incorrectly refers to keccak256 function as sha3 (legacy mistake)
     * @param params - request params
     */
    private _sha3 = (
        params: readonly unknown[] | Record<string, unknown> | undefined
    ) => {
        if (params && Array.isArray(params) && typeof params[0] === 'string') {
            return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(params[0]));
        } else {
            throw new Error(
                `Wrong input data for web3_sha3: ${params}. See https://eth.wiki/json-rpc/API#web3_sha3`
            );
        }
    };

    /**
     * Returns network stored chain id
     */
    private _getChainId = async (): Promise<string> => {
        // We must use network stored chainId due to security implications.
        // See: https://eips.ethereum.org/EIPS/eip-3085#security-considerations
        const { chainId } = this._networkController.network;

        return hexValue(chainId);
    };

    /**
     * Returns network stored network version
     */
    private _getNetworkVersion = async (): Promise<string> => {
        const { networkVersion } = this._networkController.network;

        return networkVersion;
    };

    //=============================================================================
    // SUBSCRIPTIONS
    //=============================================================================

    /**
     * eth_subscribe handler
     * Creates a new subscription, returns the subscription ID to the dapp.
     */
    private _createSubscription = async (
        params: SubscriptionParams,
        portId: string
    ): Promise<string> => {
        const subscriptionId = '0x' + randomBytes(16).toString('hex');
        const subscriptionType = params[0];
        let subscription = {
            id: subscriptionId,
            type: subscriptionType,
            portId: portId,
        } as Subscription;

        switch (subscriptionType) {
            case SubscriptionType.newHeads:
                subscription = {
                    ...subscription,
                    ...this._createNewHeadsSubscription(subscriptionId, portId),
                };
                break;
            case SubscriptionType.logs:
                subscription = {
                    ...subscription,
                    ...this._createLogsSubscription(
                        subscriptionId,
                        portId,
                        params[1] as {
                            address: string;
                            topics: Array<string | Array<string> | null>;
                        }
                    ),
                };
                break;
            default:
                throw new Error(ProviderError.UNSUPPORTED_SUBSCRIPTION_TYPE);
        }

        // Add to active subscriptions
        this._activeSubscriptions[subscriptionId] = subscription;

        return subscriptionId;
    };

    /*

    */
    private _createNewHeadsSubscription = (
        subscriptionId: string,
        portId: string
    ) => {
        return {
            notification: async (
                chainId: number,
                previousBlockNumber: number,
                newBlockNumber: number
            ) => {
                for (
                    let i = 1;
                    i <= newBlockNumber - previousBlockNumber;
                    i++
                ) {
                    if (chainId !== this._networkController.network.chainId) {
                        return;
                    }

                    const block: Block = parseBlock(
                        await this._networkController
                            .getProvider()
                            .send('eth_getBlockByNumber', [
                                '0x' + (previousBlockNumber + i).toString(16),
                                false,
                            ])
                    );

                    if (subscriptionId in this._activeSubscriptions) {
                        this._handleSubscriptionResponse(
                            portId,
                            subscriptionId,
                            block as unknown as Record<string, unknown>
                        );
                    } else {
                        return;
                    }
                }
            },
        } as Subscription;
    };

    private _createLogsSubscription = (
        subscriptionId: string,
        portId: string,
        filterParams: {
            address: string;
            topics: Array<string | Array<string> | null>;
        }
    ) => {
        validateLogSubscriptionRequest(filterParams);

        return {
            notification: async (
                chainId: number,
                previousBlockNumber: number,
                newBlockNumber: number
            ) => {
                previousBlockNumber++;
                if (chainId !== this._networkController.network.chainId) {
                    return;
                }

                const filter: Filter = {
                    fromBlock: previousBlockNumber,
                    toBlock: newBlockNumber,
                    ...filterParams,
                };

                const logs = await this._networkController
                    .getProvider()
                    .getLogs(filter);

                for (let j = 0; j < logs.length; j++) {
                    if (subscriptionId in this._activeSubscriptions) {
                        this._handleSubscriptionResponse(
                            portId,
                            subscriptionId,
                            logs[j] as unknown as Record<string, unknown>
                        );
                    } else {
                        return;
                    }
                }
            },
        } as Subscription;
    };

    /**
     * Method to handle eth_unsubscribe
     */
    private _handleUnsubscribe = async (params: string[]): Promise<boolean> => {
        const subscriptionId = params[0];

        // Remove subscription handler
        delete this._activeSubscriptions[subscriptionId];

        return true;
    };

    //=============================================================================
    // ACCOUNTS AND PERMISSIONS
    //=============================================================================

    /**
     * Internal method to handle eth_requestAccounts
     *
     * @param portId Request origin port id
     */
    private _connectionRequest = async (portId: string): Promise<string[]> => {
        const permissions = await this._permissionsController.connectionRequest(
            portId
        );

        // Trigger unlock before returning accounts
        // Just in case permissions were already granted
        const isUnlocked = await this._waitForUnlock();
        if (!isUnlocked) {
            return [];
        }

        // Update accounts on provider
        this._emitAccountsChanged();

        // Return active account
        return permissions;
    };

    /**
     * Get accounts with permissions to interact with the given provider instance origin.
     *
     * @param portId Request origin port id
     * @param emitUpdate If true the accounts change event will be emitted.
     */
    private _accountsRequest = (portId: string, emitUpdate = false) => {
        // Return empty array if app is locked
        if (!this._appStateController.UIStore.getState().isAppUnlocked) {
            return [];
        }

        if (emitUpdate) {
            this._emitAccountsChanged();
        }

        return this._permissionsController.getAccounts(
            providerInstances[portId].origin
        );
    };

    /**
     * Returns permissions granted with EIP-2255 standard
     *
     * @param params Request params
     * @param portId Request origin port id
     */
    private _handleWalletRequestPermissions = (
        params: Record<string, unknown>[],
        portId: string
    ) => {
        // We only grant permissions for the eth_accounts method
        // We only check on the first element of the array
        if (params && JSONRPCMethod.eth_accounts in params[0]) {
            return this._connectionRequest(portId);
        }
    };

    /**
     * Handles permission request for wallet_getPermissions method
     * EIP-2255
     *
     * @param portId Request origin port id
     */
    private _handleGetPermissions = (portId: string) => {
        const accounts = this._accountsRequest(portId, true);

        if (accounts.length < 1) {
            return { invoker: origin };
        }

        return {
            invoker: origin,
            parentCapability: 'eth_accounts',
            caveats: [
                {
                    type: 'limitResponseLength',
                    value: 1,
                    name: 'primaryAccountOnly',
                },
                {
                    type: 'filterResponse',
                    value: accounts,
                    name: 'exposedAccounts',
                },
            ],
        };
    };

    //=============================================================================
    // DAPP REQUESTS
    //=============================================================================

    /**
     * Wallet add ethereum chain handler
     * EIP-3085
     */
    private _handleAddEthereumChain = async (
        params: [AddEthereumChainParameter],
        portId: string
    ) => {
        const data = params[0];
        if (!data) return;

        // Validate and normalize switchEthereumChain params
        const { chainId } = data;
        const normalizedChainId = validateChainId(chainId);

        // TODO: Replace networks object to store them by chainId instead of by name
        const network =
            this._networkController.getNetworkFromChainId(normalizedChainId);

        // We must check whether the network is known to us first.
        if (network && network.enable) {
            // If known, call handleSwitchEthereumChain
            await this._handleSwitchEthereumChain([{ chainId }], portId);
        } else {
            // TODO: Implement add network logic
            throw new Error(ProviderError.UNSUPPORTED_METHOD);
        }
    };

    /**
     * Wallet switch ethereum chain handler
     * EIP-3326
     */
    private _handleSwitchEthereumChain = async (
        params: [SwitchEthereumChainParameters],
        portId: string
    ) => {
        const { origin } = providerInstances[portId];

        // Throw if there's already a request to switch networks from that origin
        const currentRequests = { ...this.store.getState().dappRequests };
        Object.values(currentRequests).forEach((req) => {
            if (req.type === DappReq.SWITCH_NETWORK && req.origin === origin) {
                throw new Error(ProviderError.RESOURCE_UNAVAILABLE);
            }
        });

        const chainId = params[0].chainId;

        // Validate and normalize switchEthereumChain params
        const normalizedChainId = validateChainId(chainId);
        const network =
            this._networkController.getNetworkFromChainId(normalizedChainId);

        // We must ensure that the network is known to us first.
        if (network) {
            // If user is already on that network, return null (i.e. success)
            if (normalizedChainId === this._networkController.network.chainId) {
                return null;
            }
        } else {
            // TODO: Mitigate privacy concerns described on task
            throw new Error(
                'Unrecognized chainId. Try adding it using wallet_addEthereumChain first'
            );
        }

        // Submit request
        const { isAccepted, reqId, callback } = await this._submitDappRequest(
            DappReq.SWITCH_NETWORK,
            { chainId: normalizedChainId },
            portId
        );

        try {
            // Check if the user accepted the request so we can change the network
            // or reject the request otherwise
            if (isAccepted) {
                // Change the network to the specified one
                const result = await this._networkController.setNetwork(
                    network.name
                );

                // If the network was not changed (timeout, uncaught error, etc) return an error
                if (!result) {
                    throw new Error(
                        'An error occurred while switching the wallet active chain'
                    );
                }

                // Cancel pending DApp requests
                this.cancelPendingDAppRequests(true);

                // By EIP-3326, the method MUST return null if the request was successful
                return null;
            } else {
                throw new Error(ProviderError.USER_REJECTED_REQUEST);
            }
        } finally {
            // Resolve the handleDapRequest callback
            callback.resolve();

            // Remove current request from list
            this.removeDappRequest(reqId);
        }
    };

    /**
     * Typed structured data hashing and signing
     * EIP-712
     */
    private _handleMessageSigning = async <
        TSignatureType extends SignatureTypes
    >(
        method: TSignatureType,
        params: RawSignatureData[TSignatureType],
        portId: string
    ) => {
        const { origin } = providerInstances[portId];

        // Get chain id
        const chainId = await this._getChainId();

        // Validate and standardize signature params
        const normalizedParams = validateSignature(method, params, chainId);

        // Check if the account has permissions
        const hasPermission = this._permissionsController.accountHasPermissions(
            origin,
            normalizedParams.address
        );
        if (!hasPermission) {
            log.debug('Account has no permissions');
            throw new Error(ProviderError.UNAUTHORIZED);
        }

        // Submit request
        const { isAccepted, reqId, callback } = await this._submitDappRequest(
            DappReq.SIGNING,
            { method, params: normalizedParams },
            portId
        );

        try {
            if (isAccepted) {
                let signedMessage: string;
                // Sign
                if (method === JSONRPCMethod.personal_sign) {
                    signedMessage =
                        await this._keyringController.signPersonalMessage({
                            from: normalizedParams.address,
                            data: normalizeMessageData(
                                normalizedParams.data as string
                            ),
                        });
                } else {
                    signedMessage =
                        await this._keyringController.signTypedMessage(
                            {
                                from: normalizedParams.address,
                                data: normalizedParams.data,
                            },
                            sigVersion[method]
                        );
                }
                return signedMessage;
            } else {
                throw new Error(ProviderError.USER_REJECTED_REQUEST);
            }
        } finally {
            // Resolve the handleDapRequest callback
            callback.resolve();

            // Remove current request from list
            this.removeDappRequest(reqId);
        }
    };

    /**
     * Wallet watch asset (new asset tracking)
     * EIP-747
     */
    private _handleWalletWatchAsset = async (
        params: WatchAssetParameters,
        portId: string
    ): Promise<boolean> => {
        const { chainId } = this._networkController.network;
        let isUpdate = false;
        let savedToken: WatchAssetReq['params'] | undefined;

        // Check if it is an ERC20 asset
        if (params.type !== 'ERC20') {
            throw new Error(
                'wallet_watchAsset is only enabled for ERC20 assets'
            );
        }

        // Validate parameters
        const validParams = validateWatchAssetReq(params.options);

        // Return if there's already a request to add that token
        const currentRequests = { ...this.store.getState().dappRequests };
        Object.values(currentRequests).forEach((req) => {
            if (req.type === DappReq.ASSET) {
                const reqParams = req.params as WatchAssetReq;
                if (reqParams.params.address === validParams.address) {
                    throw new Error(ProviderError.RESOURCE_UNAVAILABLE);
                }
            }
        });

        // Get active account (if any)
        const activeAccount: string | undefined =
            this._permissionsController.getAccounts(
                providerInstances[portId].origin
            )[0];

        // Check if token already exists on user profile
        const tokenSearchResult = (
            await this._tokenController.getUserTokens(activeAccount, chainId)
        )[validParams.address];

        if (
            tokenSearchResult &&
            tokenSearchResult.address === validParams.address
        ) {
            // Warn about update
            isUpdate = true;
            // Set saved token parameters
            savedToken = {
                address: tokenSearchResult.address,
                symbol: tokenSearchResult.symbol,
                decimals: tokenSearchResult.decimals,
                image: tokenSearchResult.logo,
            };
        }

        // Submit dapp request
        const { isAccepted, reqId, confirmOptions, callback } =
            await this._submitDappRequest(
                DappReq.ASSET,
                { params: validParams, activeAccount, isUpdate, savedToken },
                portId
            );

        try {
            if (isAccepted) {
                if (!confirmOptions) {
                    throw new Error('Missing updated token parameters');
                }

                await this._tokenController.addCustomToken(
                    new Token(
                        validParams.address,
                        confirmOptions.symbol,
                        confirmOptions.symbol,
                        confirmOptions.decimals,
                        'ERC20',
                        confirmOptions.image
                    ),
                    activeAccount
                );

                return true;
            } else {
                throw new Error(ProviderError.USER_REJECTED_REQUEST);
            }
        } finally {
            // Resolve the handleDapRequest callback
            callback.resolve();

            // Remove current request from list
            this.removeDappRequest(reqId);
        }
    };

    /**
     * Submits a dapp request to the provider state to be handled by the UI
     *
     * @param type Request type
     * @param params Request parameters
     * @param originId Provider instance id
     */
    private _submitDappRequest = async <RequestType extends DappRequestType>(
        type: RequestType,
        params: DappRequestParams[RequestType],
        originId: string
    ): Promise<{
        isAccepted: boolean;
        reqId: string;
        confirmOptions?: DappRequestConfirmOptions;
        callback: {
            resolve: (value: void | PromiseLike<void>) => void;
            reject: (reason?: unknown) => void;
        };
    }> => {
        return new Promise((resolve, reject): void => {
            const { origin, siteMetadata } = providerInstances[originId];

            // Get current requests
            const requests = { ...this.store.getState().dappRequests };

            // Generate ID
            const id = uuid();

            // Add request to state
            requests[id] = {
                type,
                params,
                origin,
                originId,
                siteMetadata,
                time: Date.now(),
            };

            this.store.updateState({
                dappRequests: requests,
            });

            // Add response handler
            this._requestHandlers[id] = { reject, resolve };
        });
    };

    /**
     * Dapp request handle
     *
     */
    public handleDappRequest = (
        id: string,
        isConfirmed: boolean,
        confirmOptions?: DappRequestConfirmOptions
    ): Promise<void> => {
        const handler = this._requestHandlers[id];

        if (!handler) {
            throw new Error(`Unable to confirm dapp request - id: ${id}`);
        }

        return new Promise((resolve, reject) => {
            handler.resolve({
                isAccepted: isConfirmed,
                reqId: id,
                confirmOptions,
                callback: { resolve, reject },
            });
        });
    };

    /**
     * It removes a DApp request from the dictionary
     *
     * @param id The request id
     */
    public removeDappRequest = (id: string): void => {
        delete this._requestHandlers[id];

        // Get current requests
        const requests = { ...this.store.getState().dappRequests };

        // Delete submitted request
        delete requests[id];

        this.store.updateState({
            dappRequests: requests,
        });
    };

    //=============================================================================
    // EVENTS
    //=============================================================================

    /**
     * Subscription updates
     * @param eventData
     */
    private _updateEventSubscriptions = (
        eventData: ExternalEventSubscription
    ) => {
        this.emit(BlankProviderEvents.SUBSCRIPTION_UPDATE, eventData);
    };

    /**
     * Internal method to emit accountsChanged event
     */
    private _emitAccountsChanged = () => {
        this._updateEventSubscriptions({
            eventName: ProviderEvents.accountsChanged,
            payload: [],
        });
    };

    /**
     * Internal method to emit chain changed event
     * @param chainId
     */
    private _emitChainChanged = (chainChangedInfo: ChainChangedInfo) => {
        this._updateEventSubscriptions({
            eventName: ProviderEvents.chainChanged,
            payload: chainChangedInfo,
        });
    };

    /**
     * Internal method to emit connection updates
     */
    private _emitConnectionUpdate = async () => {
        if (this._isConnected === true) {
            const chainId = await this._getChainId();

            this._updateEventSubscriptions({
                eventName: ProviderEvents.connect,
                payload: { chainId } as ProviderConnectInfo,
            });
        } else {
            this._updateEventSubscriptions({
                eventName: ProviderEvents.disconnect,
                payload: undefined,
            });
        }
    };

    /**
     * Internal method to emit message event (for subscriptions)
     *
     * @param portId to which port is this message directed
     * @param subscriptionId provider given subscription id
     * @param payload data.result from subscription
     */
    private _handleSubscriptionResponse = (
        portId: string,
        subscriptionId: string,
        payload: Record<string, unknown>
    ) => {
        this._updateEventSubscriptions({
            eventName: ProviderEvents.message,
            payload: {
                type: 'eth_subscription',
                data: {
                    subscription: subscriptionId,
                    result: payload,
                },
            } as EthSubscription,
            portId,
        });
    };

    //=============================================================================
    // WINDOW MANAGEMENT
    //=============================================================================

    /**
     * Handles state updates for management of extension instances opened in windows
     */
    private _stateWatcher: {
        [req in WindowRequest]: (args: WindowRequestArguments[req]) => void;
    } = {
        DAPP: ({ dappRequests }: BlankProviderControllerState) => {
            if (!isEmpty(dappRequests)) {
                openPopup();
                this._checkLastRequest(dappRequests);
            } else {
                this._checkWindows();
            }
        },
        LOCK: (appState: AppStateControllerMemState) => {
            // Resolve unlock handlers if app is unlocked
            if (
                appState.isAppUnlocked === true &&
                this._unlockHandlers.length > 0
            ) {
                this._unlockHandlers.forEach((handler) => {
                    handler.resolve(true);
                });

                this._unlockHandlers = [];

                // Close open windows
                this._checkWindows();
            }

            // Update accounts on provider
            this._emitAccountsChanged();
        },
        PERMISSIONS: ({ permissionRequests }: PermissionsControllerState) => {
            if (!isEmpty(permissionRequests)) {
                openPopup();
                this._checkLastRequest(permissionRequests);
            } else {
                this._checkWindows();
            }

            // Update accounts on provider
            this._emitAccountsChanged();
        },
        TRANSACTIONS: (
            transactionsState: TransactionVolatileControllerState
        ) => {
            if (!isEmpty(transactionsState.unapprovedTransactions)) {
                openPopup();
                this._checkLastRequest(
                    transactionsState.unapprovedTransactions
                );
            } else {
                this._checkWindows();
            }
        },
    };

    /**
     * It closes any open window if there are no pending requests and focuses
     * the last request window
     */
    private _checkWindows = async () => {
        const { unapprovedTransactions } =
            this._transactionController.UIStore.getState();
        const { permissionRequests } =
            this._permissionsController.store.getState();

        if (
            this._unlockHandlers.length > 0 ||
            !isEmpty(this._requestHandlers) ||
            !isEmpty(unapprovedTransactions) ||
            !isEmpty(permissionRequests)
        ) {
            return;
        }

        for (const instance in extensionInstances) {
            const instanceTabId =
                extensionInstances[instance].port.sender?.tab?.id;

            if (
                // Check if it is a window
                instanceTabId &&
                // Check if it's not an onboarding tab
                !extensionInstances[instance].port.sender?.url?.includes(
                    'tab.html'
                )
            ) {
                // Focus last request window
                if (this._lastRequest) {
                    try {
                        await switchToTab(this._lastRequest.tabId);
                        await focusWindow(this._lastRequest.windowId);
                    } catch (error) {
                        log.debug(`Couldn't focus tab - ${error}`);
                    }

                    this._lastRequest = null;
                }

                closeExtensionInstance(instance);
            }
        }
    };

    /**
     * Opens a new window if the app is locked
     *
     * @returns A promise that resolves when the app is unlocked
     */
    private _waitForUnlock = (): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            if (this._appStateController.UIStore.getState().isAppUnlocked) {
                return resolve(true);
            }

            // Add handler
            this._unlockHandlers.push({ reject, resolve });

            openPopup();
        });
    };

    /**
     * Updates providers current connection status
     */
    private _handleConnectionStatus = ({
        isProviderNetworkOnline,
        isUserNetworkOnline,
        isNetworkChanging,
    }: NetworkControllerState) => {
        const isConnected =
            isProviderNetworkOnline &&
            isUserNetworkOnline &&
            !isNetworkChanging;

        if (isConnected !== this._isConnected) {
            this._isConnected = isConnected;
            this._emitConnectionUpdate();
        }
    };

    /**
     * Compares timestamps of the given requests to the last request
     * and updates if necessary.
     */
    private _checkLastRequest = (
        requests:
            | BlankProviderControllerState['dappRequests']
            | PermissionsControllerState['permissionRequests']
            | TransactionVolatileControllerState['unapprovedTransactions']
    ) => {
        for (const req in requests) {
            const id = requests[req].originId;

            if (!id) {
                return;
            }

            if (
                !this._lastRequest ||
                requests[req].time > this._lastRequest.time
            ) {
                const { tabId, windowId } = providerInstances[id];

                this._lastRequest = {
                    time: requests[req].time,
                    tabId,
                    windowId,
                };
            }
        }
    };
}
