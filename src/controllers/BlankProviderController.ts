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
    WatchAssetConfirmParams,
    SubscriptionParams,
    SubscriptionType,
    Subscription,
    Block,
} from '../utils/types/ethereum';
import { v4 as uuid } from 'uuid';
import { BaseController } from '../infrastructure/BaseController';
import {
    ProviderEvents,
    SiteMetadata,
    RequestArguments,
    ProviderSetupData,
    ChainChangedInfo,
    EthSubscription,
} from '@blank/provider/types';
import { isEmpty } from 'lodash';
import AppStateController, {
    AppStateControllerMemState,
} from './AppStateController';
import NetworkController, { NetworkEvents } from './NetworkController';
import { ethers } from 'ethers';
import {
    ExternalEventSubscription,
    Handler,
    Handlers,
    ProviderInstance,
} from '../utils/types/communication';
import {
    TransactionController,
    TransactionVolatileControllerState,
} from './transactions/TransactionController';
import PermissionsController, {
    PermissionsControllerState,
} from './PermissionsController';
import { openPopup } from '../utils/popup';
import { closeTab } from '../utils/window';
import {
    extensionInstances,
    providerInstances,
} from '../infrastructure/connection';
import { normalizeMessageData, validateSignature } from '../utils/signature';
import { hexValue } from 'ethers/lib/utils';
import { Network } from '../utils/constants/networks';
import { validateWatchAssetReq } from '../utils/token';
import { TokenController } from './erc-20/TokenController';
import { Token } from './erc-20/Token';
import { validateChainId } from '../utils/ethereumChain';
import log from 'loglevel';
import KeyringControllerDerivated from './KeyringControllerDerivated';
import { randomBytes } from '../utils/randomBytes';
import BlockUpdatesController, {
    BlockUpdatesEvents,
} from './BlockUpdatesController';
import { Filter } from '@ethersproject/abstract-provider';
import {
    parseBlock,
    validateLogSubscriptionRequest,
} from '../utils/subscriptions';

export enum BlankProviderEvents {
    SUBSCRIPTION_UPDATE = 'SUBSCRIPTION_UPDATE',
}

interface ActiveSubscriptions {
    [id: string]: Subscription;
}

export interface BlankProviderControllerState {
    dappRequests: { [id: string]: DappRequest<DappRequestType> };
}

/**
 * Blank ethereum provider controller
 *
 */
export default class BlankProviderController extends BaseController<BlankProviderControllerState> {
    private _unlockHandlers: Handler[];
    private _requestHandlers: Handlers;
    private _activeSubscriptions: ActiveSubscriptions;

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

