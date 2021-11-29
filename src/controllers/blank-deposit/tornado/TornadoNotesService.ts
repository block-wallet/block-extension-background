/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BigNumber, Contract } from 'ethers';
import { bigInt } from 'snarkjs';
import { v4 as uuid } from 'uuid';

import { INoteDeposit } from '../notes/INoteDeposit';
import { NotesService } from '../notes/NotesService';
import {
    AvailableNetworks,
    CurrencyAmountArray,
    CurrencyAmountPair,
    DepositStatus,
} from '../types';
import { IBlankDeposit } from '../BlankDeposit';
import { ITornadoContract, TornadoEvents } from './config/ITornadoContract';
import {
    keyToCurrencyAmountPair,
    currencyAmountPairToMapKey,
    toHex,
    compareDepositsByPair,
} from './utils';
import { TornadoEventsDB } from './stores/TornadoEventsDB';
import NetworkController from '../../NetworkController';
import { WorkerRunner } from '../../../infrastructure/workers/WorkerRunner';
import { CircuitInput } from './types';
import { IProverWorker } from './IProverWorker';
import log from 'loglevel';

type ContractsType = Map<
    string,
    {
        contract?: ITornadoContract;
        getNextDeposit?: AsyncGenerator<
            {
                spent?: boolean;
                deposit: INoteDeposit;
                exists?: boolean;
                timestamp?: number;
                increment?: () => number;
            },
            void,
            unknown
        >;
    }
>;

export class TornadoNotesService extends NotesService {
    private contracts: ContractsType;

    // Prover Worker
    private workerRunner!: WorkerRunner<IProverWorker>;

    constructor(
        private readonly _networkController: NetworkController,
        private readonly _tornadoEventsDb: TornadoEventsDB,
        public updateTornadoEvents: (
            eventType: TornadoEvents,
            currencyAmountPair: CurrencyAmountPair,
            contract: Contract,
            forceUpdate: boolean
        ) => Promise<void>,
        public getFailedDeposits: (
            pair: CurrencyAmountPair
        ) => Promise<IBlankDeposit[]>,
        public dropFailed: (depositId: string) => Promise<void>
    ) {
        super();
        this.contracts = new Map();
    }

    public async updateUnspentNotes(
        unspentDeposits: IBlankDeposit[]
    ): Promise<IBlankDeposit[]> {
        const sortedDeposits = unspentDeposits.sort(compareDepositsByPair);
        const { name: network } = this._networkController.network;

        const checkDeposits = async () => {
            const toUpdate = [];
            let lastDepositKey = '';
            for (const deposit of sortedDeposits) {
                const key = currencyAmountPairToMapKey(deposit.pair);
                if (lastDepositKey !== key) {
                    const contractObj = this.contracts.get(key);

                    if (!contractObj) {
                        throw new Error('Unexpected error');
                    }

                    await this.getWithdrawalEvents(
                        contractObj.contract!,
                        deposit.pair
                    );
                }

                // Check if deposit has been spent
                const isSpent = await this._tornadoEventsDb.isSpent(
                    network as AvailableNetworks,
                    deposit.pair,
                    deposit.nullifierHex
                );

                if (isSpent) {
                    deposit.spent = true;
                    toUpdate.push(deposit);
                }

                lastDepositKey = key;
            }

            return toUpdate;
        };

        return checkDeposits();
    }

    protected async getBlake3Hash(data: Buffer): Promise<Buffer> {
        // Convert to hex string
        const stringifiedData = data.toString('hex');

        // Hash data using blake3
        const hash = (await this.workerRunner.run({
            name: 'blake3',
            data: stringifiedData as Parameters<IProverWorker['blake3']>[0],
        })) as ReturnType<IProverWorker['blake3']>;

        return Buffer.from(hash);
    }

    public async getNoteString(
        deposit: IBlankDeposit,
        chainId: number
    ): Promise<string> {
        const { amount, currency } = deposit.pair;
        const { preImage } = await this.parseDeposit(deposit.note);
        const note = toHex(preImage, 62);

        return `tornado-${currency}-${amount}-${chainId}-${note}`;
    }

    /**
     * Inits the root paths
     */
    public async initRootPath(mnemonic?: string): Promise<void> {
        // Set the derivations root path
        return this.setRootPath(mnemonic);
    }

    public async initialize(): Promise<void> {
        const ProverWorker = (await import('worker-loader!./ProverWorker'))
            .default;
        this.workerRunner = new WorkerRunner(new ProverWorker());

        const provingKeyUrl = chrome.runtime.getURL(
            'snarks/tornado/tornadoProvingKey.bin'
        );
        const withdrawCircuitUrl = chrome.runtime.getURL(
            'snarks/tornado/tornado.json'
        );

        await this.workerRunner.run({
            name: 'init',
            data: { provingKeyUrl, withdrawCircuitUrl } as Parameters<
                IProverWorker['init']
            >[0],
        });
    }

