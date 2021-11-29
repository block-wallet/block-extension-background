/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Mutex } from 'async-mutex';
import { BigNumber, Contract, ethers, Event, utils } from 'ethers';
import { Encryptor } from 'browser-passworder';
import { v4 as uuid } from 'uuid';

import NetworkController, { NetworkEvents } from '../../NetworkController';
import { GasPricesController } from '../../GasPricesController';
import {
    TransactionController,
    TransactionGasEstimation,
} from '../../transactions/TransactionController';
import { TokenController } from '../../erc-20/TokenController';

import { GenericVault } from '../infrastructure/GenericVault';
import {
    ComplianceInfo,
    IBlankDepositService,
} from '../infrastructure/IBlankDepositService';
import { IBlankDepositVaultState } from '../infrastructure/IBlankDepositVaultState';

import { TornadoNotesService } from './TornadoNotesService';
import { currencyAmountPairToMapKey, parseRelayerError } from './utils';

import tornadoConfig from './config/config';
import { ITornadoContract, TornadoEvents } from './config/ITornadoContract';

import MixerAbi from './config/abis/Mixer.abi.json';
import TornadoProxyAbi from './config/abis/TornadoProxy.abi.json';

import {
    AvailableNetworks,
    CurrencyAmountArray,
    CurrencyAmountPair,
    DepositStatus,
    KnownCurrencies,
} from '../types';
import { IBlankDeposit } from '../BlankDeposit';
import { PreferencesController } from '../../PreferencesController';
import relayers from './config/relayers';
import { GasPriceLevels } from '../../GasPricesController';
import { BaseStoreWithLock } from '../../../infrastructure/stores/BaseStore';
import {
    BlankDepositControllerStoreState,
    BlankDepositEvents,
    PendingWithdrawal,
    PendingWithdrawalsStore,
    PendingWithdrawalStatus,
} from '../BlankDepositController';
import { IObservableStore } from '../../../infrastructure/stores/ObservableStore';
import ComposedStore from '../../../infrastructure/stores/ComposedStore';
import { EventEmitter } from 'events';
import {
    getFinalTransactionStatuses,
    TransactionMeta,
    TransactionStatus,
} from '../../transactions/utils/types';
import { EventsUpdateType, TornadoEventsDB } from './stores/TornadoEventsDB';
import { INoteDeposit } from '../notes/INoteDeposit';
import { BnMultiplyByFraction } from '../../../utils/bnUtils';
import { TokenOperationsController } from '../../erc-20/transactions/Transaction';
import {
    DepositTransaction,
    DepositTransactionPopulatedTransactionParams,
} from '../../erc-20/transactions/DepositTransaction';
import { FeeData } from '../../GasPricesController';

import { FEATURES } from '../../../utils/constants/features';
import { Network } from '@blank/background/utils/constants/networks';
import log from 'loglevel';
import BlockUpdatesController from '../../BlockUpdatesController';
import { TornadoEventsService } from './TornadoEventsService';
import { Deposit, Withdrawal } from './stores/ITornadoEventsDB';

export interface TornadoServiceProps {
    encryptor?: Encryptor | undefined;
    tornadoEventsDB?: TornadoEventsDB;
    preferencesController: PreferencesController;
    networkController: NetworkController;
    transactionController: TransactionController;
    gasPricesController: GasPricesController;
    tokenOperationsController: TokenOperationsController;
    tokenController: TokenController;
    blockUpdatesController: BlockUpdatesController;
    tornadoEventsService: TornadoEventsService;
    initialState: BlankDepositControllerStoreState;
}

export type TornadoEventsStore = {
    [network in AvailableNetworks]: {
        [currencyPairKey: string]: {
            deposit: { events: Event[]; lastQueriedBlock: number };
            withdrawal: { events: Event[]; lastQueriedBlock: number };
        };
    };
};

export type TornadoContracts = Map<
    string,
    {
        contract: ITornadoContract;
        decimals: number;
        tokenAddress?: string;

        /**
         * The actual number of deposits
         */
        depositCount: number;
    }
>;

export const DEPOSIT_GAS_LIMIT = 12e5;
const WITHDRAWAL_GAS_LIMIT = 55e4;

export const DEFAULT_TORNADO_CONFIRMATION = 4;

