import { BlankAppState } from '@blank/background/utils/constants/initialState';
import { IMigration } from '../IMigration';
import { BigNumber } from 'ethers';

/**
 * This migration adds the avalanche c network to the networks
 */
export default {
    migrate: async (persistedState: BlankAppState) => {
        const { availableNetworks } = persistedState.NetworkController;
        const updatedNetworks = { ...availableNetworks };

        updatedNetworks.AVALANCHEC = {
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
            features: ['sends'],
            ens: false,
            showGasLevels: true,
            rpcUrls: [`https://avax-node.blockwallet.io`],
            blockExplorerUrls: ['https://snowtrace.io/'],
            etherscanApiUrl: 'https://api.snowtrace.io/',
        };

        updatedNetworks.GOERLI = {
            ...updatedNetworks.GOERLI,
            order: 7,
        };

        updatedNetworks.ROSPTEN = {
            ...updatedNetworks.ROPSTEN,
            order: 8,
        };

        updatedNetworks.KOVAN = {
            ...updatedNetworks.KOVAN,
            order: 9,
        };

        updatedNetworks.RINKEBY = {
            ...updatedNetworks.RINKEBY,
            order: 10,
        };

        updatedNetworks.BSC_TESTNET = {
            ...updatedNetworks.BSC_TESTNET,
            order: 11,
        };

        updatedNetworks.POLYGON_TESTNET_MUMBAI = {
            ...updatedNetworks.POLYGON_TESTNET_MUMBAI,
            order: 12,
        };

        updatedNetworks.LOCALHOST = {
            ...updatedNetworks.LOCALHOST,
            order: 13,
        };

        return {
            ...persistedState,
            NetworkController: {
                ...persistedState.NetworkController,
                availableNetworks: { ...updatedNetworks },
            },
        };
    },
    version: '0.1.16',
} as IMigration;