    /**
     * Generate merkle tree for a deposit.
     * Download deposit events from tornado, reconstructs merkle tree, finds our deposit leaf
     * in it and generates merkle proof
     * @param deposit Deposit object
     */
    public async generateMerkleProof(
        contract: ITornadoContract,
        currencyAmountPair: CurrencyAmountPair,
        deposit: Omit<INoteDeposit, 'depositIndex'> & {
            nullifier: Buffer;
            secret: Buffer;
        }
    ): Promise<ReturnType<IProverWorker['generateMerkleProof']>> {
        // Get network
        const { name: network } = this._networkController.network;

        // Get deposit db key
        const key = this._tornadoEventsDb.getDepositTableName(
            network as AvailableNetworks,
            currencyAmountPair
        );

        const getMerkleTreeRoot = async (forceUpdate = false) => {
            // Check if deposit has been already spent
            // const isSpent = await contract.isSpent(toHex(deposit.nullifierHash))
            await this.getWithdrawalEvents(contract, currencyAmountPair);
            const isSpent = await this._tornadoEventsDb.isSpent(
                network as AvailableNetworks,
                currencyAmountPair,
                deposit.nullifierHex
            );

            if (isSpent) {
                throw new Error('The note is already spent');
            }

            const lastLeafIndex = (await this.workerRunner.run({
                name: 'getLastLeafIndex',
                data: { key } as Parameters<
                    IProverWorker['getLastLeafIndex']
                >[0],
            })) as ReturnType<IProverWorker['getLastLeafIndex']>;

            // Update deposit events
            await this.getDepositEvents(
                contract,
                currencyAmountPair,
                forceUpdate
            );

            // Retrieve all events from IndexedDB
            const events =
                await this._tornadoEventsDb.getAllDepositsByLeafIndex(
                    network as AvailableNetworks,
                    currencyAmountPair,
                    lastLeafIndex
                );

            // Assemble merkle tree
            const leaves = events.map((e) =>
                BigNumber.from(e.commitment).toString()
            );
            return this.workerRunner.run({
                name: 'updateMerkleTree',
                data: { key, leaves, forceUpdate } as Parameters<
                    IProverWorker['updateMerkleTree']
                >[0],
            });
        };

        // Validate that our data is correct
        let root = await getMerkleTreeRoot();
        let isValidRoot = await contract.isKnownRoot(toHex(root));

        // Check if valid root
        if (isValidRoot !== true) {
            // Check once more with forceUpdate on true or throw
            root = await getMerkleTreeRoot(true);
            isValidRoot = await contract.isKnownRoot(toHex(root));

            if (!isValidRoot) {
                throw new Error('Merkle tree is corrupted');
            }
        }

        // Get leaf index
        const depEv = await this._tornadoEventsDb.getDepositEventByCommitment(
            network as AvailableNetworks,
            currencyAmountPair,
            deposit.commitmentHex
        );

        if (!depEv) {
            throw new Error('The deposit is not present in the tree');
        }

        // Compute merkle proof of our commitment
        const { leafIndex } = depEv;
        return this.workerRunner.run({
            name: 'generateMerkleProof',
            data: { key, depositLeafIndex: leafIndex } as Parameters<
                IProverWorker['generateMerkleProof']
            >[0],
        }) as Promise<ReturnType<IProverWorker['generateMerkleProof']>>;
    }

    /**
     * It returns the list of Withdrawal events from
     * the specified tornado contract instance
     *
     * @param contract The tornado contract instance
     * @param fromBlock The block to start querying from
     */
    private async getWithdrawalEvents(
        contract: ITornadoContract,
        currencyAmountPair: CurrencyAmountPair,
        forceUpdate = false
    ) {
        return this.updateTornadoEvents(
            TornadoEvents.WITHDRAWAL,
            currencyAmountPair,
            contract,
            forceUpdate
        );
    }

    /**
     * It returns the list of Deposit events from
     * the specified tornado contract instance
     *
     * @param contract The tornado contract instance
     * @param fromBlock The block to start querying from
     */
    private async getDepositEvents(
        contract: ITornadoContract,
        currencyAmountPair: CurrencyAmountPair,
        forceUpdate = false
    ) {
        return this.updateTornadoEvents(
            TornadoEvents.DEPOSIT,
            currencyAmountPair,
            contract,
            forceUpdate
        );
    }

