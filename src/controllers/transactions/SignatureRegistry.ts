import { Contract } from '@ethersproject/contracts';
import axios from 'axios';
import log from 'loglevel';
import NetworkController from '../NetworkController';

const abi = [
    {
        constant: false,
        inputs: [{ name: '_new', type: 'address' }],
        name: 'setOwner',
        outputs: [],
        payable: false,
        type: 'function',
    },
    {
        constant: true,
        inputs: [],
        name: 'totalSignatures',
        outputs: [{ name: '', type: 'uint256' }],
        payable: false,
        type: 'function',
    },
    {
        constant: true,
        inputs: [],
        name: 'owner',
        outputs: [{ name: '', type: 'address' }],
        payable: false,
        type: 'function',
    },
    {
        constant: false,
        inputs: [],
        name: 'drain',
        outputs: [],
        payable: false,
        type: 'function',
    },
    {
        constant: true,
        inputs: [{ name: '', type: 'bytes4' }],
        name: 'entries',
        outputs: [{ name: '', type: 'string' }],
        payable: false,
        type: 'function',
    },
    {
        constant: false,
        inputs: [{ name: '_method', type: 'string' }],
        name: 'register',
        outputs: [{ name: '', type: 'bool' }],
        payable: false,
        type: 'function',
    },
    { inputs: [], type: 'constructor' },
    {
        anonymous: false,
        inputs: [
            { indexed: true, name: 'creator', type: 'address' },
            { indexed: true, name: 'signature', type: 'bytes4' },
            { indexed: false, name: 'method', type: 'string' },
        ],
        name: 'Registered',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            { indexed: true, name: 'old', type: 'address' },
            { indexed: true, name: 'current', type: 'address' },
        ],
        name: 'NewOwner',
        type: 'event',
    },
];

const address = '0x44691B39d1a75dC4E0A0346CBB15E310e6ED1E86';

export type ContractMethodSignature = {
    name: string;
    args: {
        type: string;
    }[];
};

type FourByteResponse = {
    count: number;
    results: {
        id: number;
        text_signature: string;
        bytes_signature: string;
        hex_signature: string;
    }[];
};

/**
 * Class to fetch method signature names from the Signature Registry contract
 */
export class SignatureRegistry {
    private signatureRegistry: Contract;

    constructor(private readonly _networkController: NetworkController) {
        this.signatureRegistry = new Contract(
            address,
            abi,
            _networkController.getProviderFromName('mainnet')
        );
    }

    /**
     * lookup
     *
     * @param bytes The `0x`-prefixed hexadecimal string representing the four-byte signature of the contract method to lookup.
     * @returns The contract method signature
     */
    public async lookup(bytes: string): Promise<string | undefined> {
        const getSignatureInContract = async () => {
            try {
                // If there's no result check on the on chain contract
                const onchainResult: string[] =
                    await this.signatureRegistry.entries(bytes);

                return onchainResult[0];
            } catch (error) {
                log.warn(
                    'Error looking up for contract method signature: ',
                    error.message || error
                );
                return undefined;
            }
        };

        const getSignatureIn4Byte = async () => {
            let fourByteResponse: FourByteResponse | undefined = undefined;
            try {
                fourByteResponse = (
                    await axios.get<FourByteResponse>(
                        `https://www.4byte.directory/api/v1/signatures/?hex_signature=${bytes}`
                    )
                ).data;
            } catch (error) {
                log.warn(
                    'Error looking up in 4byte, fallbacking to contract signature',
                    error.message || error
                );
            }
            return fourByteResponse && fourByteResponse.count > 0
                ? fourByteResponse.results[0].text_signature
                : getSignatureInContract();
        };

        return getSignatureIn4Byte();
    }

    /**
     * parse
     *
     * @param signature The fetched method signature
     * @returns A parsed object with the name and the arguments of the contract method
     */
    public parse(signature: string): ContractMethodSignature | undefined {
        const rawName = signature.match(/^([^)(]*)\((.*)\)([^)(]*)$/u);
        let parsedName;

        if (rawName) {
            if (rawName[1].length > 1) {
                parsedName =
                    rawName[1].charAt(0).toUpperCase() + rawName[1].slice(1);
                parsedName = parsedName
                    .replace(/_/g, ' ')
                    .split(/([A-Z][a-z]+)/)
                    .filter(function (e) {
                        return e;
                    })
                    .join(' ');
            } else {
                parsedName = rawName[1];
            }
        } else {
            parsedName = '';
        }

        if (rawName) {
            const match = signature.match(
                new RegExp(`${rawName[1]}\\(+([a-z1-9,()\\[\\]]+)\\)`, 'u')
            );
            let matches;
            let args: { type: string }[] = [];
            if (match) {
                matches = match[1].match(/[A-z1-9]+/gu);
                if (matches) {
                    args = matches.map((arg) => {
                        return { type: arg };
                    });
                }
            }
            return {
                name: parsedName,
                args,
            };
        }

        return undefined;
    }
}
