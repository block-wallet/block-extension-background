import Common from '@ethereumjs/common';
import log from 'loglevel';
import { BaseController } from '../infrastructure/BaseController';
import { JSONRPCResponse } from '@blank/provider/types';
import { Network, Networks, HARDFORKS } from '../utils/constants/networks';
import { SubcriptionResult } from '../utils/types/ethereum';
import { ethers } from 'ethers';
import { poll } from '@ethersproject/web';

export enum NetworkEvents {
    NETWORK_CHANGE = 'NETWORK_CHANGE',
    USER_NETWORK_CHANGE = 'USER_NETWORK_CHANGE',
    PROVIDER_NETWORK_CHANGE = 'PROVIDER_NETWORK_CHANGE',
    WS_PROVIDER_MESSAGE = 'WS_PROVIDER_MESSAGE',
}

export interface NetworkControllerState {
    selectedNetwork: string;
    availableNetworks: Networks;
    isNetworkChanging: boolean;
    isUserNetworkOnline: boolean;
    isProviderNetworkOnline: boolean;
    isEIP1559Compatible: { [chainId in number]: boolean };
}

const WS_KEEP_ALIVE_CHECK = 1000;

export default class NetworkController extends BaseController<NetworkControllerState> {
    public static readonly CURRENT_HARDFORK: string = 'london';
    private provider: ethers.providers.StaticJsonRpcProvider;
    private _webSocketProvider: ethers.providers.WebSocketProvider | null;
    private _wsProviderKeepAlive: NodeJS.Timer | null;
    private _isWsEnabled: boolean;

    constructor(initialState: NetworkControllerState) {
        super(initialState);

        this.provider = this.getProviderFromName(
            initialState.selectedNetwork || 'goerli'
        );

        if (window && window.navigator) {
            window.addEventListener('online', () =>
                this._handleUserNetworkChange()
            );
            window.addEventListener('offline', () =>
                this._handleUserNetworkChange()
            );
            this._handleUserNetworkChange();
        }

        setInterval(() => this._updateProviderNetworkStatus(), 20000);
        this._updateProviderNetworkStatus();

        this._webSocketProvider = null;
        this._wsProviderKeepAlive = null;
        this._isWsEnabled = false;
    }

    /**
     * Gets user selected native currency
     */
    public get selectedNetwork(): string {
        return this.store.getState().selectedNetwork;
    }

    /**
     * Sets user selected native currency
     *
     * @param v fiat ticker
     */
    public set selectedNetwork(v: string) {
        this.store.updateState({ selectedNetwork: v });
    }

    /**
     * Get the available networks with name, chainId and
     * the available features for that network.
     */
    public get networks(): Networks {
        return this.store.getState().availableNetworks;
    }

    /**
     * Set a new list of networks.
     */
    public set networks(networks: Networks) {
        this.store.updateState({ availableNetworks: networks });
    }

    /**
     * It returns the current selected network object
     */
    public get network(): Network {
        // Uppercase the network name
        const key = this.selectedNetwork.toUpperCase();
        return this.networks[key];
    }

    /**
     * Public setter for isWsEnabled
     */
    public set isWsEnabled(v: boolean) {
        this._isWsEnabled = v;
    }

    /**
     * Public getter for isWsEnabled
     */
    public get isWsEnabled(): boolean {
        return this._isWsEnabled;
    }

    /**
     * Obtains the network object from the specified name
     *
     * @param name The network name
     * @returns The network object from the name
     */
    public searchNetworkByName(name: string): Network {
        return this.networks[name.toUpperCase()];
    }

    /**
     * Obtains the network object from the specified chainId
     *
     * @param chainId The network chain id
     * @returns The network object from the chainId
     */
    public getNetworkFromChainId(chainId: number): Network | undefined {
        if (!chainId) {
            return undefined;
        }

        return Object.values(this.networks).find((i) => i.chainId === chainId);
    }