export class TornadoService
    extends EventEmitter
    implements IBlankDepositService<BlankDepositControllerStoreState> {
    // Controllers & Services
    private readonly _notesService: TornadoNotesService;
    private readonly _networkController: NetworkController;
    private readonly _transactionController: TransactionController;
    private readonly _gasPricesController: GasPricesController;
    private readonly _preferencesController: PreferencesController;
    private readonly _tokenController: TokenController;
    private readonly _tokenOperationsController: TokenOperationsController;
    private readonly _blockUpdatesController: BlockUpdatesController;
    private readonly _tornadoEventsService: TornadoEventsService;

    // Stores
    private readonly _vault: GenericVault<IBlankDepositVaultState>;
    private readonly _pendingWithdrawalsStore: BaseStoreWithLock<PendingWithdrawalsStore>;
    private readonly _composedStore: ComposedStore<BlankDepositControllerStoreState>;
    private readonly _tornadoEventsDb: TornadoEventsDB;

    // Tornado Contracts
    private tornadoContracts: TornadoContracts;
    private proxyContract!: ITornadoContract;

    // Locks
    private readonly _depositLock: Mutex;

    constructor(props: TornadoServiceProps) {
        super();
        this._networkController = props.networkController;
        this._preferencesController = props.preferencesController;
        this._transactionController = props.transactionController;
        this._gasPricesController = props.gasPricesController;
        this._tokenController = props.tokenController;
        this._tokenOperationsController = props.tokenOperationsController;
        this._blockUpdatesController = props.blockUpdatesController;
        this._tornadoEventsService = props.tornadoEventsService;

        this._depositLock = new Mutex();

        // DB version should be changed in case new instances are added
        this._tornadoEventsDb =
            props.tornadoEventsDB ||
            new TornadoEventsDB('blank_deposits_events', 1);

        this._notesService = new TornadoNotesService(
            this._networkController,
            this._tornadoEventsDb,
            this.updateTornadoEvents,
            async (pair: CurrencyAmountPair) => {
                return (await this.getDepositsFromPair(pair))
                    .filter((d) => d.status === DepositStatus.FAILED)
                    .sort((a, b) => a.depositIndex - b.depositIndex);
            },
            this.dropFailedDeposit
        );
        this._pendingWithdrawalsStore = new BaseStoreWithLock(
            props.initialState.pendingWithdrawals
        );

        // Default vault state
        const defVaultState = {
            deposits: [],
            errorsInitializing: [],
            isInitialized: false, // Default to false, we care about this only when wallet is imported
            isLoading: false,
        };

        this._vault = new GenericVault({
            initialState: props.initialState.vaultState.vault,
            encryptor: props.encryptor,
            defaultState: {
                deposits: {
                    [AvailableNetworks.MAINNET]: defVaultState,
                    [AvailableNetworks.GOERLI]: defVaultState,
                },
                isImported: false,
            },
        });

        this.tornadoContracts = new Map();
        // Add network change listener
        props.networkController.addListener(
            NetworkEvents.NETWORK_CHANGE,
            async ({ chainId, name, features }: Network) => {
                if (!features.includes(FEATURES.TORNADO)) {
                    // If network is not supported, return
                    return;
                }

                // Set tornado contracts
                await this.setTornadoContract(chainId);

                // Update notes status
                const vault = await this._vault.retrieve();
                if (!name || !(name in vault.deposits)) {
                    throw new Error('Network not supported');
                }

                const { isImported } = vault;
                const { isInitialized } = vault.deposits[
                    name as AvailableNetworks
                ];

                if (isImported && !isInitialized) {
                    this.importNotes();
                } else {
                    // On network change update the status of
                    // pending Deposits & Withdrawals if any
                    this.checkCurrentNetworkPending();
                }
            }
        );

        this._composedStore = new ComposedStore<BlankDepositControllerStoreState>(
            {
                vaultState: this._vault.store,
                pendingWithdrawals: this._pendingWithdrawalsStore.store,
            }
        );
    }

    /**
     * isUnlocked
     *
     * @returns Whether the notes vault is unlocked
     */
    public get isUnlocked(): boolean {
        return this._vault.isUnlocked;
    }

    public async getImportingStatus(): Promise<{
        isImported: boolean;
        isInitialized: boolean;
        isLoading: boolean;
        errorsInitializing: string[];
    }> {
        const { name } = this._networkController.network;

        const vault = await this._vault.retrieve();
        if (!name || !(name in vault.deposits)) {
            throw new Error('Network not supported');
        }

        const { isImported } = vault;
        const { isInitialized, isLoading, errorsInitializing } = vault.deposits[
            name as AvailableNetworks
        ];

        return { isImported, isInitialized, isLoading, errorsInitializing };
    }

    /**
     * proxyContractAddress
     *
     * @returns The Tornado proxy contract address
     */
    public get proxyContractAddress(): string {
        return this.proxyContract.address;
    }

    public async getComplianceInformation(
        deposit: IBlankDeposit
    ): Promise<ComplianceInfo> {
        const depositComplianceInfo = {
            deposit: {},
            withdrawal: {},
        } as ComplianceInfo;

        const key = currencyAmountPairToMapKey(deposit.pair);
        const contract = this.tornadoContracts.get(key);
        if (!contract) {
            throw new Error('Unsopported pair instance');
        }

        const parsedDeposit = await this._notesService.parseDeposit(
            deposit.note
        );

        // Update deposit events
        await this.updateTornadoEvents(
            TornadoEvents.DEPOSIT,
            deposit.pair,
            contract.contract
        );

        const { name: network } = this._networkController.network;

        const depEv = await this._tornadoEventsDb.getDepositEventByCommitment(
            network as AvailableNetworks,
            deposit.pair,
            parsedDeposit.commitmentHex
        );

        if (!depEv) {
            throw new Error('Deposit not found on events');
        }

        // Get transaction receipt
        const receipt = await this._networkController
            .getProvider()
            .getTransactionReceipt(depEv.transactionHash);

        depositComplianceInfo.deposit = {
            pair: deposit.pair,
            spent: deposit.spent || false,
            timestamp: new Date(Number(depEv.timestamp) * 1000),
            commitment: parsedDeposit.commitmentHex,
            transactionHash: depEv.transactionHash,
            from: receipt.from,
        };

        if (!deposit.spent) {
            return depositComplianceInfo;
        }

        // Update withdrawal events
        await this.updateTornadoEvents(
            TornadoEvents.WITHDRAWAL,
            deposit.pair,
            contract.contract
        );

        const withdrawEv = await this._tornadoEventsDb.getWithdrawalEventByNullifier(
            network as AvailableNetworks,
            deposit.pair,
            parsedDeposit.nullifierHex
        );

        if (!withdrawEv) {
            // Deposit has not been withdrawn yet
            return depositComplianceInfo;
        }

        // Get timestamp
        const {
            timestamp,
        } = await this._networkController
            .getProvider()
            .getBlock(withdrawEv.blockNumber);

        depositComplianceInfo.withdrawal = {
            pair: deposit.pair,
            to: withdrawEv.to,
            transactionHash: withdrawEv.transactionHash,
            timestamp: new Date(timestamp * 1000),
            fee: utils.formatEther(BigNumber.from(withdrawEv.fee)),
            nullifier: parsedDeposit.nullifierHex,
        };

        return depositComplianceInfo;
    }

    /**
     * It checks for a pending withdrawal on the queue and processes its status
     *
     * @param pending The pending withdrawal
     */
    private checkPendingWithdrawal = async (pending: PendingWithdrawal) => {
        // If we're no longer on the pending withdrawal network, return
        if (this._networkController.network.chainId !== pending.chainId) {
            return;
        }

        // Store provider in case of network change
        const provider = this._networkController.getProvider();

        // If pending withdrawal status is not PENDING return
        if (pending.status !== PendingWithdrawalStatus.PENDING) {
            return;
        }

        let transactionHash = '',
            status: PendingWithdrawalStatus = pending.status,
            errMessage = '';
        try {
            ({
                txHash: transactionHash,
                status,
            } = await this.getStatusFromRelayerJob(
                pending.jobId,
                pending.relayerUrl
            ));

            // Update pending withdrawal to CONFIRMED
            await this.updatePendingWithdrawal(pending.pendingId, {
                status,
                transactionHash,
                time: new Date().getTime(),
                chainId: pending.chainId,
            });

            // Await transaction receipt
            const transactionReceipt = await this.waitForTransactionReceipt(
                transactionHash,
                provider
            );

            // Add transaction receipt to pending withdrawal
            await this.updatePendingWithdrawal(pending.pendingId, {
                transactionReceipt,
                chainId: pending.chainId,
            });

            // Set deposit to spent only if the vault is still unlocked
            // & the network is still the same
            if (
                this.isUnlocked &&
                pending.chainId === this._networkController.network.chainId
            ) {
                // Get deposit from vault
                const deposit = (await this.getDeposits()).find(
                    (d) => d.id === pending.depositId
                );

                if (!deposit) {
                    throw new Error(
                        'Deposit associated to pending withdrawal not found in vault!'
                    );
                }

                // Set as spent
                await this.setSpent([deposit]);
            }
            return { txHash: transactionHash, status };
        } catch (error) {
            status =
                'status' in error
                    ? error.status
                    : PendingWithdrawalStatus.REJECTED;
            errMessage = 'message' in error ? error.message || error : '';

            await this.updatePendingWithdrawal(pending.pendingId, {
                status,
                errMessage,
                chainId: pending.chainId,
            });
            return { status: errMessage };
        } finally {
            // Emit withdrawal state change
            this.emit(
                BlankDepositEvents.WITHDRAWAL_STATE_CHANGE,
                transactionHash,
                status,
                errMessage
            );
        }
    };

    /**
     * It checks for spent notes and updates their state on the vault
     */
    public updateNotesSpentState = async (): Promise<void> => {
        try {
            // Exclude pending withdrawals
            const pendingWithdrawals = this.getPendingWithdrawalsSet();

            const unspentDeposits = (await this.getDeposits()).filter(
                (d) =>
                    !d.spent &&
                    !pendingWithdrawals.has(d.id) &&
                    d.status === DepositStatus.CONFIRMED
            );

            if (unspentDeposits.length !== 0) {
                const depositsNotesToUpdate = await this._notesService.updateUnspentNotes(
                    unspentDeposits
                );

                return this.setSpent(depositsNotesToUpdate);
            }
        } catch (error) {
            log.error('Error checking for possible spent notes');
        }
    };

    /**
     * Returns a set of non-failed pending withdrawals deposit ids
     */
    private getPendingWithdrawalsSet() {
        const { name } = this._networkController.network;

        const pendingWithdrawals = new Set(
            this._pendingWithdrawalsStore.store
                .getState()
                [name as AvailableNetworks].pending.filter(
                    (p) => p.status !== PendingWithdrawalStatus.FAILED
                )
                .map((i) => i.depositId)
        );
        return pendingWithdrawals;
    }

    public async getNoteString(deposit: IBlankDeposit): Promise<string> {
        const { chainId } = this._networkController.network;
        return this._notesService.getNoteString(deposit, chainId);
    }

    /**
     * It returns the relayer service status
     */
    public async getServiceStatus(): Promise<{
        status: boolean;
        error: string;
    }> {
        return (await this.getRelayerStatus()).health;
    }

    /**
     * Processes pending  withdrawals on current network
     */
    private checkCurrentNetworkPendingWithdrawals = async () => {
        const { name } = this._networkController.network;

        const storeWithdrawals = this._pendingWithdrawalsStore.store.getState();
        if (name && name in storeWithdrawals) {
            const withdrawals = storeWithdrawals[name as AvailableNetworks];

            // Check pending withdrawals for current network
            withdrawals.pending.forEach(this.checkPendingWithdrawal);
        }
    };

    /**
     * Processes pending deposits on current network
     */
    private checkCurrentNetworkPendingDeposits = async () => {
        const { chainId } = this._networkController.network;

        // Get pending deposits
        const deposits = (await this.getDeposits(chainId)).filter(
            (d) => d.status === DepositStatus.PENDING
        );

        // Get Blank Transactions
        const blankDepositsDict = {} as {
            [depositID: string]: {
                status: TransactionStatus;
                index: number;
                chainId?: number;
            };
        };
        const blankTransactionsMetas = this._transactionController.getBlankDepositTransactions(
            chainId
        );
        blankTransactionsMetas.forEach((d, index) => {
            blankDepositsDict[d.blankDepositId!] = {
                index,
                status: d.status,
                chainId: d.chainId,
            };
        });

        for (const deposit of deposits) {
            const { id } = deposit;
            if (id in blankDepositsDict) {
                // Check if it's in a final state and update it,
                // otherwise run an async function to process the pending deposit
                if (
                    getFinalTransactionStatuses().includes(
                        blankDepositsDict[id].status
                    )
                ) {
                    await this.updateDepositStatus(
                        id,
                        blankDepositsDict[id].status ===
                            TransactionStatus.CONFIRMED
                            ? DepositStatus.CONFIRMED
                            : DepositStatus.FAILED,
                        blankDepositsDict[id].chainId
                    );
                } else {
                    this.processPendingDeposit(
                        blankTransactionsMetas[blankDepositsDict[id].index]
                    );
                }
            } else {
                // In case the transaction is not present for some reason, fail the deposit
                await this.updateDepositStatus(
                    id,
                    DepositStatus.FAILED,
                    chainId
                );
            }
        }
    };

    /**
     * It checks for current network pending deposits & withdrawals
     */
    private checkCurrentNetworkPending = () => {
        // Run jobs
        this.checkCurrentNetworkPendingDeposits();
        this.checkCurrentNetworkPendingWithdrawals();
    };

    /**
     * Initializes the Tornado events IndexedDB
     */
    private initDepositsIndexedDb = async () => {
        return this._tornadoEventsDb.createStoreInstances();
    };

    public async initialize(): Promise<void> {
        // Update events db
        await this.initDepositsIndexedDb();

        // On init, drop the unsubmitted withdrawals and
        // check for pending withdrawals updates from the relayer
        this.dropUnsubmittedWithdrawals();
        this.checkCurrentNetworkPendingWithdrawals();

        // Init Prover worker
        await this._notesService.initialize();
    }

    /**
     * Initialize the vault used for the deposits
     * @param unlockPhrase
     * @returns
     */
    public async initializeVault(unlockPhrase: string): Promise<void> {
        return this._vault.initialize(unlockPhrase);
    }

    /**
     * reinitialize the vault used for the deposits, overwrites existing vault
     * @param unlockPhrase
     * @returns
     */
    public async reinitializeVault(unlockPhrase: string): Promise<void> {
        return this._vault.reinitialize(unlockPhrase);
    }

    /**
     * It updates the Tornado events on the specific store instance
     */
    private updateTornadoEvents = async (
        eventType: TornadoEvents,
        currencyAmountPair: CurrencyAmountPair,
        contract: Contract,
        forceUpdate = false
    ) => {
        // Obtain network name & features set
        const {
            name: networkName,
            features,
            chainId,
        } = this._networkController.network;

        // Get current stored events
        if (!features.includes(FEATURES.TORNADO)) {
            throw new Error('Current network is not supported');
        }

        let fromBlockEvent = 0;
        let fromIndexEvent = 0;

        if (!forceUpdate) {
            [fromBlockEvent, fromIndexEvent] = await Promise.all([
                await this._tornadoEventsDb.getLastQueriedBlock(
                    eventType,
                    networkName as AvailableNetworks,
                    currencyAmountPair
                ),
                this._tornadoEventsDb.getLastEventIndex(
                    eventType,
                    networkName as AvailableNetworks,
                    currencyAmountPair
                ),
            ]);
        }

        let fetchPromise: Promise<Deposit[] | Withdrawal[]>;

        if (eventType === TornadoEvents.DEPOSIT) {
            fetchPromise = this._tornadoEventsService.getDeposits({
                chainId: chainId,
                pair: currencyAmountPair,
                from: fromIndexEvent,
                chainOptions: { contract, fromBlock: fromBlockEvent },
            });
        } else {
            fetchPromise = this._tornadoEventsService.getWithdrawals({
                chainId: chainId,
                pair: currencyAmountPair,
                from: fromIndexEvent,
                chainOptions: { contract, fromBlock: fromBlockEvent },
            });
        }

        if (forceUpdate) {
            await this._tornadoEventsDb.truncateEvents(
                networkName as AvailableNetworks,
                currencyAmountPair,
                { type: eventType } as EventsUpdateType
            );
        }

        const events = await fetchPromise;

        if (events.length) {
            return (Promise.all([
                // Update events
                this._tornadoEventsDb.updateEvents(
                    networkName as AvailableNetworks,
                    currencyAmountPair,
                    {
                        type: eventType,
                        events:
                            eventType === TornadoEvents.DEPOSIT
                                ? (events as Deposit[])
                                : (events as Withdrawal[]),
                    } as EventsUpdateType
                ),

                // Update last fetched block\
                this._tornadoEventsDb.updateLastQueriedBlock(
                    eventType,
                    networkName as AvailableNetworks,
                    currencyAmountPair,
                    events.at(-1)!.blockNumber
                ),
            ]) as unknown) as Promise<void>;
        }
    };

    public getStore(): IObservableStore<BlankDepositControllerStoreState> {
        return (this
            ._composedStore as unknown) as IObservableStore<BlankDepositControllerStoreState>;
    }

    /**
     * It obtains from the vault the list of deposits from the current network
     */
    public async getDeposits(chainId?: number): Promise<IBlankDeposit[]> {
        const network = chainId
            ? this._networkController.getNetworkFromChainId(chainId)
            : this._networkController.network;

        if (!network) {
            throw new Error('Invalid network chainId');
        }

        const { name } = network;

        const vault = await this._vault.retrieve();
        if (!name || !(name in vault.deposits)) {
            throw new Error('Network not supported');
        }

        return vault.deposits[name as AvailableNetworks].deposits;
    }

    /**
     * Locks the vault to prevent decrypting and operating with it
     */
    public async lock(): Promise<void> {
        await this._vault.lock();
        return this._notesService.initRootPath();
    }

    /**
     * Unlocks the vault with the provided unlockPhrase and
     * inits the root paths for the deposit keys with the provided mnemonic
     */
    public async unlock(unlockPhrase: string, mnemonic: string): Promise<void> {
        // Unlock the vault
        await this._vault.unlock(unlockPhrase);

        const { chainId, features } = this._networkController.network;

        // Set tornado contract and init root path
        const isSupported = features.includes(FEATURES.TORNADO);

        // Set tornado contracts if on supported network
        if (isSupported) {
            await this.setTornadoContract(chainId);
        }

        await this._notesService.initRootPath(mnemonic);

        // Check if a pending deposit transaction was approved while the app was locked
        if (isSupported) {
            this.checkCurrentNetworkPendingDeposits();
        }
    }

    /**
     * It resolves to the proxy contract address
     *
     * @param proxy The proxy contract ENS or address
     */
    private async getProxyFromENS(proxy: string): Promise<string> {
        // If proxy is not an ENS return it as is
        if (proxy.slice(-3) !== 'eth') {
            return proxy;
        }

        const resolver = await this._networkController
            .getProvider()
            .getResolver(proxy);

        if (!resolver) {
            return proxy;
        }

        return resolver.getAddress();
    }

    /**
     * It returns the relayer url from the ENS key
     *
     * @param ens The Ethereum Naming Service key
     */
    private async getRelayerURLFromENS(key: string): Promise<string> {
        // If key is not an ENS return it as is
        if (key.slice(-3) !== 'eth') {
            return key;
        }

        const resolver = await this._networkController
            .getProvider()
            .getResolver(key);

        if (!resolver) {
            return key;
        }

        return resolver.getText('url');
    }

    /**
     * getRelayerStatus
     * It query the relayer for its status
     */
    private async getRelayerStatus() {
        const { name } = this._networkController.network;

        const relayerUrl = await this.getRelayerURLFromENS(
            relayers[name as AvailableNetworks]
        );

        if (!relayerUrl) {
            throw new Error('Relayer for this network is not available');
        }

        // Fetch relayer status
        const response = await fetch(`https://${relayerUrl}/status`);
        if (!response.ok) {
            throw new Error(
                `Unable to connect to the relayer: ${response.statusText}`
            );
        }
        const relayerStatus = await response.json();

        return {
            ...relayerStatus,
            relayerUrl,
            networkName: name,
            health: {
                ...relayerStatus.health,
                status: relayerStatus.health.status === 'true',
            },
        } as {
            rewardAccount: string;
            ethPrices: {
                [currency in Exclude<
                    KnownCurrencies,
                    KnownCurrencies.ETH
                >]: string;
            };
            miningServiceFee: number;
            tornadoServiceFee: number;
            relayerUrl: string;
            networkName: AvailableNetworks;
            health: { status: boolean; error: string };
        };
    }

    /**
     * Returns the list of deposits in the vault for
     * the specified currency amount pair
     *
     * @param currencyAmountPair The currency/amount
     */
    private async getDepositsFromPair(currencyAmountPair: CurrencyAmountPair) {
        const { deposits } = await this._vault.retrieve();
        const { name } = this._networkController.network;

        if (!name || !(name in deposits)) {
            throw new Error('Invalid network');
        }

        const depositsForNetwork = deposits[name as AvailableNetworks].deposits;

        return depositsForNetwork.filter(
            (d) =>
                d.pair.amount === currencyAmountPair.amount &&
                d.pair.currency === currencyAmountPair.currency
        );
    }

    public async getUnspentDepositCount(
        currencyAmountPair?: CurrencyAmountPair
    ): Promise<
        | number
        | {
              eth: {
                  pair: CurrencyAmountPair;
                  count: number;
              }[];
              dai: {
                  pair: CurrencyAmountPair;
                  count: number;
              }[];
              cdai: {
                  pair: CurrencyAmountPair;
                  count: number;
              }[];
              usdc: {
                  pair: CurrencyAmountPair;
                  count: number;
              }[];
              usdt: {
                  pair: CurrencyAmountPair;
                  count: number;
              }[];
              wbtc: {
                  pair: CurrencyAmountPair;
                  count: number;
              }[];
          }
    > {
        // Exclude pending withdrawals
        const pendingWithdrawals = this.getPendingWithdrawalsSet();

        if (currencyAmountPair) {
            return (await this.getDepositsFromPair(currencyAmountPair)).filter(
                (d) =>
                    d.spent === false &&
                    !pendingWithdrawals.has(d.id) &&
                    d.status === DepositStatus.CONFIRMED
            ).length;
        } else {
            const unspentDeposits = (await this.getDeposits()).filter(
                (d) =>
                    d.spent === false &&
                    !pendingWithdrawals.has(d.id) &&
                    d.status === DepositStatus.CONFIRMED
            );

            const depositsCount = {} as {
                [key in KnownCurrencies]: {
                    pair: CurrencyAmountPair;
                    count: number;
                }[];
            };

            for (const [currency, amountList] of Object.entries(
                CurrencyAmountArray
            )) {
                const value = await Promise.all(
                    amountList.map(async (amount: any) => ({
                        pair: { amount, currency } as CurrencyAmountPair,
                        count: unspentDeposits.filter(
                            (d) =>
                                d.pair.amount === amount &&
                                d.pair.currency ===
                                    (currency as KnownCurrencies)
                        ).length,
                    }))
                );
                depositsCount[currency as KnownCurrencies] = value;
            }

            return depositsCount;
        }
    }

    public async getDepositCount(
        currencyAmountPair: CurrencyAmountPair
    ): Promise<number> {
        return (await this.getDepositsFromPair(currencyAmountPair)).length;
    }

    public async getLatestDepositDate(
        currencyAmountPair: CurrencyAmountPair
    ): Promise<Date> {
        const depositsFromPair = await this.getDepositsFromPair(
            currencyAmountPair
        );
        const latestDate = depositsFromPair.sort(
            (a, b) => b.timestamp - a.timestamp
        )[0].timestamp;
        return new Date(latestDate);
    }

    /**
     * It sets the Tornado contract for the specific network
     * @param chainId The chainId
     */
    private setTornadoContract = async (chainId: number) => {
        for (const token of Object.keys(
            (tornadoConfig.deployments as any)[`netId${chainId}`]
        )) {
            if (token === 'proxy') {
                let proxy: string = (tornadoConfig.deployments as any)[
                    `netId${chainId}`
                ]['defaultProxy'];
                try {
                    proxy = await this.getProxyFromENS(
                        (tornadoConfig.deployments as any)[`netId${chainId}`][
                            'proxy'
                        ]
                    );
                } catch (error) {
                    log.debug(
                        'Error resolving from proxy ENS. Defaulting to contained address'
                    );
                }

                this.proxyContract = new Contract(
                    proxy,
                    TornadoProxyAbi,
                    this._networkController.getProvider()
                ) as ITornadoContract;

                continue;
            } else if (token === 'defaultProxy') {
                continue;
            }

            for (const depositValue of Object.keys(
                (tornadoConfig.deployments as any)[`netId${chainId}`][token]
                    .instanceAddress
            )) {
                const depositCount = await this.getDepositCount({
                    currency: token as KnownCurrencies,
                    amount: depositValue as any,
                });

                this.tornadoContracts.set(`${token}-${depositValue}`, {
                    contract: new Contract(
                        (tornadoConfig.deployments as any)[`netId${chainId}`][
                            token
                        ].instanceAddress[depositValue],
                        MixerAbi,
                        this._networkController.getProvider()
                    ) as ITornadoContract,
                    decimals: (tornadoConfig.deployments as any)[
                        `netId${chainId}`
                    ][token].decimals,
                    tokenAddress: (tornadoConfig.deployments as any)[
                        `netId${chainId}`
                    ][token].tokenAddress,
                    depositCount,
                });
            }
        }

        this._notesService.setTornadoContracts(this.tornadoContracts);
    };

    /**
     * dropUnsubmittedWithdrawals
     *
     * It transitions all the pending "UNSUBMITTED" withdrawals to "FAILED" status
     */
    private dropUnsubmittedWithdrawals = async () => {
        const pendingState = this._pendingWithdrawalsStore.store.getState();

        let pendingWithdrawals: PendingWithdrawal[] = [];
        for (const { pending } of Object.values(pendingState)) {
            pendingWithdrawals = pendingWithdrawals.concat(pending);
        }

        const unsubmittedWithdrawals = pendingWithdrawals.filter(
            (d) => d.status === PendingWithdrawalStatus.UNSUBMITTED
        );

        for (const unsubmitted of unsubmittedWithdrawals) {
            await this.updatePendingWithdrawal(unsubmitted.pendingId, {
                status: PendingWithdrawalStatus.FAILED,
                statusMessage:
                    'Transitioned from UNSUBMITTED to FAILED on boot',
                chainId: unsubmitted.chainId,
            });
        }
    };

    /**
     * It drops a failed deposit
     *
     * @param depositId The deposit Id
     * @param status The deposit new status
     */
    private dropFailedDeposit = async (depositId: string) => {
        const { name } = this._networkController.network;

        const { releaseMutexLock } = await this._vault.getVaultMutexLock();
        try {
            const currentDeposits = await this._vault.retrieve();
            if (!name || !(name in currentDeposits.deposits))
                throw new Error('Unsupported network');

            const networkDeposits =
                currentDeposits.deposits[name as AvailableNetworks];

            const deposit = networkDeposits.deposits.find(
                (d) => d.id === depositId
            );
            if (!deposit) {
                throw new Error('Deposit not found');
            }

            if (deposit.status !== DepositStatus.FAILED) {
                throw new Error('Can not drop a non failed deposit!');
            }

            const deposits = networkDeposits.deposits.filter(
                (d) => d.id !== depositId
            );

            return this._vault.update({
                deposits: {
                    ...currentDeposits.deposits,
                    [name as AvailableNetworks]: {
                        ...networkDeposits,
                        deposits: [...deposits],
                    },
                },
            });
        } finally {
            releaseMutexLock();
        }
    };

    /**
     * It updates a deposit status
     *
     * @param depositId The deposit Id
     * @param status The deposit new status
     */
    private updateDepositStatus = async (
        depositId: string,
        status: DepositStatus,
        chainId?: number
    ) => {
        const { name } = chainId
            ? this._networkController.getNetworkFromChainId(chainId)!
            : this._networkController.network;

        const { releaseMutexLock } = await this._vault.getVaultMutexLock();
        try {
            const currentDeposits = await this._vault.retrieve();
            if (!name || !(name in currentDeposits.deposits))
                throw new Error('Unsupported network');

            const networkDeposits =
                currentDeposits.deposits[name as AvailableNetworks];

            const depositIndex = networkDeposits.deposits.findIndex(
                (d) => d.id === depositId
            );

            if (depositIndex < 0)
                throw new Error('The deposit is not present in the vault');

            // Update spent and timestamp
            networkDeposits.deposits[depositIndex].status = status;
            networkDeposits.deposits[
                depositIndex
            ].timestamp = new Date().getTime();

            return this._vault.update({
                deposits: {
                    ...currentDeposits.deposits,
                    [name as AvailableNetworks]: {
                        ...networkDeposits,
                        deposits: [...networkDeposits.deposits],
                    },
                },
            });
        } finally {
            releaseMutexLock();
        }
    };

    /**
     * setSpent
     *
     * It updates a Blank deposit to spent
     *
     * @param deposits The deposits
     */
    private async setSpent(deposits: IBlankDeposit[]) {
        if (deposits.length === 0) {
            return;
        }

        const { name } = deposits[0].chainId
            ? this._networkController.getNetworkFromChainId(
                  deposits[0].chainId
              )!
            : this._networkController.network;

        const { releaseMutexLock } = await this._vault.getVaultMutexLock();
        try {
            const currentDeposits = await this._vault.retrieve();
            if (!name || !(name in currentDeposits.deposits))
                throw new Error('Unsupported network');

            const networkDeposits =
                currentDeposits.deposits[name as AvailableNetworks];

            for (const deposit of deposits) {
                const depositIndex = networkDeposits.deposits.findIndex(
                    (d) => d.note === deposit.note
                );

                if (depositIndex < 0)
                    throw new Error('A deposit is not present in the vault');

                // Update spent and timestamp
                networkDeposits.deposits[depositIndex].spent = true;
                networkDeposits.deposits[
                    depositIndex
                ].timestamp = new Date().getTime();
            }

            return this._vault.update({
                deposits: {
                    ...currentDeposits.deposits,
                    [name as AvailableNetworks]: {
                        ...networkDeposits,
                        deposits: [...networkDeposits.deposits],
                    },
                },
            });
        } finally {
            releaseMutexLock();
        }
    }

    /**
     * addDeposits
     *
     * It adds a list of deposits to the vault
     *
     * @param deposits The list of recovered deposits
     */
    private async addDeposits(deposits: IBlankDeposit[]) {
        const { name } = this._networkController.network;

        const { releaseMutexLock } = await this._vault.getVaultMutexLock();
        try {
            const currentDeposits = await this._vault.retrieve();

            if (!name || !(name in currentDeposits.deposits))
                throw new Error('Unsupported network');

            const networkDeposits =
                currentDeposits.deposits[name as AvailableNetworks];

            return this._vault.update({
                deposits: {
                    ...currentDeposits.deposits,
                    [name as AvailableNetworks]: {
                        ...networkDeposits,
                        deposits: [...networkDeposits.deposits, ...deposits],
                    },
                },
            });
        } finally {
            releaseMutexLock();
        }
    }

    public async importNotes(
        unlockPhrase?: string,
        mnemonic?: string
    ): Promise<void> {
        // Vault lock to prevent other instances or network changes to use the vault while importing
        const { releaseMutexLock } = await this._vault.getVaultMutexLock();
        try {
            // Set network deposits isLoading to true
            const { name, chainId } = this._networkController.network;

            if (unlockPhrase) {
                await this._vault.unlock(unlockPhrase);
            }

            const currentDeposits = await this._vault.retrieve();

            if (!name || !(name in currentDeposits.deposits))
                throw new Error('Unsupported network');

            const depositIsLoading =
                currentDeposits.deposits[name as AvailableNetworks];
            depositIsLoading.isLoading = true;
            depositIsLoading.isInitialized = false;

            this._vault.update({
                deposits: {
                    ...currentDeposits.deposits,
                    [name as AvailableNetworks]: {
                        ...depositIsLoading,
                    },
                },
                isImported: true,
            });

            // Reconstruct deposits
            const currentNetworkDepositsResult = await this._notesService.reconstruct(
                mnemonic
            );

            // Add fulfilled promises only and push errors for rejected ones
            let deposits: IBlankDeposit[] = [];
            const errors: string[] = [];
            for (const deposit of currentNetworkDepositsResult) {
                if (deposit.status === 'fulfilled') {
                    for (let i = 0; i < deposit.value.length; i++) {
                        if (!deposit.value[i].chainId) {
                            deposit.value[i].chainId = chainId;
                        }
                    }
                    deposits = deposits.concat(deposit.value);
                } else {
                    errors.push(deposit.reason.message || deposit.reason);
                }
            }

            // Get network current deposits
            const networkCurrentDeposits =
                currentDeposits.deposits[name as AvailableNetworks].deposits;

            // Update vault with new deposits
            const newDeposits: typeof currentDeposits.deposits = {
                [name as AvailableNetworks]: {
                    deposits: [...networkCurrentDeposits, ...deposits],
                    isLoading: false,
                    isInitialized: true,
                    errorsInitializing: errors,
                },
            } as any;

            return this._vault.update({
                deposits: {
                    ...currentDeposits.deposits,
                    ...newDeposits,
                },
            });
        } catch (error) {
            log.error('Unexpected error while reconstructing user deposits');
        } finally {
            releaseMutexLock();
        }
    }

    /**
     * It awaits for the Transaction completion or throws if times out
     *
     * @param txHash The transaction hash
     * @param confirmation The number of confirmations before considering it
     * @param timeout Timeout before throwing
     */
    private async waitForTransactionReceipt(
        transactionHash: string,
        provider = this._networkController.getProvider(),
        confirmations = DEFAULT_TORNADO_CONFIRMATION,
        timeout = 60000
    ) {
        try {
            return provider.waitForTransaction(
                transactionHash,
                confirmations,
                timeout
            );
        } catch (error) {
            // eslint-disable-next-line
            throw {
                status: PendingWithdrawalStatus.FAILED,
                message: 'Transaction was not mined',
            };
        }
    }

    /**
     * Checks for the job status on the relayer and awaits for
     * the transaction receipt if confirmed.
     *
     * @param id The job id
     * @param relayerUrl The relayer URL
     */
    private getStatusFromRelayerJob(
        id: string,
        relayerURL: string,
        waitForConfirmation = true
    ): Promise<{ status: PendingWithdrawalStatus; txHash: string }> {
        return new Promise((resolve, reject) => {
            const getRelayerStatus = async () => {
                try {
                    const response = await fetch(
                        `https://${relayerURL}/v1/jobs/${id}`
                    );
                    if (response.ok) {
                        const responseJson = await response.json();
                        if (response.status === 200) {
                            const {
                                txHash,
                                status,
                                failedReason,
                            } = responseJson;

                            if (status === PendingWithdrawalStatus.FAILED) {
                                reject({
                                    status,
                                    message: parseRelayerError(failedReason),
                                });
                                return;
                            }

                            if (waitForConfirmation) {
                                if (
                                    status === PendingWithdrawalStatus.CONFIRMED
                                ) {
                                    resolve({ status, txHash });
                                    return;
                                }
                            } else {
                                if (txHash) {
                                    resolve({ status, txHash });
                                    return;
                                }
                            }
                        }
                    }
                } catch (err) {
                    log.debug(
                        'Unable to resolve call to check for withdrawal job, retrying...'
                    );
                }

                setTimeout(() => {
                    getRelayerStatus();
                }, 3000);
            };

            getRelayerStatus();
        });
    }

    public async withdraw(
        deposit: IBlankDeposit,
        recipient: string
    ): Promise<string> {
        const {
            tornadoServiceFee,
            rewardAccount,
            relayerUrl,
            ethPrices,
        } = await this.getRelayerStatus();

        // Calculate withdrawal gas cost & fees.
        // Relayer always uses fast gas price on legacy, we use maxFeePerGas for EIP1559
        const gasPrices = this._gasPricesController.gasPrices();
        const { fee, decimals } = this.calculateFeeAndTotal(
            deposit.pair,
            tornadoServiceFee,
            gasPrices,
            ethPrices
        );

        const parsedDeposit = await this._notesService.parseDeposit(
            deposit.note
        );

        // Add job to pending withdrawal
        const pending = await this.addPendingWithdrawal(
            deposit,
            recipient,
            decimals,
            relayerUrl
        );
        // Process withdrawal asynchronously and return promise
        this.processWithdrawal(
            deposit,
            parsedDeposit,
            relayerUrl,
            recipient,
            rewardAccount,
            fee,
            pending
        );

        return '';
    }

    /**
     * Processes the withdrawal asynchronously
     */
    private async processWithdrawal(
        deposit: IBlankDeposit,
        parsedDeposit: Omit<INoteDeposit, 'depositIndex'> & {
            nullifier: Buffer;
            secret: Buffer;
        },
        relayerUrl: string,
        recipient: string,
        rewardAccount: string | number | undefined,
        fee: BigNumber,
        pendingWithdrawal: PendingWithdrawal
    ) {
        let proof: any, args: string[];
        let pending = pendingWithdrawal;
        try {
            // Generate proof
            ({ proof, args } = await this._notesService.generateProof(
                deposit.pair,
                parsedDeposit,
                recipient,
                rewardAccount,
                fee.toString()
            ));
        } catch (error) {
            await this.updatePendingWithdrawal(pending.pendingId, {
                status: PendingWithdrawalStatus.FAILED,
                statusMessage: `Failed generating proof: ${
                    error.message || error
                }`,
                chainId: pending.chainId,
            });
            throw error;
        }

        // Send transaction via relayer
        // (We must use the config file directly to prevent issues when changing network)
        const contractAddress = (tornadoConfig.deployments as any)[
            `netId${deposit.chainId}`
        ][deposit.pair.currency].instanceAddress[deposit.pair.amount];

        // const contractKey = currencyAmountPairToMapKey(deposit.pair);
        // const contractAddress = this.tornadoContracts.get(contractKey)?.contract
        //     .address;

        if (!contractAddress) {
            throw new Error('Unsupported network');
        }

        await this.updatePendingWithdrawal(pending.pendingId, {
            statusMessage: 'Sending withdrawal to relayer',
            chainId: pending.chainId,
        });

        let relayData: { id: string };
        try {
            const relay = await fetch(
                `https://${relayerUrl}/v1/tornadoWithdraw`,
                {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contract: contractAddress,
                        proof,
                        args,
                    }),
                }
            );

            if (!relay.ok) {
                try {
                    const err = await relay.json();
                    throw new Error(err.error);
                } catch (error) {
                    throw new Error(relay.statusText);
                }
            }

            relayData = await relay.json();
        } catch (error) {
            const errMessage =
                'Error submitting the withdrawal transaction via the relayer. ' +
                    error.message || error;
            await this.updatePendingWithdrawal(pending.pendingId, {
                status: PendingWithdrawalStatus.FAILED,
                errMessage,
                statusMessage: '',
                chainId: pending.chainId,
            });
            return;
        }

        // Add job to pending withdrawal
        pending = await this.updatePendingWithdrawal(pending.pendingId, {
            jobId: relayData.id,
            status: PendingWithdrawalStatus.PENDING,
            fee,
            statusMessage: 'Awaiting the relayer to proccess the withdrawal',
            chainId: pending.chainId,
        });

        // Start resolving the withdrawal asynchronously
        this.checkPendingWithdrawal(pending);

        // Wait for tx and return as soon as transaction is accepted
        try {
            const { txHash } = await this.getStatusFromRelayerJob(
                pending.jobId,
                pending.relayerUrl,
                false
            );

            if (txHash) {
                await this.updatePendingWithdrawal(pending.pendingId, {
                    statusMessage:
                        'Awaiting for the transaction to be confirmed',
                    transactionHash: txHash,
                    chainId: pending.chainId,
                });
            }
        } catch (error) {
            const errMessage =
                'Error submitting the withdrawal transaction via the relayer. ' +
                    error.message || error;
            await this.updatePendingWithdrawal(pending.pendingId, {
                status: PendingWithdrawalStatus.FAILED,
                errMessage,
                statusMessage: '',
                chainId: pending.chainId,
            });
        }
    }

    /**
     * Updates a pending withdrawal transaction
     * @param depositId The withdraw deposit id
     */
    private async updatePendingWithdrawal(
        pendingId: string,
        pendingWithdrawal: Partial<PendingWithdrawal>
    ) {
        // Lock store
        const {
            releaseMutexLock,
        } = await this._pendingWithdrawalsStore.getStoreMutexLock();

        try {
            // At this point, chainId is always ensured.
            // Also, network will always be found, given that Tornado chains
            // mustn't be allowed to be removed
            const { name } = this._networkController.getNetworkFromChainId(
                pendingWithdrawal.chainId!
            )!;

            const pendingWithdrawals = [
                ...this._pendingWithdrawalsStore.store.getState()[
                    name as AvailableNetworks
                ].pending,
            ];

            const pendingWithdrawalIndex = pendingWithdrawals.findIndex(
                (p) => p.pendingId === pendingId
            );
            if (pendingWithdrawalIndex < 0) {
                throw new Error('Pending withdrawal not found');
            }

            // Remove chainId so it won't get updated
            delete pendingWithdrawal['chainId'];

            pendingWithdrawals[pendingWithdrawalIndex] = {
                ...pendingWithdrawals[pendingWithdrawalIndex],
                ...pendingWithdrawal,
            };

            this._pendingWithdrawalsStore.store.updateState({
                [name as AvailableNetworks]: {
                    pending: [...pendingWithdrawals],
                },
            });

            return pendingWithdrawals[pendingWithdrawalIndex];
        } finally {
            releaseMutexLock();
        }
    }

    /**
     * Adds a pending withdrawal transaction to the queue
     *
     * @param depositId The deposit id
     * @param pair The deposit pair
     * @param toAddress The withdrawal recipient
     * @param relayerUrl The relayer url
     */
    private async addPendingWithdrawal(
        { id: depositId, pair }: IBlankDeposit,
        toAddress: string,
        decimals: number,
        relayerUrl: string
    ) {
        // Lock store
        const {
            releaseMutexLock,
        } = await this._pendingWithdrawalsStore.getStoreMutexLock();

        const { name, chainId } = this._networkController.network;

        const pendingWithdrawals = this._pendingWithdrawalsStore.store.getState()[
            name as AvailableNetworks
        ];

        const pending: PendingWithdrawal = {
            pendingId: uuid(),
            depositId,
            pair,
            toAddress,
            relayerUrl,
            status: PendingWithdrawalStatus.UNSUBMITTED,
            time: new Date().getTime(),
            decimals,
            jobId: '',
            errMessage: '',
            statusMessage: 'Generating proof',
            chainId,
        };

        this._pendingWithdrawalsStore.store.updateState({
            [name as AvailableNetworks]: {
                pending: [...pendingWithdrawals.pending, pending],
            },
        });

        releaseMutexLock();

        return pending;
    }

    /**
     * It returns the Withdrawal gas cost and fees using the FAST option (as the relayer does)
     */
    public async getWithdrawalFees(
        pair: CurrencyAmountPair
    ): Promise<{
        relayerFee: BigNumber;
        gasFee: BigNumber;
        totalFee: BigNumber;
        total: BigNumber;
    }> {
        const { tornadoServiceFee, ethPrices } = await this.getRelayerStatus();

        // Calculate withdrawal gas cost & fees.
        // Relayer always uses fast gas price on legacy, we use maxFeePerGas for EIP1559
        const gasPrices = this._gasPricesController.gasPrices();
        const { fee, total, feePercent, gasCost } = this.calculateFeeAndTotal(
            pair,
            tornadoServiceFee,
            gasPrices,
            ethPrices
        );

        return {
            relayerFee: feePercent,
            gasFee: gasCost,
            totalFee: fee,
            total,
        };
    }

    /**
     * calculateFee
     *
     * It returns the withdrawal fee
     *
     * @param amount
     * @param relayerServiceFee
     */
    public calculateFeeAndTotal(
        currencyAmountPair: CurrencyAmountPair,
        relayerServiceFee: number,
        gasPrices: GasPriceLevels,
        ethPrices: {
            [key in Exclude<KnownCurrencies, KnownCurrencies.ETH>]: string;
        }
    ): {
        total: BigNumber;
        fee: BigNumber;
        decimals: number;
        gasCost: BigNumber;
        feePercent: BigNumber;
    } {
        // Get Token decimals
        const decimals = this.tornadoContracts.get(
            currencyAmountPairToMapKey(currencyAmountPair)
        )?.decimals;

        if (!decimals) {
            throw new Error('Token decimals are not present on config');
        }

        // Parse relayer service fee
        const decimalsPoint =
            Math.floor(relayerServiceFee) === Number(relayerServiceFee)
                ? 0
                : relayerServiceFee.toString().split('.')[1].length;

        const relayerServiceFeeBN = utils.parseUnits(
            relayerServiceFee.toString(),
            decimalsPoint
        );

        const roundDecimal = 10 ** decimalsPoint;

        // If gasPrice is undefined, then it is EIP-1559
        let fastPrice: BigNumber;
        if (gasPrices.fast.gasPrice) {
            const gasPriceFast = gasPrices.fast.gasPrice;

            // Gas bump based on Tornado cli fee calculation
            let fivePercent = BnMultiplyByFraction(gasPriceFast, 5, 100);
            const minValue = utils.parseUnits('3', 'gwei');
            fivePercent = fivePercent.lt(minValue) ? minValue : fivePercent;

            // Set bumped gas price
            fastPrice = gasPriceFast.add(fivePercent);
        } else {
            // The relayer checks for the fee using the baseFee, for checking for the desired fee,
            // using here the maxFeePerGas we make it inclusive of the priority tip as well.
            fastPrice = gasPrices.fast.maxFeePerGas!;
        }

        // Calculate expense and total
        const expense = BigNumber.from(fastPrice).mul(
            BigNumber.from(WITHDRAWAL_GAS_LIMIT)
        );
        const total = utils.parseUnits(currencyAmountPair.amount, decimals);

        // fee to add to the total gas cost
        const feePercent = total
            .mul(relayerServiceFeeBN)
            .div(BigNumber.from(roundDecimal * 100));

        let desiredFee;
        if (currencyAmountPair.currency === KnownCurrencies.ETH) {
            desiredFee = expense.add(feePercent);
        } else {
            // If ERC20
            desiredFee = expense
                .mul(BigNumber.from(10).pow(decimals))
                .div(ethPrices[currencyAmountPair.currency]);

            desiredFee = desiredFee.add(feePercent);
        }

        return {
            total,
            fee: desiredFee,
            decimals,
            gasCost: desiredFee.sub(feePercent),
            feePercent,
        };
    }

    public async populateDepositTransaction(
        currencyAmountPair: CurrencyAmountPair
    ): Promise<ethers.PopulatedTransaction> {
        // Get next free deposit & possible recovered ones
        const {
            nextDeposit,
            recoveredDeposits,
        } = await this._notesService.getNextFreeDeposit(currencyAmountPair);

        if (recoveredDeposits) {
            this.addDeposits(recoveredDeposits);
        }

        const depositTransaction = this.getDepositTransaction();

        return depositTransaction.populateTransaction({
            currencyAmountPair,
            nextDeposit,
        } as DepositTransactionPopulatedTransactionParams);
    }

    public async addAsNewDepositTransaction(
        currencyAmountPair: CurrencyAmountPair,
        populatedTransaction: ethers.PopulatedTransaction,
        feeData: FeeData,
        approveUnlimited = false
    ): Promise<TransactionMeta> {
        const depositTransaction = this.getDepositTransaction();

        return depositTransaction.addAsNewDepositTransaction(
            currencyAmountPair,
            populatedTransaction,
            feeData,
            approveUnlimited
        );
    }

    public async updateDepositTransactionGas(
        transactionId: string,
        feeData: FeeData
    ): Promise<void> {
        const depositTransaction = this.getDepositTransaction();

        return depositTransaction.updateTransactionGas(transactionId, feeData);
    }

    public async approveDepositTransaction(
        transactionId: string,
        currencyAmountPair?: CurrencyAmountPair
    ): Promise<void> {
        // Obtain previously generated unsubmitted transaction
        const transactionMeta = this._transactionController.getTransaction(
            transactionId
        );

        if (!transactionMeta) {
            throw new Error(`Deposit transaction (${transactionId}) not found`);
        }

        // Enforce having a correct pair
        currencyAmountPair = currencyAmountPair ?? transactionMeta.depositPair;

        if (!currencyAmountPair) {
            throw new Error(
                `Deposit transaction (${transactionId}) has a wrong pair set`
            );
        }

        // Get network chainId
        const { chainId } = this._networkController.network;

        // Get next free deposit & possible recovered ones
        const {
            nextDeposit,
            increment,
        } = await this._notesService.getNextFreeDeposit(currencyAmountPair);

        // Add the deposit to the vault
        await this.addDeposits([
            {
                id: transactionMeta.blankDepositId!,
                note: nextDeposit.deposit.preImage.toString('hex'),
                nullifierHex: nextDeposit.deposit.nullifierHex,
                pair: nextDeposit.pair,
                timestamp: new Date().getTime(),
                spent: false,
                depositAddress: this._preferencesController.getSelectedAddress(),
                status: DepositStatus.PENDING,
                depositIndex: nextDeposit.deposit.depositIndex,
                chainId,
            },
        ]);

        // Increment the nextDeposit derivation count if it's a new derivation
        if (increment) {
            increment();
        }

        // Start processing pending deposit (If transactions fails on approving phase this will set the deposit to failed)
        this.processPendingDeposit(transactionMeta);

        // Approve transaction
        const depositTransaction = this.getDepositTransaction();

        return depositTransaction.approveTransaction(transactionMeta.id);
    }

    public async getDepositTransactionResult(
        transactionId: string
    ): Promise<string> {
        const depositTransaction = this.getDepositTransaction();

        return depositTransaction.getTransactionResult(transactionId);
    }

    public async calculateDepositTransactionGasLimit(
        currencyAmountPair: CurrencyAmountPair
    ): Promise<TransactionGasEstimation> {
        const depositTransaction = this.getDepositTransaction();

        // Get next free deposit
        const { nextDeposit } = await this._notesService.getNextFreeDeposit(
            currencyAmountPair
        );

        return depositTransaction.calculateTransactionGasLimit({
            currencyAmountPair,
            nextDeposit,
        } as DepositTransactionPopulatedTransactionParams);
    }

    private getDepositTransaction(): DepositTransaction {
        return new DepositTransaction({
            networkController: this._networkController,
            preferencesController: this._preferencesController,
            transactionController: this._transactionController,
            proxyContract: this.proxyContract,
            tornadoContracts: this.tornadoContracts,
            tokenController: this._tokenController,
            tokenOperationsController: this._tokenOperationsController,
        });
    }

    public async getInstanceTokenAllowance(
        pair: CurrencyAmountPair
    ): Promise<BigNumber> {
        return this.getDepositTransaction().getTokenAllowance(pair);
    }

    public async deposit(
        currencyAmountPair: CurrencyAmountPair,
        feeData: FeeData,
        approveUnlimited = false
    ): Promise<string> {
        // Lock on deposit generation to prevent race condition on keys derivation
        const releaseLock = await this._depositLock.acquire();
        try {
            const populatedTransaction = await this.populateDepositTransaction(
                currencyAmountPair
            );

            const transactionMeta = await this.addAsNewDepositTransaction(
                currencyAmountPair,
                populatedTransaction,
                feeData,
                approveUnlimited
            );

            await this.approveDepositTransaction(
                transactionMeta.id,
                currencyAmountPair
            );

            return this.getDepositTransactionResult(transactionMeta.id);
        } finally {
            releaseLock();
        }
    }

    /**
     * It processes a pending deposit transaction
     *
     * @param meta The transaction meta
     * @param [confirmations] The number of confirmations before marking a deposit as CONFIRMED
     * @param [timeout] Timeout for confirmations counting
     */
    private async processPendingDeposit(meta: TransactionMeta) {
        const provider = this._networkController.getProvider();

        // Check that meta is from the provider chain
        if (provider.network.chainId !== meta.chainId) {
            return;
        }

        if (!meta.blankDepositId) {
            throw new Error('Not a Blank deposit');
        }
        let depositStatus: DepositStatus;
        try {
            // Wait for transaction confirmation
            // For deposits, transaction waits for 4 confirmation
            await this._transactionController.waitForTransactionResult(
                meta.id,
                true
            );

            // Set deposit status to confirmed
            depositStatus = DepositStatus.CONFIRMED;
        } catch (error) {
            // Set deposit status to failed
            depositStatus = DepositStatus.FAILED;
            log.debug(
                'BlankDeposits - Failing deposit as transaction was not confirmed. ' +
                    error.message || error
            );
        }

        // Update deposit state only if vault is still unlocked
        // && network is still the same
        if (this.isUnlocked) {
            return this.updateDepositStatus(
                meta.blankDepositId,
                depositStatus,
                meta.chainId
            );
        }
    }
}
