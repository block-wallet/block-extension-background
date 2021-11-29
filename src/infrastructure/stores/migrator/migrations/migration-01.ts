import { BlankAppState } from '@blank/background/utils/constants/initialState';
import { INITIAL_NETWORKS } from '../../../../utils/constants/networks';
import { IMigration } from '../IMigration';

export default {
    migrate: async (persistedState: BlankAppState) => {
        return {
            ...persistedState,
            PreferencesController: {
                ...persistedState.PreferencesController,
                showTestNetworks: true,
                availableNetworks: INITIAL_NETWORKS,
            },
        };
    },
    // Migration version must match new bumped package.json version
    version: '0.1.5',
} as IMigration;