    /**
     * Checks if a certain chain is a custom network and has not a fixed gas cost for sends
     *
     * @param chainId The network chain id
     * @returns if the chain is a custom network with no fixed gas cost for sends
     */
    public isChainIdCustomNetwork(
        chainId: number | undefined
    ): boolean | undefined {
        if (!chainId) {
            false;
        }

        const network: Network | undefined = Object.values(this.networks).find(
            (i) => i.chainId === chainId
        );

        return network?.isCustomNetwork ?? false;
    }

    /**
     * Add a new network manually to the list.
     */
    public addNetwork(network: Network): void {
        // Uppercase the network name
        const key = network.name.toUpperCase();

        // If network has already been added, return
        if (key in this.networks) {
            return;
        }

        // Add network
        this.networks[key] = network;
    }

    /**
     * It adds a listener to be triggered on a block update
     * @param blockListener The listener
     */
    public addOnBlockListener(
        blockListener: (blockNumber: number) => void | Promise<void>
    ): void {
        this.getProvider().on('block', blockListener);
    }

    /**
     * It removes a listener from the block updates listeners
     * @param blockListener The listener
     */
    public removeOnBlockListener(
        blockListener: (blockNumber: number) => void | Promise<void>
    ): void {
        this.getProvider().off('block', blockListener);
    }

    /**
     * It removes ALL block updates listeners
     */
    public removeAllOnBlockListener(): void {
        this.getProvider().removeAllListeners('block');
    }

    /**
     * It returns the Network Provider instance
     * @returns {ethers.providers.StaticJsonRpcProvider}
     */
    public getProvider(): ethers.providers.StaticJsonRpcProvider {
        return this.provider;
    }

    /**
     * It returns the Ethereum mainnet Flashbots Provider instance
     * @returns {ethers.providers.StaticJsonRpcProvider}
     */
    public getFlashbotsProvider(): ethers.providers.StaticJsonRpcProvider {
        return new ethers.providers.StaticJsonRpcProvider(
            'https://rpc.flashbots.net'
        );
    }

    /**
     * Gets a provider for a given network
     */
    public getProviderFromName = (
        networkName: string
    ): ethers.providers.StaticJsonRpcProvider => {
        const network = this.searchNetworkByName(networkName);
        return new ethers.providers.StaticJsonRpcProvider(network.rpcUrls[0]);
    };

    /**
     * Returns a websocket provider instance if this could be stablished.
     *
     * @param initialize If true will start a new instance if there isn't one running.
     */
    public getWebSocketProvider = async (
        initialize = false
    ): Promise<ethers.providers.WebSocketProvider | null> => {
        if (this._webSocketProvider === null && initialize) {
            return this._startWebSocketProvider();
        }

        return this._webSocketProvider;
    };

    /**
     * Method to initialize a new web socket provider instance
     */
    private _startWebSocketProvider =
        async (): Promise<ethers.providers.WebSocketProvider | null> => {
            const network = this.searchNetworkByName(
                this.store.getState().selectedNetwork
            );

            if (!network.wsUrls || !network.wsUrls.length) {
                log.warn('No websocket url found for selected network');
                return null;
            }

            this._isWsEnabled = true;

            try {
                const wsProvider = new ethers.providers.WebSocketProvider(
                    network.wsUrls[0]
                );

                await this._isProviderReady(wsProvider);

                // Get onMessage method
                const wsMessage = wsProvider._websocket.onmessage;

                // Override events
                wsProvider._websocket.onmessage = (messageEvent: {
                    data: string;
                }) => this._onWsMessage(messageEvent, wsMessage);
                wsProvider._websocket.onclose = () => this._onWsClose();

                // Set keep alive
                this._wsProviderKeepAlive = setInterval(() => {
                    if (
                        this._isWsEnabled &&
                        (wsProvider._websocket.readyState === WebSocket.OPEN ||
                            wsProvider._websocket.readyState ===
                                WebSocket.CONNECTING)
                    ) {
                        wsProvider.detectNetwork();
                        return;
                    }

                    wsProvider._websocket.close();
                }, WS_KEEP_ALIVE_CHECK);

                this._webSocketProvider = wsProvider;

                log.debug('Websocket connected');

                return wsProvider;
            } catch (error) {
                log.warn("Websocket provider couldn't be  initialized");
                return null;
            }
        };