    /**
     * generateProof
     *
     * Generate SNARK proof for withdrawal
     *
     * @param deposit Deposit object
     * @param recipient Funds recipient
     * @param relayer Relayer address
     * @param fee Relayer fee
     * @param refund Receive ether for exchanged tokens
     */
    public async generateProof(
        depositPair: CurrencyAmountPair,
        deposit: Omit<INoteDeposit, 'depositIndex'> & {
            nullifier: Buffer;
            secret: Buffer;
        },
        recipient: string,
        relayerAddress: number | string = 0,
        fee: number | string = 0,
        refund = 0
    ): Promise<{ proof: any; args: string[] }> {
        const contract = this.contracts.get(
            currencyAmountPairToMapKey(depositPair)
        )?.contract;

        if (!contract) {
            throw new Error('Currency/Amount contract instance not supported');
        }

        // Compute merkle proof of our commitment
        const { root, pathElements, pathIndices } =
            await this.generateMerkleProof(contract, depositPair, deposit);

        // Prepare circuit input
        const input: CircuitInput = {
            // Public snark inputs
            root: root,
            nullifierHash: deposit.nullifierHash,
            recipient: bigInt(recipient),
            relayer: bigInt(relayerAddress),
            fee: bigInt(fee),
            refund: bigInt(refund),

            // Private snark inputs
            nullifier: deposit.nullifier,
            secret: deposit.secret,
            pathElements,
            pathIndices,
        };

        // Run prover worker
        const proof = await this.workerRunner.run({
            name: 'getProofData',
            data: { input } as Parameters<IProverWorker['getProofData']>[0],
        });

        const args = [
            toHex(input.root),
            toHex(input.nullifierHash),
            toHex(input.recipient, 20),
            toHex(input.relayer, 20),
            toHex(input.fee),
            toHex(input.refund),
        ];

        return { proof, args };
    }

    /**
     * getPreimageAndNullifier
     *
     * It extracts the secret and nullifier from the hashed key
     * using the hashedKey bytes
     *
     * @param hashedKey The hashed key
     * @returns The preimage, secret and nullifier
     */
    private getPreimageAndNullifier(hashedKey: Buffer) {
        // Extract the secrets (first 31 bytes for nullifier, last 31 bytes for secret)
        const nullifier = hashedKey.slice(0, 31);
        const secret = hashedKey.slice(hashedKey.length - 31);

        // Generate preimage
        const preImage = Buffer.concat([nullifier, secret]);

        return { preImage, nullifier, secret };
    }

    /**
     * Parses a deposit note or preimage
     */
    public async parseDeposit(note: string): Promise<{
        secret: any;
        nullifier: any;
        preImage: Buffer;
        commitment: any;
        commitmentHex: string;
        nullifierHash: any;
        nullifierHex: string;
    }> {
        const buf = Buffer.from(note, 'hex');

        const nullifier = bigInt.leBuff2int(buf.slice(0, 31));
        const secret = bigInt.leBuff2int(buf.slice(31, 62));
        const preImage = Buffer.concat([
            nullifier.leInt2Buff(31),
            secret.leInt2Buff(31),
        ]);

        const commitment = bigInt(
            await this.workerRunner.run({
                name: 'pedersenHash',
                data: preImage.toString('hex') as Parameters<
                    IProverWorker['pedersenHash']
                >[0],
            })
        ); //this.pedersenHash(preImage);
        const commitmentHex = toHex(commitment);

        const nullifierHash = bigInt(
            await this.workerRunner.run({
                name: 'pedersenHash',
                data: nullifier.leInt2Buff(31).toString('hex') as Parameters<
                    IProverWorker['pedersenHash']
                >[0],
            })
        ); // this.pedersenHash(nullifier.leInt2Buff(31));

        const nullifierHex = toHex(nullifierHash);

        return {
            secret,
            nullifier,
            preImage,
            commitment,
            commitmentHex,
            nullifierHash,
            nullifierHex,
        };
    }

    protected async createDeposit(
        depositIndex: number,
        chainId: number,
        pair: CurrencyAmountPair
    ): Promise<INoteDeposit> {
        // Get derived deposit key and its hash
        const derivedKey = this.getDerivedDepositKey(
            depositIndex,
            chainId,
            pair
        );
        const hashedKey = await this.getBlake3Hash(derivedKey);

        // Extract nullifier and secret from the hashedKey
        const { preImage, nullifier } = this.getPreimageAndNullifier(hashedKey);

        // Calculate commitment
        const commitment = bigInt(
            await this.workerRunner.run({
                name: 'pedersenHash',
                data: preImage.toString('hex') as Parameters<
                    IProverWorker['pedersenHash']
                >[0],
            })
        ); // const commitment = this.pedersenHash(preImage);

        const nullifierHash = bigInt(
            await this.workerRunner.run({
                name: 'pedersenHash',
                data: nullifier.toString('hex') as Parameters<
                    IProverWorker['pedersenHash']
                >[0],
            })
        ); // const nullifierHash = this.pedersenHash(nullifier);

        return {
            preImage,
            commitment,
            depositIndex,
            nullifierHash,
            commitmentHex: toHex(commitment),
            nullifierHex: toHex(nullifierHash),
        };
    }

