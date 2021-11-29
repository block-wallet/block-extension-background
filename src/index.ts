/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-var-requires */
import BlankController from './controllers/BlankController';
import BlankStorageStore from './infrastructure/stores/BlankStorageStore';
import initialState, { BlankAppState } from './utils/constants/initialState';
import reconcileState from './infrastructure/stores/migrator/reconcileState';
import compareVersions from 'compare-versions';
import { openExtensionInBrowser } from './utils/window';
import { setupConnection } from './infrastructure/connection';
import { migrator } from './infrastructure/stores/migrator/migrator';
import { DeepPartial } from './utils/types/helpers';
import log, { LogLevelDesc } from 'loglevel';

// Initialize Blank State Store
const blankStateStore = new BlankStorageStore();

/**
 * Load state from persistence
 *
 * @returns persisted state or initial state
 */
const getPersistedState = new Promise<BlankAppState>((resolve) => {
    const getStateAndVersion = async () => {
        const packageVersion = require('../package.json').version;
        let version = await blankStateStore.getVersion();

        // If version is not set (i.e. First install) set the current package.json version
        if (!version) {
            version = packageVersion as string;
            await blankStateStore.setVersion(version);
        }

        // State retrieval callback
        const handleStoredState = async (storedState: BlankAppState) => {
            if (storedState === undefined) {
                resolve(initialState);
            } else {
                // Check if version has changed and reconcile the state
                if (compareVersions(packageVersion, version!)) {
                    let reconciledState = reconcileState(
                        storedState,
                        initialState
                    );

                    // Run migrations
                    reconciledState = await migrator(
                        version!,
                        reconciledState as DeepPartial<BlankAppState>
                    );

                    // Update persisted store version to newly one
                    await blankStateStore.setVersion(packageVersion!);

                    // Persist reconciled state
                    blankStateStore.set('blankState', reconciledState);

                    resolve(reconciledState);
                } else {
                    resolve(storedState);
                }
            }
        };

        // Get persisted state
        blankStateStore.get('blankState', handleStoredState);
    };

    getStateAndVersion();
});

const getDevTools = () => {
    const withDevTools =
        process.env.NODE_ENV === 'development' &&
        typeof window !== 'undefined' &&
        (window as any).devToolsExtension;

    return withDevTools
        ? (window as any).devToolsExtension.connect()
        : undefined;
};

/**
 * Initializes blank wallet
 *
 */
const initBlankWallet = async () => {
    // Get persisted state
    const initState = await getPersistedState;

    // Check if devTools are available
    const devTools = getDevTools();

    // Initialize blank controller
    const blankController = new BlankController({
        initState,
        blankStateStore,
        devTools,
    });

    // Setup connection
    chrome.runtime.onConnect.addListener((port) => {
        setupConnection(port, blankController);
    });

    // Set isBlankInitialized response
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.message === 'isBlankInitialized') {
            sendResponse({ isBlankInitialized: true });
        }
    });

    // Setting the default log level:
    /*
    | 'trace'
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | 'silent'
    */
    log.setLevel((process.env.LOG_LEVEL as LogLevelDesc) || 'error');
};

// Start blank wallet
initBlankWallet().catch((error) => {
    log.error(error.message || error);
});

// On install, open onboarding tab
chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
        openExtensionInBrowser();
    }
});
