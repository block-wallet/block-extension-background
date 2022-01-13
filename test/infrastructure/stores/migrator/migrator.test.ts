import sinon from 'sinon';
import { BigNumber } from 'ethers';
import { BlankAppState } from '../../../../src/utils/constants/initialState';
import { migrator } from '../../../../src/infrastructure/stores/migrator/migrator';
import { DeepPartial } from '../../../../src/utils/types/helpers';
import * as migrations from '../../../../src/infrastructure/stores/migrator/migrations';
import { IMigration } from '@blank/background/infrastructure/stores/migrator/IMigration';
import { expect } from 'chai';

describe('State Migrator', () => {
    const persistedState: DeepPartial<BlankAppState> = {
        AccountTrackerController: {
            isAccountTrackerLoading: false,
            accounts: {
                '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb': {
                    address: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
                    balances: {},
                    name: 'Account1',
                },

                '0xd7d4e99b3e796a528590f5f6b84c2b2f967e7ccb': {
                    address: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
                    balances: {},
                    name: 'Account2',
                },
            },
        },
        AppStateController: {},
        BlankDepositController: {
            pendingWithdrawals: {
                goerli: { pending: [] },
                mainnet: { pending: [] },
            },
            vaultState: {
                vault: 'encrypted-deposits-vault',
            },
        },
        ExchangeRatesController: { exchangeRates: { ETH: 2786.23, USDT: 1 } },
        GasPricesController: {
            gasPriceData: {
                5: {
                    gasPricesLevels: {
                        average: { gasPrice: BigNumber.from('2000000000') },
                        fast: { gasPrice: BigNumber.from('2000000000') },
                        slow: { gasPrice: BigNumber.from('2000000000') },
                    },
                },
            },
        },
        IncomingTransactionController: {
            incomingTransactions: {
                '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb': {} as any,
                '0xd7d4e99b3e796a528590f5f6b84c2b2f967e7ccb': {} as any,
            },
        },
        KeyringController: {
            isUnlocked: false,
            keyringTypes: {},
            keyrings: [],
            vault: 'encrypted-vault',
        },
        OnboardingController: {
            isOnboarded: true,
            isSeedPhraseBackedUp: false,
        },
        PreferencesController: {
            localeInfo: 'en-GB',
            nativeCurrency: 'GBP',
            selectedAddress: '0x72fd102eb412de8415ca9a89c0c2a5bd2ecfbdfb',
        },
        TransactionController: { transactions: [] },
        TokenController: {
            userTokens: {} as any,
            deletedUserTokens: {} as any,
        },
    };

    const mockedMigrations: IMigration[] = [
        {
            migrate: async (persistedState) => {
                return persistedState as BlankAppState;
            },
            version: '0.0.9',
        },
        {
            migrate: async (persistedState: BlankAppState) => {
                const { accounts } = persistedState.AccountTrackerController;
                const updatedAccounts = {} as typeof accounts;
                for (const [address, values] of Object.entries(accounts)) {
                    updatedAccounts[address] = {
                        ...values,
                        balances: {},
                    };
                }

                return {
                    ...persistedState,
                    AccountTrackerController: {
                        isAccountTrackerLoading: false,
                        accounts: updatedAccounts,
                    },
                };
            },
            version: '0.2.0',
        },
    ];

    it('Should run the mocked migrations correctly', async () => {
        const version = '0.1.0';

        sinon.stub(migrations, 'default').returns(mockedMigrations);
        const newState = await migrator(version, persistedState);

        const originalAccounts = Object.values(
            persistedState.AccountTrackerController!.accounts!
        );

        Object.values(newState.AccountTrackerController.accounts).forEach(
            (account, i) => {
                expect(account).to.have.property('balances').that.is.empty;

                expect(account)
                    .to.have.property('address')
                    .that.is.equal(originalAccounts[i]!.address);

                expect(account)
                    .to.have.property('name')
                    .that.is.equal(originalAccounts[i]!.name);

                expect(account)
                    .to.have.property('balances')
                    .that.is.deep.equal(originalAccounts[i]!.balances);
            }
        );

        expect(newState).to.be.deep.equal({
            ...(persistedState as BlankAppState),
            AccountTrackerController: newState.AccountTrackerController,
        });

        sinon.restore();
    });
});

// Check tests
// Checl tornado
