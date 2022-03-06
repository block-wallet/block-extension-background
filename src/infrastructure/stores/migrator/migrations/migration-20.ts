import { BlankAppState } from '@blank/background/utils/constants/initialState';
import { ACTIONS_TIME_INTERVALS_DEFAULT_VALUES } from '../../../../utils/constants/networks';
import { MINUTE, SECOND } from '../../../../utils/constants/time';
import { IMigration } from '../IMigration';
/**
 * This migration updates some actions intervals for mainnet
 */
export default {
    migrate: async (persistedState: BlankAppState) => {
        const { availableNetworks } = persistedState.NetworkController;
        const updatedNetworks = { ...availableNetworks };

        updatedNetworks.MAINNET = {
            ...updatedNetworks.MAINNET,
            actionsTimeIntervals: {
                ...ACTIONS_TIME_INTERVALS_DEFAULT_VALUES,
                balanceFetch: 30 * SECOND,
                assetsAutoDiscovery: 2 * MINUTE,
            },
        };

        return {
            ...persistedState,
            NetworkController: {
                ...persistedState.NetworkController,
                availableNetworks: { ...updatedNetworks },
            },
        };
    },
    version: '0.1.27',
} as IMigration;
