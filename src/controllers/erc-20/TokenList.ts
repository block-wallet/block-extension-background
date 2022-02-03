/* eslint-disable @typescript-eslint/no-var-requires */
import { INetworkTokens, IToken } from './Token';
import tl from '../../../token-list.json';

export const BLANK_TOKEN_ADDRESSES: { [chainId in number]: string } = {
    1: '0x41A3Dba3D677E573636BA691a70ff2D606c29666',
    137: '0xf4c83080e80ae530d6f8180572cbbf1ac9d5d435',
};
export const BLANK_TOKEN_NAME = 'Block';

const tokenList: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key in string]: { [key in string]: { [key in string]: any } };
} = tl;

const NETWORK_TOKENS_LIST: INetworkTokens = {
    42161: {}, // arbitrum
    43114: {}, // avalanchec
    820: {}, // callisto
    42220: {}, // celo
    61: {}, // classic
    64: {}, // ellaism
    59: {}, // eos
    1313114: {}, // 'ether-1'
    1: {}, // ethereu
    250: {}, // fantom:
    60: {}, // gochain
    1666600000: {}, // harmony
    128: {}, // heco
    4689: {}, // iotex
    71393: {}, // nervos
    58: {}, // ontology
    10: {}, // optimism
    69: {}, // optimism kovan
    420: {}, // optimism goerli
    77: {}, // poa
    137: {
        '0xf4C83080E80AE530d6f8180572cBbf1Ac9D5d435': {
            name: 'Block Token',
            symbol: 'BLANK',
            type: 'ERC20',
            address: '0xf4C83080E80AE530d6f8180572cBbf1Ac9D5d435',
            decimals: 18,
            logo: chrome.runtime.getURL('icons/icon-48.png'),
        },
    }, // polygon
    80001: {}, // polygon testnet mumbai
    10000: {}, // smartbch
    56: {}, // smartchain
    361: {}, // theta
    108: {}, // thundertoken
    88: {}, // tomochain
    888: {}, // wanchain
    100: {}, // xdai
    50: {}, // xdc
    // Added Tornado supported tokens to Goerli
    5: {
        '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60': {
            name: 'Dai Stablecoin',
            symbol: 'DAI',
            type: 'ERC20',
            address: '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60',
            decimals: 18,
            logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
        },
        '0x822397d9a55d0fefd20F5c4bCaB33C5F65bd28Eb': {
            decimals: 8,
            symbol: 'CDAI',
            name: 'Compound Dai',
            address: '0x822397d9a55d0fefd20F5c4bCaB33C5F65bd28Eb',
            logo: 'https://raw.githubusercontent.com/MetaMask/contract-metadata/master/images/ctoken-dai.svg',
            type: 'ERC20',
        },
        '0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C': {
            decimals: 6,
            symbol: 'USDC',
            name: 'USDC',
            address: '0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C',
            logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
            type: 'ERC20',
        },
        '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66': {
            decimals: 6,
            symbol: 'USDT',
            name: 'Tether USD',
            address: '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66',
            logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
            type: 'ERC20',
        },
        '0xC04B0d3107736C32e19F1c62b2aF67BE61d63a05': {
            decimals: 8,
            symbol: 'WBTC',
            name: 'Wrapped BTC',
            address: '0xC04B0d3107736C32e19F1c62b2aF67BE61d63a05',
            logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
            type: 'ERC20',
        },
    }, // goerli
    3: {}, // ropsten
    42: {}, // kovan
    4: {}, // rinkeby
    97: {}, // bsc testnet
    1337: {}, // localhost
};

export const NETWORK_TOKENS_LIST_ARRAY: { [chainId in number]: string[] } = {};

for (const chainId in tokenList) {
    if (!(parseInt(chainId) in NETWORK_TOKENS_LIST)) {
        NETWORK_TOKENS_LIST[parseInt(chainId)] = {};
    }
    for (const address in tokenList[chainId]) {
        const token = tokenList[chainId][address];

        // Replace the blank token icon for the local file.
        if (parseInt(chainId) in BLANK_TOKEN_ADDRESSES) {
            if (address === BLANK_TOKEN_ADDRESSES[parseInt(chainId)]) {
                token['logo'] = chrome.runtime.getURL('icons/icon-48.png');
            }
        }

        const iToken = {
            address,
            name: token['name'],
            logo: token['logo'],
            type: token['type'],
            symbol: token['symbol'],
            decimals: token['decimals'],
        } as IToken;

        if ('l1Bridge' in token) {
            iToken.l1Bridge = {
                tokenAddress: token['l1Bridge']['tokenAddress'],
                bridgeAddress: token['l1Bridge']['bridgeAddress'],
            };
        }

        NETWORK_TOKENS_LIST[parseInt(chainId)][address] = iToken;
    }
}

for (const chainId in NETWORK_TOKENS_LIST) {
    NETWORK_TOKENS_LIST_ARRAY[parseInt(chainId)] = Object.keys(
        NETWORK_TOKENS_LIST[parseInt(chainId)]
    );
}

export default NETWORK_TOKENS_LIST;