    /**
     * Triggered on new websocket message
     */
    private _onWsMessage = (
        messageEvent: { data: string },
        wsMessage: (messageEvent: { data: string }) => void
    ) => {
        const data = messageEvent.data;
        const result = JSON.parse(data) as JSONRPCResponse & SubcriptionResult;
        if (
            (result.id && result.result) || // Regular rpc response
            result.method === 'eth_subscription' // Subscription
        ) {
            this.emit(NetworkEvents.WS_PROVIDER_MESSAGE, result);
        }

        wsMessage(messageEvent);
    };

    /**
     * Triggered on websocket termination.
     * Tries to reconnect again.
     */
    private _onWsClose = () => {
        log.debug('Websocket disconnected');

        if (this._wsProviderKeepAlive) {
            clearInterval(this._wsProviderKeepAlive);
            this._wsProviderKeepAlive = null;
            this._webSocketProvider = null;
        }

        if (this._isWsEnabled) {
            log.debug('Reconnecting websocket');
            this._startWebSocketProvider();
        }
    };

    /**
     * Terminates current webSocket connection
     */
    public terminateWebSocket = (): void => {
        const wsProvider = this._webSocketProvider;
        this._webSocketProvider = null;
        this._isWsEnabled = false;

        if (wsProvider) {
            wsProvider.removeAllListeners();
            wsProvider.destroy();
        }
    };

    /**
     * It returns the latest block from the network
     */
    public async getLatestBlock(): Promise<ethers.providers.Block> {
        return this.getProvider().getBlock('latest');
    }

    /**
     * It returns if current network is EIP1559 compatible.
     */
    public async getEIP1559Compatibility(
        chainId: number = this.network.chainId,
        forceUpdate?: boolean
    ): Promise<boolean> {
        let shouldFetchTheCurrentState = false;

        if (!(chainId in this.getState().isEIP1559Compatible)) {
            shouldFetchTheCurrentState = true;
        } else {
            if (this.getState().isEIP1559Compatible[chainId] === undefined) {
                shouldFetchTheCurrentState = true;
            } else {
                if (
                    forceUpdate &&
                    !this.getState().isEIP1559Compatible[chainId]
                ) {
                    shouldFetchTheCurrentState = true;
                }
            }
        }

        if (shouldFetchTheCurrentState) {
            const baseFeePerGas = (await this.getLatestBlock()).baseFeePerGas;
            this.store.updateState({
                isEIP1559Compatible: {
                    ...this.getState().isEIP1559Compatible,
                    [chainId]: !!baseFeePerGas,
                },
            });
        }

        return this.getState().isEIP1559Compatible[chainId];
    }

    /**
     * Get the state of the controller
     *
     * @returns {NetworkControllerState} state
     */
    public getState(): NetworkControllerState {
        return this.store.getState() as NetworkControllerState;
    }

    /**
     * Get current selected network
     *
     * @returns Promise<Network> (https://docs.ethers.io/v5/api/providers/provider/#Provider-getNetwork)
     */
    public async getNetwork(): Promise<ethers.providers.Network> {
        return this.provider.getNetwork();
    }

    /**
     * Stalls until network is connected
     *
     * @returns Promise<Network> (https://docs.ethers.io/v5/api/providers/provider/#Provider-ready)
     */
    public async waitUntilNetworkLoaded(): Promise<ethers.providers.Network> {
        return this.provider.ready;
    }

    /**
     * It transfer the list of listeners from the state provider to a new one when changing networks
     * @param newProvider The provider for the selected nework
     */
    private _updateListeners(
        newProvider: ethers.providers.StaticJsonRpcProvider
    ) {
        const listeners = this.getProvider()._events.map((ev) => ({
            name: ev.event,
            listener: ev.listener,
        }));

        for (const item of listeners) {
            newProvider.on(item.name, item.listener);
        }

        this.getProvider().removeAllListeners();
    }

