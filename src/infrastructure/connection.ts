/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    BackgroundActions,
    ExtensionInstances,
    Messages,
    Origin,
    ProviderInstances,
    TransportResponseMessage,
} from '../utils/types/communication';
import { v4 as uuid } from 'uuid';
import BlankController from '../controllers/BlankController';
import log from 'loglevel';

export const extensionInstances: ExtensionInstances = {};
export const providerInstances: ProviderInstances = {};

/**
 * New connection setup function
 *
 * @param port new connected port
 * @param blankController blank controller running instance
 */
export const setupConnection = (
    port: chrome.runtime.Port,
    blankController: BlankController
): void => {
    // Port id
    const id = uuid();

    // New message listener
    const messageListener = (message: any, port: chrome.runtime.Port) => {
        blankController.handler(message, port, id);
    };

    port.onMessage.addListener(messageListener);

    // Handle new connection
    if (port.name === Origin.EXTENSION) {
        log.debug('New instance URL', port.sender?.url);
        // Close any other open instance
        for (const instance in extensionInstances) {
            // Ignore if it is an onboarding tab
            if (
                !extensionInstances[instance].port.sender?.url?.includes(
                    'tab.html'
                )
            ) {
                extensionInstances[instance].port.postMessage({
                    id: BackgroundActions.CLOSE_WINDOW,
                } as TransportResponseMessage<typeof Messages.BACKGROUND.ACTION>);
            }
        }

        extensionInstances[id] = { port };

        log.debug('Extension instance connected', id);
    } else {
        const tabId = port.sender?.tab?.id;

        if (port.name === Origin.PROVIDER) {
            if (!tabId || !port.sender?.url) {
                throw new Error('Error initializing provider');
            }

            const url = new URL(port.sender.url);

            providerInstances[id] = {
                port,
                tabId,
                origin: url.origin,
                siteMetadata: {
                    iconURL: null,
                    name: url.hostname,
                },
            };

            log.debug(url.origin, 'connected', id);
        }
    }

    port.onDisconnect.addListener((port: chrome.runtime.Port) => {
        // Check for error
        const error = chrome.runtime.lastError;

        if (error) {
            log.error('Error on port disconnection', error.message || error);
        }

        // Remove message listener
        port.onMessage.removeListener(messageListener);

        // Remove from open instances
        if (port.name === Origin.EXTENSION) {
            delete extensionInstances[id];
            log.debug('Extension instance disconnected', id);
        } else {
            if (port.name === Origin.PROVIDER) {
                delete providerInstances[id];
                log.debug('Site disconnected', id);
            }
        }
    });
};