    protected async *getNextUnderivedDeposit(
        currencyAmountPairKey: string,
        numberOfDeposits?: number
    ): AsyncGenerator<
        {
            spent?: boolean;
            deposit: INoteDeposit;
            timestamp?: number;
            exists?: boolean;
            increment?: () => number;
        },
        void,
        unknown
    > {
        let depositIndex = numberOfDeposits || 0;

        while (true) {
            if (!this.isRootPathSet()) {
                throw new Error(
                    'The wallet has not been initialized or it is locked'
                );
            }

            // Get network
            const { chainId, name: network } = this._networkController.network;

            // Get contract
            if (!this.contracts.has(currencyAmountPairKey)) {
                throw new Error('Contract not available!');
            }
            const { contract } = this.contracts.get(currencyAmountPairKey)!;

            // Get currency amount pair
            const currencyAmountPair = keyToCurrencyAmountPair(
                currencyAmountPairKey
            );

            // Check if there's a failed deposit to use that key first before deriving
            const failedDeposits = await this.getFailedDeposits(
                currencyAmountPair
            );
            depositIndex =
                failedDeposits.length !== 0
                    ? failedDeposits[0].depositIndex
                    : depositIndex;

            // Derive deposit
            const deposit = await this.createDeposit(
                depositIndex,
                chainId,
                currencyAmountPair
            );

            // Drop failed deposit if deriving it again
            if (failedDeposits.length !== 0) {
                await this.dropFailed(failedDeposits[0].id);
            }

            // Check if commitment exist and if it's been spent
            try {
                // Try to pick the derived deposit from the events
                let depEv =
                    await this._tornadoEventsDb.getDepositEventByCommitment(
                        network as AvailableNetworks,
                        currencyAmountPair,
                        deposit.commitmentHex
                    );

                if (!depEv) {
                    try {
                        // Update events
                        await this.getDepositEvents(
                            contract!,
                            currencyAmountPair
                        );
                    } catch (err) {
                        log.warn(
                            'Unable to update the deposits events, tree may be outdated',
                            err.message || err
                        );
                    }
                    depEv =
                        await this._tornadoEventsDb.getDepositEventByCommitment(
                            network as AvailableNetworks,
                            currencyAmountPair,
                            deposit.commitmentHex
                        );
                }

                // Check if deposit exists
                if (depEv) {
                    let spent: boolean | undefined;
                    try {
                        await this.getWithdrawalEvents(
                            contract!,
                            currencyAmountPair
                        );
                        spent = await this._tornadoEventsDb.isSpent(
                            network as AvailableNetworks,
                            currencyAmountPair,
                            deposit.nullifierHex
                        );
                    } catch (error) {
                        log.error('Unable to check if deposit has been spent');
                        spent = undefined;
                    }

                    // If deposits exists increment counter and yield it
                    depositIndex++;
                    const timestamp = Number(depEv.timestamp) * 1000;
                    yield {
                        spent,
                        deposit,
                        exists: true,
                        timestamp,
                    };
                } else {
                    // If deposits does not exist just yield it
                    // Incrementation will be done in case the deposit is succesfully sent to Tornado
                    yield {
                        deposit,
                        exists: false,
                        increment:
                            failedDeposits.length !== 0
                                ? undefined
                                : () => depositIndex++,
                    };
                }
            } catch (error) {
                // If an error ocurred just yield the derived deposit
                log.error('Unable to check if deposit exists', error);
                yield {
                    deposit,
                };
            }
        }
    }

