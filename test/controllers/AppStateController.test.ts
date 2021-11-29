import AppStateController from '../../src/controllers/AppStateController';
import { mockKeyringController } from '../mocks/mock-keyring-controller';
import { expect } from 'chai';
import MockDepositController from '../mocks/mock-deposit-controller';

describe('AppState Controller', function () {
    let appStateController: AppStateController;
    const defaultIdleTimeout = 5;
    const initialLastActiveTime = new Date().getTime();

    this.beforeAll(function () {
        const depositController = MockDepositController();
        appStateController = new AppStateController(
            {
                idleTimeout: defaultIdleTimeout,
                lastActiveTime: initialLastActiveTime,
            },
            mockKeyringController,
            depositController
        );
    });

    it('should update the last user active time', async function () {
        expect(appStateController.store.getState().lastActiveTime).equal(
            initialLastActiveTime
        );

        appStateController.setLastActiveTime();

        expect(
            appStateController.store.getState().lastActiveTime
        ).to.be.greaterThan(initialLastActiveTime);
    });

    it('should lock and unlock properly', async function () {
        await mockKeyringController.createNewVaultAndKeychain('testPassword');
        await appStateController.lock();
        expect(appStateController.UIStore.getState().isAppUnlocked).to.be.false;

        await appStateController.unlock('testPassword');
        expect(appStateController.UIStore.getState().isAppUnlocked).to.be.true;

        await appStateController.lock();
        expect(appStateController.UIStore.getState().isAppUnlocked).to.be.false;

        await appStateController.unlock('testPassword');
        expect(appStateController.UIStore.getState().isAppUnlocked).to.be.true;
    });

    it('should set a custom auto block timeout', async function () {
        expect(appStateController.store.getState().idleTimeout).equal(
            defaultIdleTimeout
        );

        appStateController.setIdleTimeout(4);

        expect(appStateController.store.getState().idleTimeout).equal(4);
    });

    it('should auto lock the app', function (done) {
        // Set idle timeout to 600 ms
        appStateController.setIdleTimeout(0.01);

        expect(appStateController.UIStore.getState().isAppUnlocked).to.be.true;

        window.setTimeout(function () {
            expect(
                appStateController.UIStore.getState().isAppUnlocked
            ).to.be.false;
            done();
        }, 700);
    });
});
