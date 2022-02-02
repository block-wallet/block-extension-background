import { toChecksumAddress } from 'ethereumjs-util';
import { BaseController } from '../infrastructure/BaseController';
export interface UserSettings {
    // Setting that indicates if a warning is shown when receiving a transaction from an address different from the selected one.
    hideAddressWarning: boolean;
}

export type PopupTabs = 'activity' | 'assets';

export interface PreferencesControllerState {
    selectedAddress: string;
    localeInfo: string;
    nativeCurrency: string;
    showTestNetworks: boolean;
    popupTab: PopupTabs;
    settings: UserSettings;
    showWelcomeMessage: boolean;
}

export interface PreferencesControllerProps {
    initState: PreferencesControllerState;
}

export class PreferencesController extends BaseController<PreferencesControllerState> {
    constructor(props: PreferencesControllerProps) {
        super(props.initState);
    }

    /**
     * It returns the user selected address
     *
     */
    public getSelectedAddress(): string {
        return this.store.getState().selectedAddress;
    }

    /**
     * Sets the user selected address
     *
     * @param address One of the user's address
     */
    public setSelectedAddress(address: string): void {
        // Checksum address
        if (address) {
            address = toChecksumAddress(address);
        }
        // Update state
        this.store.updateState({ selectedAddress: address });
    }

    /**
     * Sets the showWelcomeMessage flag
     * @param showWelcomeMessage welcome message flag
     */
    public setShowWelcomeMessage(showWelcomeMessage: boolean): void {
        this.store.updateState({
            showWelcomeMessage,
        });
    }

    /**
     * Gets user selected locale info
     */
    public get localeInfo(): string {
        return this.store.getState().localeInfo;
    }

    /**
     * Sets user selected locale info
     *
     * @param v locale info
     */
    public set localeInfo(v: string) {
        this.store.updateState({ localeInfo: v });
    }

    /**
     * Gets user selected native currency
     */
    public get nativeCurrency(): string {
        return this.store.getState().nativeCurrency;
    }

    /**
     * Sets user selected native currency
     *
     * @param v native currency
     */
    public set nativeCurrency(v: string) {
        this.store.updateState({ nativeCurrency: v });
    }

    /**
     * It returns value indicating if UI should show test networks on list.
     */
    public get showTestNetworks(): boolean {
        return this.store.getState().showTestNetworks;
    }

    /**
     * Sets showTestNetworks value.
     */
    public set showTestNetworks(showTestNetworks: boolean) {
        this.store.updateState({ showTestNetworks: showTestNetworks });
    }

    /**
     * It returns value indicating what tab the popup page should show
     */
    public get popupTab(): PopupTabs {
        return this.store.getState().popupTab;
    }

    /**
     * It returns value indicating what tab the popup page should show
     */
    public set popupTab(popupTab: PopupTabs) {
        this.store.updateState({ popupTab: popupTab });
    }
    /**
     * Gets user settings.
     */
    public get settings(): UserSettings {
        return this.store.getState().settings;
    }

    /**
     * Sets user settings
     *
     * @param s settings
     */
    public set settings(s: UserSettings) {
        this.store.updateState({ settings: s });
    }

    /**
     * Gets showWelcomeMessage value.
     */
    public get showWelcomeMessage() {
        return this.store.getState().showWelcomeMessage;
    }

    /**
     * Sets showWelcomeMessage value.
     */
    public set showWelcomeMessage(showWelcomeMessage: boolean) {
        this.store.updateState({ showWelcomeMessage });
    }
}
