import { BlankAppState } from '@blank/background/utils/constants/initialState';
import { IMigration } from '../IMigration';

export default {
    migrate: async (persistedState: BlankAppState) => {
        return {
            ...persistedState,
            PreferencesController: {
                ...persistedState.PreferencesController,
                settings: {
                    hideAddressWarning: false // Shown by default
                }
            },
        };
    },
    // Migration version must match new bumped package.json version
    version: '0.1.6',
} as IMigration;