    /**
     * Indicates whether the network is being changed
     */
    public get isNetworkChanging(): boolean {
        return this.store.getState().isNetworkChanging;
    }

    /**
     * Change the ethereum network
     * @param string network
     */
    public async setNetwork(networkName: string): Promise<boolean> {
        try {
            // Set isNetworkChanging flag
            this.store.updateState({ isNetworkChanging: true });

            // Uppercase the network name to obtain key
            const key = networkName.toUpperCase();

            // Get the selected network
            const network = this.networks[key];

            // Instantiate provider and wait until it's ready
            const newNetworkProvider = this.getProviderFromName(network.name);

            await this._isProviderReady(newNetworkProvider); // Time out after 10 seconds

            // Update provider listeners
            this._updateListeners(newNetworkProvider);

            // Update provider reference
            this.provider = newNetworkProvider;

            // Close web socket connection
            this.terminateWebSocket();

            // Update selected network
            this.store.updateState({
                selectedNetwork: networkName,
            });

            // check for eip1559 compatibility
            await this.getEIP1559Compatibility(network.chainId, true);

            // Set the isNetworkChanging flag to false
            this.store.updateState({
                isNetworkChanging: false,
            });

            // Emit NETWORK_CHANGE event
            this.emit(NetworkEvents.NETWORK_CHANGE, this.network);

            // Return network change success
            return true;
        } catch (error) {
            // Set the isNetworkChanging flag to false
            this.store.updateState({ isNetworkChanging: false });

            // If provider.ready timed out or an error was thrown
            // return network change failure
            return false;
        }
    }

    /**
     * waitForTransaction
     */
    public waitForTransaction(
        transactionHash: string,
        confirmations?: number,
        timeout?: number
    ): Promise<ethers.providers.TransactionReceipt> {
        return this.getProvider().waitForTransaction(
            transactionHash,
            confirmations,
            timeout
        );
    }

    /**
     * @ethereumjs/common specifies data needed to create a transaction on a chain
     * (https://github.com/ethereumjs/ethereumjs-monorepo)
     *
     * @returns Promise<Common>
     */

    public async getCommon(): Promise<Common> {
        const { name, chainId } = this.network;

        // this only matters, if a hardfork adds new transaction types
        const hardfork = (await this.getEIP1559Compatibility(chainId))
            ? HARDFORKS.LONDON
            : HARDFORKS.BERLIN;

        return Common.custom({ name, chainId }, { hardfork });
    }

    private _handleUserNetworkChange() {
        const newValue = navigator.onLine;

        if (this.getState().isUserNetworkOnline == newValue) return;

        this.store.updateState({ isUserNetworkOnline: newValue });
        this.emit(NetworkEvents.USER_NETWORK_CHANGE, newValue);
    }

    private _updateProviderNetworkStatus() {
        this._isProviderReady()
            .then(() => {
                return Promise.resolve(true);
            })
            .catch(() => {
                return Promise.resolve(false);
            })
            .then((newStatus) => {
                if (this.getState().isProviderNetworkOnline == newStatus)
                    return;

                this.store.updateState({
                    isProviderNetworkOnline: newStatus,
                });
                this.emit(NetworkEvents.PROVIDER_NETWORK_CHANGE, newStatus);
            });
    }

    private _isProviderReady(
        provider:
            | ethers.providers.StaticJsonRpcProvider
            | ethers.providers.WebSocketProvider = this.provider
    ): Promise<ethers.providers.Network | undefined> {
        return poll(
            async () => {
                try {
                    const network = await provider.detectNetwork();
                    return network;
                } catch (error) {
                    if (
                        error.code === 'NETWORK_ERROR' &&
                        error.event === 'noNetwork'
                    ) {
                        return undefined;
                    }

                    throw error;
                }
            },
            { timeout: 10000 }
        );
    }
}
