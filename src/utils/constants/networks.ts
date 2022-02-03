import { BigNumber } from '@ethersproject/bignumber';
import { BlankSupportedFeatures, FEATURES } from './features';
import { FeeData } from '@ethersproject/abstract-provider';

export type Network = {
    name: string;
    desc: string;
    chainId: number;
    networkVersion: string;
    nativeCurrency: {
        name: string;
        symbol: string;
        decimals: number;
    };
    isCustomNetwork?: boolean;
    iconUrls?: string[];
    enable: boolean;
    features: BlankSupportedFeatures[];
    test: boolean;
    order: number;
    ens: boolean;
    showGasLevels: boolean;
    gasLowerCap?: FeeData;
    rpcUrls: string[];
    blockExplorerUrls?: string[];
    etherscanApiUrl?: string;
    assetsAutoDiscoveryInterval?: number;
};

// TODO: Replace networks object to store them by chainId instead of by name
export type Networks = {
    [key: string]: Network;
};

export const INITIAL_NETWORKS: Networks = {
    MAINNET: {
        name: 'mainnet',
        desc: 'Ethereum Mainnet',
        chainId: 1,
        networkVersion: '1',
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: false,
        enable: true,
        test: false,
        order: 1,
        features: [FEATURES.SENDS, FEATURES.SWAPS, FEATURES.TORNADO],
        ens: true,
        showGasLevels: true,
        rpcUrls: [`https://mainnet-node.blockwallet.io`],
        blockExplorerUrls: ['https://etherscan.io'],
        etherscanApiUrl: 'https://api.etherscan.io',
        assetsAutoDiscoveryInterval: 20,
    },
    ARBITRUM: {
        name: 'arbitrum',
        desc: 'Abitrum Mainnet',
        chainId: 42161,
        networkVersion: '42161',
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: true,
        enable: true,
        test: false,
        order: 2,
        features: [FEATURES.SENDS, FEATURES.SWAPS],
        ens: false,
        showGasLevels: false,
        rpcUrls: ['https://arb1.arbitrum.io/rpc'],
        blockExplorerUrls: ['https://arbiscan.io'],
        etherscanApiUrl: 'https://api.arbiscan.io',
        assetsAutoDiscoveryInterval: 30,
    },
    OPTIMISM: {
        name: 'optimism',
        desc: 'Optimism Mainnet',
        chainId: 10,
        networkVersion: '10',
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: true,
        enable: false,
        test: false,
        order: 3,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: false,
        rpcUrls: ['https://mainnet.optimism.io'],
        blockExplorerUrls: ['https://optimistic.etherscan.io'],
        etherscanApiUrl: 'https://api-optimistic.etherscan.io',
        assetsAutoDiscoveryInterval: 30,
    },
    BSC: {
        name: 'bsc',
        desc: 'BSC Mainnet',
        chainId: 56,
        networkVersion: '56',
        nativeCurrency: {
            name: 'Binance Chain Native Token',
            symbol: 'BNB',
            decimals: 18,
        },
        isCustomNetwork: false,
        iconUrls: [
            'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
        ],
        enable: true,
        test: false,
        order: 4,
        features: [FEATURES.SENDS, FEATURES.SWAPS],
        ens: false,
        showGasLevels: true,
        rpcUrls: ['https://bsc-dataseed1.binance.org:443'],
        blockExplorerUrls: ['https://bscscan.com'],
        etherscanApiUrl: 'https://api.bscscan.com',
        assetsAutoDiscoveryInterval: 45,
    },
    POLYGON: {
        name: 'polygon',
        desc: 'Polygon Mainnet',
        chainId: 137,
        networkVersion: '137',
        nativeCurrency: {
            name: 'Matic',
            symbol: 'MATIC',
            decimals: 18,
        },
        iconUrls: [
            'https://polygon.technology/wp-content/uploads/2021/05/matic-token-icon.svg',
        ],
        isCustomNetwork: false,
        gasLowerCap: {
            gasPrice: null,
            maxFeePerGas: null,
            maxPriorityFeePerGas: null,
        },
        enable: true,
        test: false,
        order: 5,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: true,
        rpcUrls: [`https://polygon-node.blockwallet.io`],
        blockExplorerUrls: ['https://polygonscan.com'],
        etherscanApiUrl: 'https://api.polygonscan.com',
        assetsAutoDiscoveryInterval: 75,
    },
    AVALANCHEC: {
        name: 'avalanchec',
        desc: 'Avalanche Network',
        chainId: 43114,
        networkVersion: '43114',
        nativeCurrency: {
            name: 'AVAX',
            symbol: 'AVAX',
            decimals: 18,
        },
        iconUrls: [
            'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png',
        ],
        isCustomNetwork: false,
        gasLowerCap: {
            gasPrice: null,
            maxFeePerGas: BigNumber.from('0x5d21dba00'), // 25 GWEI,
            maxPriorityFeePerGas: null,
        },
        enable: true,
        test: false,
        order: 6,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: true,
        rpcUrls: [`https://avax-node.blockwallet.io`],
        blockExplorerUrls: ['https://snowtrace.io/'],
        etherscanApiUrl: 'https://api.snowtrace.io/',
    },
    FANTOM: {
        name: 'fantom',
        desc: 'Fantom Opera',
        chainId: 250,
        networkVersion: '250',
        nativeCurrency: {
            name: 'Fantom',
            symbol: 'FTM',
            decimals: 18,
        },
        iconUrls: [
            'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/fantom/info/logo.png',
        ],
        isCustomNetwork: false,
        gasLowerCap: {
            gasPrice: null,
            maxFeePerGas: null,
            maxPriorityFeePerGas: null,
        },
        enable: true,
        test: false,
        order: 7,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: true,
        rpcUrls: [`https://fantom-node.blockwallet.io`],
        blockExplorerUrls: ['https://ftmscan.com'],
        etherscanApiUrl: 'https://api.ftmscan.com',
    },
    GOERLI: {
        name: 'goerli',
        desc: 'Goerli Testnet',
        chainId: 5,
        networkVersion: '5',
        nativeCurrency: {
            name: 'Görli Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: false,
        enable: true,
        test: true,
        order: 8,
        features: [FEATURES.SENDS, FEATURES.TORNADO],
        ens: true,
        showGasLevels: true,
        rpcUrls: [`https://goerli-node.blockwallet.io`],
        blockExplorerUrls: ['https://goerli.etherscan.io'],
        etherscanApiUrl: 'https://api-goerli.etherscan.io',
        assetsAutoDiscoveryInterval: 30,
    },
    ROPSTEN: {
        name: 'ropsten',
        desc: 'Ropsten Testnet',
        chainId: 3,
        networkVersion: '3',
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: false,
        enable: true,
        test: true,
        order: 9,
        features: [FEATURES.SENDS],
        ens: true,
        showGasLevels: true,
        rpcUrls: [`https://ropsten-node.blockwallet.io`],
        blockExplorerUrls: ['https://ropsten.etherscan.io'],
        etherscanApiUrl: 'https://api-ropsten.etherscan.io',
        assetsAutoDiscoveryInterval: 30,
    },
    KOVAN: {
        name: 'kovan',
        desc: 'Kovan Testnet',
        chainId: 42,
        networkVersion: '42',
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: false,
        enable: true,
        test: true,
        order: 10,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: true,
        rpcUrls: [`https://kovan-node.blockwallet.io`],
        blockExplorerUrls: ['https://kovan.etherscan.io'],
        etherscanApiUrl: 'https://api-kovan.etherscan.io',
        assetsAutoDiscoveryInterval: 30,
    },
    RINKEBY: {
        name: 'rinkeby',
        desc: 'Rinkeby Testnet',
        chainId: 4,
        networkVersion: '4',
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: false,
        enable: true,
        test: true,
        order: 11,
        features: [FEATURES.SENDS],
        ens: true,
        showGasLevels: true,
        rpcUrls: [`https://rinkeby-node.blockwallet.io`],
        blockExplorerUrls: ['https://rinkeby.etherscan.io'],
        etherscanApiUrl: 'https://api-rinkeby.etherscan.io',
        assetsAutoDiscoveryInterval: 30,
    },
    BSC_TESTNET: {
        name: 'bsc_testnet',
        desc: 'BSC Testnet',
        chainId: 97,
        networkVersion: '97',
        nativeCurrency: {
            name: 'Binance Chain Native Token',
            symbol: 'BNB',
            decimals: 18,
        },
        isCustomNetwork: false,
        iconUrls: [
            'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
        ],
        enable: true,
        test: true,
        order: 12,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: true,
        rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545/'],
        blockExplorerUrls: ['https://testnet.bscscan.io'],
        assetsAutoDiscoveryInterval: 75,
    },
    POLYGON_TESTNET_MUMBAI: {
        name: 'polygon_testnet_mumbai',
        desc: 'Polygon Mumbai',
        chainId: 80001,
        networkVersion: '80001',
        nativeCurrency: {
            name: 'Matic',
            symbol: 'MATIC',
            decimals: 18,
        },
        iconUrls: [
            'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
        ],
        isCustomNetwork: false,
        gasLowerCap: {
            gasPrice: null,
            maxFeePerGas: null,
            maxPriorityFeePerGas: null,
        },
        enable: true,
        test: true,
        order: 13,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: true,
        rpcUrls: [`https://matic-mumbai.chainstacklabs.com`],
        blockExplorerUrls: ['https://mumbai.polygonscan.com'],
        etherscanApiUrl: 'https://mumbai.polygonscan.com',
        assetsAutoDiscoveryInterval: 75,
    },
    LOCALHOST: {
        name: 'localhost',
        desc: 'Localhost 8545',
        chainId: 1337,
        networkVersion: '1337',
        nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
        },
        isCustomNetwork: true,
        enable: true,
        test: true,
        order: 14,
        features: [FEATURES.SENDS],
        ens: false,
        showGasLevels: false,
        rpcUrls: ['http://localhost:8545'],
        assetsAutoDiscoveryInterval: 1,
    },
};

export const HARDFORKS = {
    BERLIN: 'berlin',
    LONDON: 'london',
};