    /**
     * Iterates over single currency/amount pair possible deposits
     */
    private async getCurrencyAmountPairDeposits(
        currencyAmountPairKey: string
    ): Promise<IBlankDeposit[]> {
        // Get key for contracts map
        if (!this.contracts.has(currencyAmountPairKey)) {
            throw new Error('Currency/pair not supported');
        }

        const { getNextDeposit } = this.contracts.get(currencyAmountPairKey)!;

        // Check for deposits
        const deposits: IBlankDeposit[] = [];

        // Disabled rule as needed to iterate through all the deposits
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const deposit = (await getNextDeposit!.next()).value;
            if (!(deposit instanceof Object))
                throw new Error('Internal error in generator');

            if (!deposit.exists) {
                if (typeof deposit.exists === 'undefined') {
                    log.error(
                        'Unable to check if the deposit exists. Halting reconstruction'
                    );
                    throw new Error('Unable to check if the deposit exists');
                }

                break;
            }

            deposits.push({
                id: uuid(),
                note: deposit.deposit.preImage.toString('hex'),
                nullifierHex: deposit.deposit.nullifierHex,
                spent: deposit.spent,
                pair: keyToCurrencyAmountPair(currencyAmountPairKey),
                timestamp: deposit.timestamp || new Date().getTime(),
                status: DepositStatus.CONFIRMED,
                depositIndex: deposit.deposit.depositIndex,
            });
        }

        return deposits;
    }

    public async reconstruct(
        mnemonic?: string,
        lastDepositIndex = 0
    ): Promise<PromiseSettledResult<IBlankDeposit[]>[]> {
        const promises: Promise<IBlankDeposit[]>[] = [];

        if (mnemonic) {
            await this.setRootPath(mnemonic);
        }

        for (const [key, value] of this.contracts) {
            // Init path
            const { currency } = keyToCurrencyAmountPair(key);

            if (!Object.keys(CurrencyAmountArray).includes(currency)) {
                continue;
            }

            if (mnemonic) {
                value.getNextDeposit = this.getNextUnderivedDeposit(
                    key,
                    lastDepositIndex
                );
            }

            // Init generator from last number of deposit defaulting to zero index start
            promises.push(this.getCurrencyAmountPairDeposits(key));
        }

        return Promise.allSettled(promises);
    }

    public async getNextFreeDeposit(
        currencyAmountPair: CurrencyAmountPair
    ): Promise<{
        nextDeposit: {
            spent?: boolean | undefined;
            deposit: INoteDeposit;
            pair: CurrencyAmountPair;
        };
        increment?: () => number;
        recoveredDeposits?: IBlankDeposit[];
    }> {
        // Get key for contracts map
        const currencyAmountPairKey =
            currencyAmountPairToMapKey(currencyAmountPair);
        if (!this.contracts.has(currencyAmountPairKey)) {
            throw new Error('Currency/pair not supported');
        }

        const { getNextDeposit } = this.contracts.get(currencyAmountPairKey)!;

        let nextDeposit: any = {};
        const recoveredDeposits: IBlankDeposit[] = [];
        let increment = undefined;

        // Disabled rule as needed to iterate through all the deposits
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // At this stage getNextDeposit will be initialized
            const deposit = (await getNextDeposit!.next()).value;
            if (!(deposit instanceof Object))
                throw new Error('Internal error in generator');

            if (!deposit.exists) {
                if (typeof deposit.exists === 'undefined')
                    throw new Error(
                        'Unable to check if the next deposit already exists'
                    );

                nextDeposit = {
                    deposit: deposit.deposit,
                    pair: currencyAmountPair,
                    spent: false,
                };

                increment = deposit.increment;

                break;
            } else {
                recoveredDeposits.push({
                    id: uuid(),
                    note: deposit.deposit.preImage.toString('hex'),
                    nullifierHex: deposit.deposit.nullifierHex,
                    pair: currencyAmountPair,
                    spent: deposit.spent,
                    timestamp: deposit.timestamp || new Date().getTime(),
                    status: DepositStatus.CONFIRMED,
                    depositIndex: deposit.deposit.depositIndex,
                });
            }
        }

        return {
            nextDeposit,
            recoveredDeposits:
                recoveredDeposits.length === 0 ? undefined : recoveredDeposits,
            increment,
        };
    }

    /**
     * It sets the tornado contract
     *
     * @param tornado The tornado contract
     */
    public setTornadoContracts(
        contracts: Map<
            string,
            {
                contract: ITornadoContract;
                decimals: number;
                tokenAddress?: string;
                depositCount: number;
            }
        >
    ): void {
        // Set instances contracts
        for (const [key, value] of contracts.entries()) {
            if (this.contracts.has(key)) {
                const contractObj = this.contracts.get(key)!;
                contractObj.contract = value.contract;
                contractObj.getNextDeposit = this.getNextUnderivedDeposit(
                    key,
                    value.depositCount
                );
            } else {
                this.contracts.set(key, {
                    contract: value.contract,
                    getNextDeposit: this.getNextUnderivedDeposit(
                        key,
                        value.depositCount
                    ),
                });
            }
        }
    }
}
