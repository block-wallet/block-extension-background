import { isAddress } from '@ethersproject/address';
import { BigNumber, Contract, providers, Signer } from 'ethers';
import BalanceCheckerABI from './abis/BalanceChecker.abi.json';

const SINGLE_CALL_BALANCES_CONTRACTS: {
    [chainId: number]: string;
} = {
    42161: '0x151E24A486D7258dd7C33Fb67E4bB01919B7B32c', // arbitrum
    43114: '', // avalanchec
    820: '', // callisto
    42220: '', // celo
    61: '', // classic
    64: '', // ellaism
    59: '', // eos
    1313114: '', // 'ether-1'
    1: '0xb1f8e55c7f64d203c1400b9d8555d050f94adf39', // ethereum
    250: '', // fantom
    60: '', // gochain
    1666600000: '', // harmony
    128: '', // heco
    4689: '', // iotex
    71393: '', // nervos
    58: '', // ontology
    10: '0xB1c568e9C3E6bdaf755A60c7418C269eb11524FC', // optimism
    69: '0xB1c568e9C3E6bdaf755A60c7418C269eb11524FC', // optimism kovan
    420: '', // optimism goerli
    77: '', // poa
    137: '0x2352c63A83f9Fd126af8676146721Fa00924d7e4', // polygon
    80001: '0x2352c63A83f9Fd126af8676146721Fa00924d7e4', // polygon testnet mumbai
    10000: '', // smartbch
    56: '0x2352c63A83f9Fd126af8676146721Fa00924d7e4', // bsc smartchain
    361: '', // theta
    108: '', // thundertoken
    88: '', // tomochain
    888: '', // wanchain
    100: '', // xdai
    50: '', // xdc
    5: '0x906F63676923374a7B9781BcC1B1532488d45a7a', // goerli
    3: '0x8D9708f3F514206486D7E988533f770a16d074a7', // ropsten
    42: '0x55ABBa8d669D60A10c104CC493ec5ef389EC92bb', // kovan
    4: '0x3183B673f4816C94BeF53958BaF93C671B7F8Cf2', // rinkeby
    97: '0x2352c63A83f9Fd126af8676146721Fa00924d7e4', // bsc testnet
    1337: '', // localhost
};

type Provider = providers.Provider | Signer;

export type BalanceMap = {
    [tokenAddress: string]: BigNumber;
};

export type AddressBalanceMap = {
    [address: string]: BalanceMap;
};

/**
 * It returns the collection of contract address by chainId
 *
 * @returns { [chainId in number]: string}
 */
export const getSingleCallBalancesContracts = (): {
    [chainId in number]: string;
} => {
    return SINGLE_CALL_BALANCES_CONTRACTS;
};

/**
 * Validates if there is a valid contract address for a chainId
 *
 * @param  {number} chainId
 * @returns {boolean}
 */
export const isSingleCallBalancesContractAvailable = (
    chainId: number
): boolean => {
    const contracts = getSingleCallBalancesContracts();
    if (!(chainId in contracts)) {
        return false;
    }
    if (contracts[chainId] === '') {
        return false;
    }
    return isAddress(contracts[chainId]);
};

/**
 * If there is a valid contract address for the chainId this function returns it,
 * otherwise it returns an empty string.
 *
 * @param {number} chainId
 * @returns {string}
 */
export const getSingleCallBalancesContract = (chainId: number): string => {
    if (isSingleCallBalancesContractAvailable(chainId)) {
        return getSingleCallBalancesContracts()[chainId];
    } else {
        return '';
    }
};

/**
 * Returns a instance of Contract resolving the address of it by chainId.
 *
 * @param {provider} provider
 * @param {number} chainId
 * @returns {Contract}
 */
export const getContract = (provider: Provider, chainId: number): Contract => {
    const address = getSingleCallBalancesContract(chainId);
    if (!address) {
        throw new Error(
            `Error fetching balances, contract not found or invalid. chainId: ${chainId}, contract found: "${address}"`
        );
    }
    return new Contract(address, BalanceCheckerABI, provider);
};

/**
 * It parses the result of the balance fetching operation (array) to a dictionary.
 *
 * @param {BigNumber[]} values
 * @param {string[]} addresses
 * @param {string[]} tokens
 * @returns {AddressBalanceMap}
 */
export const formatAddressBalances = (
    values: BigNumber[],
    addresses: string[],
    tokens: string[]
): AddressBalanceMap => {
    const balances: AddressBalanceMap = {};
    addresses.forEach((addr, addrIdx) => {
        balances[addr] = {};
        tokens.forEach((tokenAddr, tokenIdx) => {
            const balance = values[addrIdx * tokens.length + tokenIdx];
            balances[addr][tokenAddr] = balance;
        });
    });
    return balances;
};

/**
 * It fetches the balances of selected addresses.
 *
 * @param {BigNumber[]} values
 * @param {string[]} addresses
 * @param {string[]} tokens
 * @param {number} chainId
 * @returns {Promise<AddressBalanceMap>}
 */
export const getAddressesBalances = async (
    provider: Provider,
    addresses: string[],
    tokens: string[],
    chainId: number
): Promise<AddressBalanceMap> => {
    const contract = getContract(provider, chainId);
    const balances = await contract.balances(addresses, tokens);
    return formatAddressBalances(balances, addresses, tokens);
};

/**
 * It fetches the balances of the selected address.
 *
 * @param {BigNumber[]} values
 * @param {string} address
 * @param {string[]} tokens
 * @param {number} chainId
 * @returns {Promise<BalanceMap>}
 */
export const getAddressBalances = async (
    provider: Provider,
    address: string,
    tokens: string[],
    chainId: number
): Promise<BalanceMap> => {
    return new Promise<BalanceMap>((resolve) => {
        getAddressesBalances(provider, [address], tokens, chainId).then(
            (balances) => resolve(balances[address])
        );
    });
};
