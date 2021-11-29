/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    focusWindow,
    getLastFocusedWindow,
    openWindow,
    switchToTab,
    getPlatformInfo,
    updateWindow,
} from './window';
import { extensionInstances } from '../infrastructure/connection';
import { PlatformOS } from './types/platform';

const windowSize: { [os in PlatformOS]: { height: number; width: number } } = {
    win: { height: 639, width: 373 },
    mac: { height: 630, width: 358 },
    linux: { height: 600, width: 357 },
    android: { height: 600, width: 357 },
    cros: { height: 600, width: 357 },
    openbsd: { height: 600, width: 357 },
};

let uiIsTriggering = false;
let left: number;
let top: number;

/**
 * Opens the extension in a window
 *
 */
export const openPopup = async (): Promise<void> => {
    // Check if the extension is open in a window
    const openTab = getOpenTab();

    if (openTab) {
        // Focus window
        focusWindow(openTab.windowId);
        // Switch to tab
        switchToTab(openTab.tabId);
    } else if (!uiIsTriggering) {
        uiIsTriggering = true;
        try {
            await openExtensionWindow();
        } finally {
            uiIsTriggering = false;
        }
    }
};

/**
 * Opens an extension instance in a new window
 *
 */
const openExtensionWindow = async () => {
    left = 0;
    top = 0;

    const os = (await getPlatformInfo()).os as PlatformOS;

    const width = windowSize[os].width;
    const height = windowSize[os].height;

    try {
        const lastFocused = await getLastFocusedWindow();
        // Position window in top right corner of lastFocused window.
        top = lastFocused.top!;
        left = lastFocused.left! + (lastFocused.width! - width);
    } catch (error) {
        // The following properties will likely have irrelevant values.
        // They are requested from the background generated page that
        // has no physical dimensions.
        const { screenX, screenY, outerWidth } = window;
        top = Math.max(screenY, 0);
        left = Math.max(screenX + (outerWidth - width), 0);
    }

    // Create new notification popup
    const newWindow = await openWindow({
        url: 'popup.html',
        type: 'popup',
        state: 'normal',
        width,
        height,
        left,
        top,
    });

    // Prevent popup going fullscreen on macOS
    if (newWindow?.state === 'fullscreen' && newWindow.id) {
        updateWindow(newWindow.id, {
            state: 'normal',
            width,
            height,
            left,
            top,
        });
    }
};

/**
 * Returns the tab id and window id of the open extension window
 * or null if it's an onboarding tab or there isn't one.
 *
 */
const getOpenTab = (): { tabId: number; windowId: number } | null => {
    for (const instance in extensionInstances) {
        const tab = extensionInstances[instance].port.sender?.tab;
        const isOnboardingTab =
            extensionInstances[instance].port.sender?.url?.includes('tab.html');

        if (tab && tab.id && tab.windowId && !isOnboardingTab) {
            return {
                tabId: tab.id,
                windowId: tab.windowId,
            };
        }
    }

    return null;
};
