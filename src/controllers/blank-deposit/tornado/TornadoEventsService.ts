import { BigNumber, Contract, Event } from 'ethers';
import axios from 'axios';
import { addHexPrefix } from 'ethereumjs-util';
import log from 'loglevel';
import { CurrencyAmountPair } from '../types';
import { Deposit, Withdrawal } from './stores/ITornadoEventsDB';
import BlockUpdatesController from '../../BlockUpdatesController';
import { TornadoEvents } from './config/ITornadoContract';

export interface TornadoEventsServiceProps {
    blockUpdatesController: BlockUpdatesController;
    endpoint: string;
    version: string;
}

export interface EventsChainFetchOptions {
    fromBlock: number;
    contract: Contract;
}

export interface EventsFetchOptions {
    chainId: number;
    pair: CurrencyAmountPair;
    from?: number;
    chainOptions: EventsChainFetchOptions;
}

const MAX_HTTP_RETRIES = 5;
const RETRIES_DELAY = 500;

export class TornadoEventsService {
    private readonly _blockUpdatesController: BlockUpdatesController;
    private _endpoint: string;

    constructor(props: TornadoEventsServiceProps) {
        this._blockUpdatesController = props.blockUpdatesController;
        this._endpoint = this._parseEndpoint(props.endpoint, props.version);
    }

    public async getDeposits({
        chainId,
        pair: { currency, amount },
        from,
        chainOptions,
    }: EventsFetchOptions): Promise<Deposit[]> {
        return this._getEvents(
            'deposits',
            chainId,
            currency,
            amount,
            chainOptions,
            from
        );
    }

    public async getWithdrawals({
        chainId,
        pair: { currency, amount },
        from,
        chainOptions,
    }: EventsFetchOptions): Promise<Withdrawal[]> {
        return this._getEvents(
            'withdrawals',
            chainId,
            currency,
            amount,
            chainOptions,
            from
        );
    }

    private async _getEvents<T extends 'deposits' | 'withdrawals'>(
        type: T,
        chainId: number,
        currency: string,
        amount: string,
        chainOptions: EventsChainFetchOptions,
        from?: number
    ): Promise<T extends 'deposits' ? Deposit[] : Withdrawal[]> {
        const events = [];

        try {
            const results = await this._getPaginated(
                type,
                chainId,
                currency,
                amount,
                from || 0
            );

            for (let i = 0; i < results.length; i++) {
                const result = results[i] as any;

                if (type == 'deposits') {
                    events.push({
                        leafIndex: parseInt((result['li'] || '0').toString()),
                        commitment: addHexPrefix(result['c'].toString()),
                        timestamp: result['t'].toString(),
                        transactionHash: result['th'].toString(),
                        blockNumber: parseInt(result['bn'].toString()),
                    } as Deposit);
                } else {
                    events.push({
                        nullifierHex: addHexPrefix(result['nh'].toString()),
                        to: result['t'].toString(),
                        fee: BigNumber.from(result['f'].toString()),
                        transactionHash: result['th'].toString(),
                        blockNumber: parseInt(result['bn'].toString()),
                    } as Withdrawal);
                }
            }
        } catch (e) {
            log.error(
                `Error fetching tornado events from service: ${e.message}`
            );

            //If there is an error here, we should query the blockchain
            const results = await this._fetchEventsFromChain(
                type == 'deposits'
                    ? TornadoEvents.DEPOSIT
                    : TornadoEvents.WITHDRAWAL,
                chainOptions.fromBlock,
                chainOptions.contract
            );

            for (let i = 0; i < results.length; i++) {
                const ev = results[i];

                if (type == 'deposits') {
                    events.push({
                        transactionHash: ev.transactionHash,
                        blockNumber: ev.blockNumber,
                        commitment: ev.args?.commitment,
                        leafIndex: ev.args?.leafIndex,
                        timestamp: ev.args?.timestamp.toString(),
                    } as Deposit);
                } else {
                    events.push({
                        transactionHash: ev.transactionHash,
                        blockNumber: ev.blockNumber,
                        to: ev.args?.to,
                        nullifierHex: ev.args?.nullifierHash,
                        fee: ev.args?.fee,
                    } as Withdrawal);
                }
            }
        } finally {
            log.debug(
                `${events.length} events fetched of this combination: ${{
                    type,
                    chainId,
                    currency,
                    amount,
                }}`
            );
        }
        return events as T extends 'deposits' ? Deposit[] : Withdrawal[];
    }

    private async _getPaginated(
        type: 'deposits' | 'withdrawals',
        chain_id: number,
        currency: string,
        amount: string,
        from: number,
        retry = 0
    ): Promise<unknown[]> {
        const results = [];

        const url = `${this._endpoint}/${type}`;

        const response = await axios.get(url, {
            params: {
                chain_id,
                currency,
                amount,
                from,
            },
        });

        if (response.status != 200) {
            if (retry < MAX_HTTP_RETRIES) {
                log.debug(
                    `Communication error, retrying: ${JSON.stringify(
                        response.data
                    )} ${JSON.stringify(response.status)}`
                );

                retry = retry + 1;
                await delay(RETRIES_DELAY * retry);

                return this._getPaginated(
                    type,
                    chain_id,
                    currency,
                    amount,
                    from,
                    retry
                );
            } else {
                throw new Error(
                    `Error fetching ${url}. ${JSON.stringify(
                        response.data
                    )} ${JSON.stringify(response.status)}`
                );
            }
        }

        if (type in response.data) {
            if (response.data[type].length) {
                results.push(...response.data[type]);
            }
        }

        if ('last' in response.data) {
            results.push(
                ...(await this._getPaginated(
                    type,
                    chain_id,
                    currency,
                    amount,
                    parseInt(response.data['last'])
                ))
            );
        }

        return results;
    }

    private _fetchEventsFromChain = async (
        type: TornadoEvents,
        fromBlock: number,
        contract: Contract,
        toBlock: number | 'latest' = 'latest'
    ): Promise<Event[]> => {
        const filter = contract.filters[type]();
        const blockNumber = this._blockUpdatesController.getBlockNumber();
        let _toBlock = 0;

        if (toBlock === 'latest') {
            _toBlock = blockNumber;
        } else {
            _toBlock = toBlock;
        }

        const getLogsPaginated = async (
            fromBlock: number,
            toBlock: number,
            obtainedEvents: Event[] = []
        ): Promise<Event[]> => {
            try {
                const events = await contract.queryFilter(
                    filter,
                    fromBlock,
                    toBlock
                );
                if (toBlock < blockNumber) {
                    return getLogsPaginated(toBlock + 1, blockNumber, [
                        ...obtainedEvents,
                        ...events,
                    ]);
                } else {
                    return [...obtainedEvents, ...events];
                }
            } catch (error) {
                if (error.body) {
                    // More than 10k results
                    const toNextBlock =
                        fromBlock + Math.floor((toBlock - fromBlock) / 2);
                    return getLogsPaginated(
                        fromBlock,
                        toNextBlock,
                        obtainedEvents
                    );
                }
                throw new Error('Unable to fetch the events');
            }
        };

        return getLogsPaginated(fromBlock, _toBlock);
    };

    private _parseEndpoint(rawEndpoint: string, version: string): string {
        if (!rawEndpoint.endsWith('/')) {
            rawEndpoint = rawEndpoint.concat('/');
        }
        return `${rawEndpoint}${version}`;
    }
}

const delay = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};
