import { BaseController } from '../infrastructure/BaseController';
import { BlankDepositController } from './blank-deposit/BlankDepositController';
import KeyringControllerDerivated from './KeyringControllerDerivated';

export interface AppStateControllerState {
    idleTimeout: number; // Minutes until auto-lock - Zero if disabled
    lastActiveTime: number;
}

export interface AppStateControllerMemState {
    isAppUnlocked: boolean;
}

export default class AppStateController extends BaseController<
    AppStateControllerState,
    AppStateControllerMemState
> {
    private _timer: ReturnType<typeof setTimeout> | null;
    private isLoadingDeposits = false;

    constructor(
        initState: AppStateControllerState,
        private readonly _keyringController: KeyringControllerDerivated,
        private readonly _blankDepositController: BlankDepositController
    ) {
        super(initState, {
            isAppUnlocked: false,
        });

        this._timer = null;

        this._blankDepositController.UIStore.subscribe(
            ({ isImportingDeposits }) => {
                if (this.isLoadingDeposits && !isImportingDeposits) {
                    this._resetTimer();
                }
                this.isLoadingDeposits = isImportingDeposits;
            }
        );

        this.isLoadingDeposits =
            this._blankDepositController.UIStore.getState().isImportingDeposits;

        this._resetTimer();
    }

    /**
     * Updates last active time
     *
     */
    public setLastActiveTime = (): void => {
        this.store.updateState({ lastActiveTime: new Date().getTime() });

        this._resetTimer();
    };

    /**
     * Set a custom time in minutes for the extension auto block
     * The idle timeout should be greater than zero
     * If zero, then auto-lock is disabled
     *
     * @param idleTimeout the new timeout in minutes.
     */
    public setIdleTimeout = (idleTimeout: number): void => {
        // Throw if timeout is not valid
        if (idleTimeout < 0) {
            throw new Error("Idle timeout can't be a negative number");
        }

        this.store.updateState({ idleTimeout });

        this._resetTimer();
    };

    /**
     * Locks the vault and the app
     */
    public lock = async (): Promise<void> => {
        // Do not lock the app if we're loading the deposits
        if (this.isLoadingDeposits) {
            return;
        }

        try {
            // Lock vault
            await this._keyringController.setLocked();

            // Lock deposits
            await this._blankDepositController.lock();

            // Update controller state
            this.UIStore.updateState({ isAppUnlocked: false });
        } catch (error) {
            throw new Error(error.message || error);
        }
    };

    /**
     * Unlocks the vault and the app
     *
     * @param password user's password
     */
    public unlock = async (password: string): Promise<void> => {
        try {
            // Unlock vault
            await this._keyringController.submitPassword(password);

            // Get seed phrase to unlock the blank deposit controller
            const seedPhrase = await this._keyringController.verifySeedPhrase(
                password
            );

            // Unlock blank deposits vault
            await this._blankDepositController.unlock(password, seedPhrase);

            // Update controller state
            this.UIStore.updateState({
                isAppUnlocked: true,
            });

            this._resetTimer();
        } catch (error) {
            throw new Error(error.message || error);
        }
    };

    /**
     * Resets the idle timer
     *
     */
    private _resetTimer = () => {
        const { idleTimeout } = this.store.getState();

        if (this._timer) {
            clearTimeout(this._timer); // Halt current execution
        }

        if (idleTimeout === 0) {
            this._timer = null; // Disable auto lock
        } else {
            this._timer = setTimeout(
                () => this.lock(),
                idleTimeout * 60 * 1000
            );
        }
    };
}