        this._unlockHandlers = [];
        this._requestHandlers = {};
        this._activeSubscriptions = {};

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
        for (const subscriptionId in this._activeSubscriptions) {
            this._activeSubscriptions[subscriptionId].notification(
                chainId,
                previousBlockNumber,
                newBlockNumber
            );
        }
    };

    /**
     * Setup the provider id and saves the site metadata
     *
     * @returns provider setup data
     */
    public setupProvider = async (
        portId: string
    ): Promise<ProviderSetupData> => {
        // Get provider instance data
        if (!providerInstances[portId]) {
            throw new Error(`No data has been found for provider ${portId}`);
        }

        const chainId = await this._getChainId();
        const networkVersion = await this._getNetworkVersion();
        const accounts = this._accountsRequest(providerInstances[portId]);

        return {
            accounts,
            chainId,
            networkVersion,
        };
    };

    /**
     * Updates site metadata
     *
     */
    public setMetadata = (siteMetadata: SiteMetadata, portId: string): void => {
        // Get provider instance data
        if (!providerInstances[portId]) {
            throw new Error(`No data has been found for provider ${portId}`);
        }

        // Update site metadata
        providerInstances[portId].siteMetadata = siteMetadata;
    };

    /**
     * Handle account updates for each origin
     *
     */
    public handleAccountUpdates = (
        portId: string,
        eventData: ExternalEventSubscription
    ): ExternalEventSubscription => {
        // Get provider instance data
        if (!providerInstances[portId]) {
            throw new Error(`No data has been found for provider ${portId}`);
        }

        eventData.payload = this._accountsRequest(providerInstances[portId]);

        return eventData;
    };

    /**
     * It rejects all the pending transactions DApp requests
     * of type `SIGNING` or `ASSET`
     */
    public cancelPendingDAppRequests(): void {
        // Get active requests
        const requests = { ...this.store.getState().dappRequests };

        for (const [id, handler] of Object.entries(requests)) {
            if (handler.type !== DappReq.SWITCH_NETWORK) {
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

    //=============================================================================
    // ETHEREUM METHODS
    //=============================================================================

    /**
     * Ethereum requests handler
     *
     * @param portId Port id
     * @param method String name of the method requested from external source
     * @param params Parameters passed to the method called from external source
     */
    public handle = async (
        portId: string,
        { method, params }: RequestArguments
    ): Promise<unknown> => {
        // Get provider instance data
        const instanceData = providerInstances[portId];

        if (!instanceData) {
            log.error(`No data has been found for provider ${portId}`);
            throw new Error(ProviderError.UNAUTHORIZED);
        }

        switch (method) {
            case JSONRPCMethod.eth_blockNumber:
                return this._blockUpdatesController.getBlockNumber();
            case JSONRPCMethod.eth_accounts:
                return this._accountsRequest(instanceData, true);
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
                return this._connectionRequest(instanceData);
            case JSONRPCMethod.eth_sendTransaction:
                return this._handleSendTransaction(
                    params as [TransactionRequest],
                    instanceData
                );
            case JSONRPCMethod.eth_signTypedData:
            case JSONRPCMethod.eth_signTypedData_v1:
            case JSONRPCMethod.eth_signTypedData_v3:
            case JSONRPCMethod.eth_signTypedData_v4:
            case JSONRPCMethod.personal_sign:
                return this._handleMessageSigning(
                    method,
                    params as RawSignatureData[SignatureTypes],
                    instanceData
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
                    instanceData
                );
            case JSONRPCMethod.wallet_getPermissions:
                return this._handleGetPermissions(instanceData);
            case JSONRPCMethod.wallet_requestPermissions:
                return this._handleWalletRequestPermissions(
                    params as Record<string, unknown>[],
                    instanceData
                );
            case JSONRPCMethod.wallet_switchEthereumChain:
                return this._handleSwitchEthereumChain(
                    params as [SwitchEthereumChainParameters],
                    instanceData
                );
            case JSONRPCMethod.wallet_watchAsset:
                return this._handleWalletWatchAsset(
                    params as unknown as WatchAssetParameters,
                    instanceData
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
     * @param request - Object with transaction data (TransactionRequest)
     * @param id - id of the active provider (needed to fetch origin of the request)
     */
    private _handleSendTransaction = async (
        params: [TransactionRequest],
        { origin }: ProviderInstance
    ): Promise<string> => {
        const { result } = await this._transactionController.addTransaction(
            params[0],
            origin
        );

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
     * Returns current provider chain id
     */
    private _getChainId = async (): Promise<string> => {
        // We must use network stored chainId due to security implications.
        // See: https://eips.ethereum.org/EIPS/eip-3085#security-considerations
        const { chainId } = this._networkController.network;

        return hexValue(chainId);
    };

    /**
     * Returns the current network version
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
     */
    private _connectionRequest = async ({
        origin,
        siteMetadata,
    }: ProviderInstance): Promise<string[]> => {
        const permissions = await this._permissionsController.connectionRequest(
            origin,
            siteMetadata
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
     * @param providerInstance Current provider instance data.
     * @param emitUpdate If true the accounts change event will be emitted.
     */
    private _accountsRequest = (
        { origin }: ProviderInstance,
        emitUpdate = false
    ) => {
        // Check if app is locked
        const isAppUnlocked =
            this._appStateController.UIStore.getState().isAppUnlocked;

        if (!isAppUnlocked) {
            return [];
        }

        if (emitUpdate) {
            this._emitAccountsChanged();
        }

        return this._permissionsController.getAccounts(origin);
    };

    /**
     * Returns permissions granted with EIP-2255 standard
     *
     */
    private _handleWalletRequestPermissions = (
        params: Record<string, unknown>[],
        instanceData: ProviderInstance
    ) => {
        if (!params) {
            return;
        }

        // We only grant permissions for the eth_accounts method
        // We only check on the first element of the array
        if (JSONRPCMethod.eth_accounts in params[0]) {
            return this._connectionRequest(instanceData);
        }
    };

    /**
     * Handles permission request for wallet_getPermissions method
     * EIP-2255
     *
     */
    private _handleGetPermissions = (providerInstance: ProviderInstance) => {
        const accounts = this._accountsRequest(providerInstance, true);

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

    private _handleAddEthereumChain = async (
        params: [AddEthereumChainParameter],
        instance: ProviderInstance
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
            await this._handleSwitchEthereumChain([{ chainId }], instance);
        } else {
            // TODO: Implement add network logic
            throw new Error(ProviderError.UNSUPPORTED_METHOD);
        }
    };

    private _handleSwitchEthereumChain = async (
        params: [SwitchEthereumChainParameters],
        instance: ProviderInstance
    ) => {
        // Throw if there's already a request to switch networks from that origin
        const currentRequests = { ...this.store.getState().dappRequests };
        Object.values(currentRequests).forEach((req) => {
            if (
                req.type === DappReq.SWITCH_NETWORK &&
                req.origin === instance.origin
            ) {
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
            instance.origin,
            instance.siteMetadata
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
                this.cancelPendingDAppRequests();

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

    private _handleMessageSigning = async <
        TSignatureType extends SignatureTypes
    >(
        method: TSignatureType,
        params: RawSignatureData[TSignatureType],
        instance: ProviderInstance
    ) => {
        // Get chain id
        const chainId = await this._getChainId();

        // Validate and standardize signature params
        const normalizedParams = validateSignature(method, params, chainId);

        // Check if the account has permissions
        const hasPermission = this._permissionsController.accountHasPermissions(
            instance.origin,
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
            instance.origin,
            instance.siteMetadata
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
     * EIP-747 wallet_watchAsset handle
     */
    private _handleWalletWatchAsset = async (
        params: WatchAssetParameters,
        instance: ProviderInstance
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
            this._permissionsController.getAccounts(instance.origin)[0];

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
                instance.origin,
                instance.siteMetadata
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
     * @param origin Request origin
     * @param siteMetadata Dapp Metadata
     */
    private _submitDappRequest = async <RequestType extends DappRequestType>(
        type: RequestType,
        params: DappRequestParams[RequestType],
        origin: string,
        siteMetadata: SiteMetadata
    ): Promise<{
        isAccepted: boolean;
        reqId: string;
        confirmOptions?: DappRequestConfirmOptions;
        callback: {
            resolve: (value: void | PromiseLike<void>) => void;
            reject: (reason?: any) => void;
        };
    }> => {
        return new Promise((resolve, reject): void => {
            // Get current requests
            const requests = { ...this.store.getState().dappRequests };

            // Generate ID
            const id = uuid();

            // Add request to state
            requests[id] = {
                type,
                params,
                origin,
                siteMetadata,
                time: new Date().getTime(),
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
     *
     */
    private _stateWatcher: {
        [req in WindowRequest]: (args: WindowRequestArguments[req]) => void;
    } = {
        DAPP: ({ dappRequests }: BlankProviderControllerState) => {
            if (!isEmpty(dappRequests)) {
                openPopup();
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
            } else {
                this._checkWindows();
            }
        },
    };

    /**
     * Checks if there is any open window and
     * closes it if there is no pending request
     *
     */
    private _checkWindows = () => {
        let tabId: number | null = null;

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
                tabId = instanceTabId;
            }
        }

        if (!tabId) {
            return;
        }

        const unapprovedTransactions =
            this._transactionController.UIStore.getState()
                .unapprovedTransactions;
        const permissionRequests =
            this._permissionsController.store.getState().permissionRequests;

        if (!isEmpty(unapprovedTransactions)) {
            return;
        }
        if (!isEmpty(permissionRequests)) {
            return;
        }
        if (!isEmpty(this._requestHandlers)) {
            return;
        }
        if (this._unlockHandlers.length > 0) {
            return;
        }

        closeTab(tabId);
    };

    /**
     * Creates a new unlock handler and opens a new window
     *
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
}
