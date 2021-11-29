import { expect } from 'chai';
import sinon from 'sinon';

import { BigNumber, ethers } from 'ethers';
import { EventEmitter } from 'events';
import { INITIAL_NETWORKS } from '../../src/utils/constants/networks';
import { AccountTrackerController } from '../../src/controllers/AccountTrackerController';
import NetworkController from '../../src/controllers/NetworkController';
import { mockPreferencesController } from '../mocks/mock-preferences';
import {
    TokenController,
    TokenControllerProps,
} from '../../src/controllers/erc-20/TokenController';
import { PreferencesController } from '../../src/controllers/PreferencesController';
import { TornadoServiceProps } from '../../src/controllers/blank-deposit/tornado/TornadoService';
import { ITokens, Token } from '../../src/controllers/erc-20/Token';
import { TokenOperationsController } from '@blank/background/controllers/erc-20/transactions/Transaction';
import { mockedPermissionsController } from '../mocks/mock-permissions';
import PermissionsController from '@blank/background/controllers/PermissionsController';
import { GasPricesController } from '@blank/background/controllers/GasPricesController';
import initialState from '@blank/background/utils/constants/initialState';
import { TypedTransaction } from '@ethereumjs/tx';
import { getNetworkControllerInstance } from '../mocks/mock-network-instance';
import BlockUpdatesController from '@blank/background/controllers/BlockUpdatesController';
import { ExchangeRatesController } from '@blank/background/controllers/ExchangeRatesController';
import { IncomingTransactionController } from '@blank/background/controllers/IncomingTransactionController';
import TransactionController from '@blank/background/controllers/transactions/TransactionController';
import KeyringControllerDerivated from '@blank/background/controllers/KeyringControllerDerivated';

describe('AccountTracker controller implementation', function () {
    const accounts = {
        goerli: [
            {
                key: '7fe1315d0fa2f408dacddb41deacddec915e85c982e9cbdaacc6eedcb3f9793b',
                address: '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1',
            },
            {
                key: '4b95973deb96905fd605d765f31d1ce651e627d61c136fa2b8eb246a3c549ebe',
                address: '0xbda8C7b7B5d0579Eb18996D1f684A434E4fF701f',
            },
        ],
    };
    let tokenController: TokenController;
    let transactionController: TransactionController;
    let preferencesController: PreferencesController;
    let tornadoServiceProps: TornadoServiceProps;
    let accountTrackerController: AccountTrackerController;
    let networkController: NetworkController;
    let keyringController: KeyringControllerDerivated;
    let tokenOperationsController: TokenOperationsController;
    let permissionsController: PermissionsController;
    let gasPricesController: GasPricesController;
    let blockUpdatesController: BlockUpdatesController;
    let exchangeRatesController: ExchangeRatesController;
    let incomingTransactionController: IncomingTransactionController;

    beforeEach(() => {
        // Instantiate objects
        networkController = getNetworkControllerInstance();
        preferencesController = mockPreferencesController;
        permissionsController = mockedPermissionsController;
        gasPricesController = new GasPricesController(
            initialState.GasPricesController,
            networkController
        );

        transactionController = new TransactionController(
            networkController,
            preferencesController,
            permissionsController,
            gasPricesController,
            {
                transactions: [],
            },
            async (ethTx: TypedTransaction) => {
                const privateKey = Buffer.from(accounts.goerli[0].key, 'hex');
                return Promise.resolve(ethTx.sign(privateKey));
            },
            { txHistoryLimit: 40 }
        );

        tornadoServiceProps = {
            preferencesController,
            transactionController,
            networkController,
        } as TornadoServiceProps;

        tokenOperationsController = new TokenOperationsController({
            networkController: networkController,
        });

        tokenController = new TokenController(
            {
                userTokens: {} as any,
                deletedUserTokens: {} as any,
            },
            {
                networkController,
                preferencesController,
                tokenOperationsController,
            } as TokenControllerProps
        );

        keyringController = new KeyringControllerDerivated({});

        accountTrackerController = new AccountTrackerController(
            keyringController,
            networkController,
            tokenController,
            tokenOperationsController
        );

        exchangeRatesController = new ExchangeRatesController(
            {
                exchangeRates: { ETH: 2786.23, USDT: 1 },
                networkNativeCurrency: {
                    symbol: 'ETH',
                    // Default Coingecko id for ETH rates
                    coingeckoPlatformId: 'ethereum',
                },
            },
            preferencesController,
            networkController,
            () => {
                return {};
            }
        );

        incomingTransactionController = new IncomingTransactionController(
            networkController,
            preferencesController,
            accountTrackerController,
            { incomingTransactions: {} }
        );

        blockUpdatesController = new BlockUpdatesController(
            networkController,
            accountTrackerController,
            gasPricesController,
            exchangeRatesController,
            incomingTransactionController,
            transactionController,
            { blockData: {} }
        );
    });

    it('Should init properly', () => {
        const { accounts } = accountTrackerController.store.getState();
        expect(accounts).to.be.empty;
    });

    describe('AccountTracker balance', () => {
        it('Should add the newly added user tokens with zero balance to the list', () => {
            sinon.stub(TokenController.prototype, 'getUserTokens').returns(
                new Promise<ITokens>((resolve) => {
                    resolve({
                        '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60': new Token(
                            '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60',
                            'Goerli DAI',
                            'DAI',
                            18
                        ),
                        '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66': new Token(
                            '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66',
                            'Goerli USDT',
                            'USDT',
                            18
                        ),
                        '0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C': new Token(
                            '0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C',
                            'Goerli USDC',
                            'USDC',
                            18
                        ),
                    });
                })
            );

            let { accounts } = accountTrackerController.store.getState();

            Object.values(accounts).forEach((a) => {
                expect(a.balances[5]).to.be.empty;
            });

            accountTrackerController.updateAccounts();
            ({ accounts } = accountTrackerController.store.getState());

            Object.values(accounts).forEach((a) => {
                const tokensArray = Object.values(a.balances[5].tokens);
                expect(tokensArray.length).to.be.equal(3);
                expect(a.balances[5].tokens[0].token.address).to.be.equal(
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                );
                expect(a.balances[5].tokens[1].token.address).to.be.equal(
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                );
                expect(a.balances[5].tokens[2].token.address).to.be.equal(
                    '0xD87Ba7A50B2E7E660f678A895E4B72E7CB4CCd9C'
                );

                expect(a.balances[5].tokens[0].balance.toString()).to.be.equal(
                    '0'
                );
                expect(a.balances[5].tokens[1].balance.toString()).to.be.equal(
                    '0'
                );
                expect(a.balances[5].tokens[2].balance.toString()).to.be.equal(
                    '0'
                );
            });
        });

        it('An account without eth balance', async () => {
            const accountAddress = '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd': {
                        address: accountAddress,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },

                        index: 0,
                        external: false,
                        name: 'Account 1',
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress]).to.be.not.null;
            expect(accounts[accountAddress].address).equal(accountAddress);
            expect(
                accounts[accountAddress].balances[5].nativeTokenBalance._hex
            ).equal(BigNumber.from('0x00')._hex);
        });
        it('An account with eth balance', async () => {
            const accountAddress = '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4': {
                        address: accountAddress,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        index: 0,
                        external: false,
                        name: 'Account 1',
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress]).to.be.not.null;
            expect(accounts[accountAddress].address).equal(accountAddress);
            expect(
                accounts[accountAddress].balances[5].nativeTokenBalance._hex
            ).not.equal(BigNumber.from('0x00')._hex);
        }).timeout(10000);
        it('A simple token balance check', async () => {
            const accountAddress = '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1': {
                        address: accountAddress,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress]).to.be.not.null;
            expect(accounts[accountAddress].address).equal(accountAddress);
        }).timeout(10000);
        it('A simple token balance check without balance', async () => {
            const accountAddress = '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4': {
                        address: accountAddress,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress]).to.be.not.null;
            expect(accounts[accountAddress].address).equal(accountAddress);
            expect(accounts[accountAddress].balances[5].tokens).to.be.empty;
        }).timeout(10000);
        it('A simple token balance check with balance', async () => {
            const accountAddress = '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1': {
                        address: accountAddress,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress]).to.be.not.null;
            expect(accounts[accountAddress].address).equal(accountAddress);
            expect(accounts[accountAddress].balances[5].tokens).to.be.not.empty;
            expect(
                accounts[accountAddress].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
        }).timeout(10000);
        it('A simple token balance check without balance but with manually added tokens', async () => {
            sinon.stub(TokenController.prototype, 'getUserTokens').returns(
                new Promise<ITokens>((resolve) => {
                    resolve({
                        '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66': new Token(
                            '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66',
                            'Goerli USDT',
                            'USDT',
                            18
                        ),
                    });
                })
            );
            const accountAddress = '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4': {
                        address: accountAddress,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress]).to.be.not.null;
            expect(accounts[accountAddress].address).equal(accountAddress);
            expect(accounts[accountAddress].balances[5].tokens).to.be.not.empty;
            expect(
                accounts[accountAddress].balances[5].tokens[
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                ]
            ).to.be.not.null;
        }).timeout(10000);
        it('A multiple accounts check without token balance', async () => {
            const accountAddress1 =
                '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4';
            const accountAddress2 =
                '0x0d19882936d1b99701470853cb948583979203d3';
            const accountAddress3 =
                '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4': {
                        address: accountAddress1,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                    '0x0d19882936d1b99701470853cb948583979203d3': {
                        address: accountAddress2,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 2',
                        index: 0,
                        external: false,
                    },
                    '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd': {
                        address: accountAddress3,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 3',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress1]).to.be.not.null;
            expect(accounts[accountAddress1].address).equal(accountAddress1);
            expect(accounts[accountAddress1].balances[5].tokens).to.be.empty;
            expect(accounts[accountAddress2]).to.be.not.null;
            expect(accounts[accountAddress2].address).equal(accountAddress2);
            expect(accounts[accountAddress2].balances[5].tokens).to.be.empty;
            expect(accounts[accountAddress3]).to.be.not.null;
            expect(accounts[accountAddress3].address).equal(accountAddress3);
            expect(accounts[accountAddress3].balances[5].tokens).to.be.empty;
        }).timeout(10000);
        it('A multiple accounts check with balance', async () => {
            const accountAddress1 =
                '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1';
            const accountAddress2 =
                '0x604D5299227E91ee85899dCDbFfe1505bC1E3233';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1': {
                        address: accountAddress1,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                    '0x604D5299227E91ee85899dCDbFfe1505bC1E3233': {
                        address: accountAddress2,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 2',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress1]).to.be.not.null;
            expect(accounts[accountAddress1].address).equal(accountAddress1);
            expect(accounts[accountAddress1].balances[5].tokens).to.be.not
                .empty;
            expect(accounts[accountAddress2]).to.be.not.null;
            expect(accounts[accountAddress2].address).equal(accountAddress2);
            expect(accounts[accountAddress2].balances[5].tokens).to.be.not
                .empty;
        }).timeout(10000);
        it('A multiple accounts check without token balance but with manually added tokens', async () => {
            sinon.stub(TokenController.prototype, 'getUserTokens').returns(
                new Promise<ITokens>((resolve) => {
                    resolve({
                        '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60': new Token(
                            '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60',
                            'Goerli DAI',
                            'DAI',
                            18
                        ),
                        '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66': new Token(
                            '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66',
                            'Goerli USDT',
                            'USDT',
                            18
                        ),
                    });
                })
            );
            const accountAddress1 =
                '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4';
            const accountAddress2 =
                '0x0d19882936d1b99701470853cb948583979203d3';
            const accountAddress3 =
                '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4': {
                        address: accountAddress1,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                    '0x0d19882936d1b99701470853cb948583979203d3': {
                        address: accountAddress2,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        index: 0,
                        external: false,
                        name: 'Account 2',
                    },
                    '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd': {
                        address: accountAddress3,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 3',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress1]).to.be.not.null;
            expect(accounts[accountAddress1].address).equal(accountAddress1);
            expect(accounts[accountAddress1].balances[5].tokens).to.be.not
                .empty;
            expect(
                accounts[accountAddress1].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
            expect(
                accounts[accountAddress1].balances[5].tokens[
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                ]
            ).to.be.not.null;

            expect(accounts[accountAddress2]).to.be.not.null;
            expect(accounts[accountAddress2].address).equal(accountAddress2);
            expect(accounts[accountAddress2].balances[5].tokens).to.be.not
                .empty;
            expect(
                accounts[accountAddress2].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
            expect(
                accounts[accountAddress2].balances[5].tokens[
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                ]
            ).to.be.not.null;

            expect(accounts[accountAddress3]).to.be.not.null;
            expect(accounts[accountAddress3].address).equal(accountAddress3);
            expect(accounts[accountAddress3].balances[5].tokens).to.be.not
                .empty;
            expect(
                accounts[accountAddress3].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
            expect(
                accounts[accountAddress3].balances[5].tokens[
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                ]
            ).to.be.not.null;
        }).timeout(10000);
        it('A multiple accounts check without token balance but with manually added tokens and manually deleted tokens', async () => {
            sinon.stub(TokenController.prototype, 'getUserTokens').returns(
                new Promise<ITokens>((resolve) => {
                    resolve({
                        '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60': new Token(
                            '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60',
                            'Goerli DAI',
                            'DAI',
                            18
                        ),
                    });
                })
            );
            sinon
                .stub(TokenController.prototype, 'getDeletedUserTokens')
                .returns(
                    new Promise<ITokens>((resolve) => {
                        resolve({
                            '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66':
                                new Token(
                                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66',
                                    'Goerli USDT',
                                    'USDT',
                                    18
                                ),
                        });
                    })
                );
            const accountAddress1 =
                '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4';
            const accountAddress2 =
                '0x0d19882936d1b99701470853cb948583979203d3';
            const accountAddress3 =
                '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x25f3f89bc136975c10a1afe9ad70695a4f451ac4': {
                        address: accountAddress1,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                    '0x0d19882936d1b99701470853cb948583979203d3': {
                        address: accountAddress2,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 2',
                        index: 0,
                        external: false,
                    },
                    '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd': {
                        address: accountAddress3,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 3',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress1]).to.be.not.null;
            expect(accounts[accountAddress1].address).equal(accountAddress1);
            expect(accounts[accountAddress1].balances[5].tokens).to.be.not
                .empty;
            expect(
                accounts[accountAddress1].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
            expect(
                accounts[accountAddress1].balances[5].tokens[
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                ]
            ).to.be.undefined;

            expect(accounts[accountAddress2]).to.be.not.null;
            expect(accounts[accountAddress2].address).equal(accountAddress2);
            expect(accounts[accountAddress2].balances[5].tokens).to.be.not
                .empty;
            expect(
                accounts[accountAddress2].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
            expect(
                accounts[accountAddress2].balances[5].tokens[
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                ]
            ).to.be.undefined;

            expect(accounts[accountAddress3]).to.be.not.null;
            expect(accounts[accountAddress3].address).equal(accountAddress3);
            expect(accounts[accountAddress3].balances[5].tokens).to.be.not
                .empty;
            expect(
                accounts[accountAddress3].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
            expect(
                accounts[accountAddress3].balances[5].tokens[
                    '0xb7FC2023D96AEa94Ba0254AA5Aeb93141e4aad66'
                ]
            ).to.be.undefined;
        }).timeout(10000);
        it('A multiple accounts check with balance and without balance', async () => {
            const accountAddress1 =
                '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1';
            const accountAddress2 =
                '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd';
            accountTrackerController.store.updateState({
                accounts: {
                    '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1': {
                        address: accountAddress1,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 1',
                        index: 0,
                        external: false,
                    },
                    '0x3399ee50696cf10dc88d0e11c3fe57f8aa46e0dd': {
                        address: accountAddress2,
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: 'Account 2',
                        index: 0,
                        external: false,
                    },
                },
            });

            await accountTrackerController.updateAccounts();

            const { accounts } = accountTrackerController.store.getState();

            expect(accounts).to.be.not.null;
            expect(accounts[accountAddress1]).to.be.not.null;
            expect(accounts[accountAddress1].address).equal(accountAddress1);
            expect(accounts[accountAddress1].balances[5].tokens).to.be.not
                .empty;
            expect(
                accounts[accountAddress1].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.not.null;
            expect(accounts[accountAddress2]).to.be.not.null;
            expect(accounts[accountAddress2].address).equal(accountAddress2);
            expect(
                accounts[accountAddress2].balances[5].tokens[
                    '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60'
                ]
            ).to.be.undefined;
        });
        afterEach(function () {
            sinon.restore();
        });
    }).timeout(10000);
    describe('AccountTracker methods with mocked etherjs', () => {
        before(async () => {
            // Stub ethers methods
            sinon.stub(ethers, 'Contract').returns({
                balances: (
                    addresses: string[],
                    _ethBalance: string[]
                ): BigNumber[] => addresses.map(() => BigNumber.from('999')),
            } as any);

            // Stub NetworkController methods
            const eventEmitter = new EventEmitter();
            sinon.stub(NetworkController.prototype, 'getProvider').returns({
                ...eventEmitter,
                getBlockNumber: (): Promise<number> =>
                    new Promise((resolve) => resolve(1)),
                getBlock: (_blockNumber: number) =>
                    new Promise((resolve) =>
                        resolve({
                            gasLimit: BigNumber.from('88888'),
                        })
                    ),
            } as any);

            sinon.stub(NetworkController.prototype, 'getNetwork').returns(
                new Promise((resolve) =>
                    resolve({
                        chainId: INITIAL_NETWORKS.KOVAN.chainId,
                    } as any)
                )
            );
        });

        it('Should sync the accounts with the local store', () => {
            accountTrackerController.store.updateState({
                accounts: {
                    '0xff': {
                        address: '0xff',
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from(0),
                                tokens: {},
                            },
                        },
                        name: '',
                        index: 0,
                        external: false,
                    },
                    '0xfa': {
                        address: '0xfa',
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from('1000'),
                                tokens: {},
                            },
                        },
                        name: '',
                        index: 0,
                        external: false,
                    },
                },
            });

            const { accounts } = accountTrackerController.store.getState();

            expect(Object.keys(accounts).length).to.be.equal(2);
            expect(Object.keys(accounts)).to.contain('0xff');
        });

        /*
    it('Should add an account', () => {
      const { accounts } = accountTrackerController.store.getState()

      expect(accounts).to.be.empty
      accountTrackerController.createAccount('test account')
      expect(accounts).to.not.be.empty
      expect(Object.keys(accounts)).to.contain('0xff')
    })
    */

        it('Should remove an account', () => {
            accountTrackerController.store.updateState({
                accounts: {
                    '0xff': {
                        address: '0xff',
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from('1000'),
                                tokens: {},
                            },
                        },
                        name: '',
                        index: 0,
                        external: false,
                    },
                    '0xfa': {
                        address: '0xfa',
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from('1000'),
                                tokens: {},
                            },
                        },
                        name: '',
                        index: 0,
                        external: false,
                    },
                },
            });
            const { accounts } = accountTrackerController.store.getState();
            expect(accounts).to.not.be.empty;

            accountTrackerController.removeAccount('0xff');
            expect(accounts).to.not.be.empty;
            expect(Object.keys(accounts)).to.not.contain('0xff');
        });

        it('Should clear the accounts', () => {
            accountTrackerController.store.updateState({
                accounts: {
                    '0xff': {
                        address: '0xff',
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from('1000'),
                                tokens: {},
                            },
                        },
                        name: '',
                        index: 0,
                        external: false,
                    },
                    '0xfa': {
                        address: '0xfa',
                        balances: {
                            5: {
                                nativeTokenBalance: BigNumber.from('1000'),
                                tokens: {},
                            },
                        },
                        name: '',
                        index: 0,
                        external: false,
                    },
                },
            });
            const { accounts: withAccounts } =
                accountTrackerController.store.getState();
            expect(withAccounts).to.not.be.empty;

            accountTrackerController.clearAccounts();
            const { accounts } = accountTrackerController.store.getState();
            expect(accounts).to.equal(
                initialState.AccountTrackerController.accounts
            );
        });

        /*
    it('Should populate account balances', async () => {
      accountTrackerController.store.updateState({
        accounts: {
          '0xff': {
            address: '0xff',
            balances: {5:{nativeTokenBalance:BigNumber.from(0), tokens:{}}},
            name: '',

          },
          '0xaa': {
            address: '0xaa',
            balances: {5:{nativeTokenBalance:BigNumber.from(0), tokens:{}}},
            name: '',

          },
          '0xbb': {
            address: '0xbb',
            balances: {5:{nativeTokenBalance:BigNumber.from(0), tokens:{}}},
            name: '',

          },
        },
      })

      await accountTrackerController.updateAccounts()

      const { accounts } = accountTrackerController.store.getState()

      assert.deepEqual(accounts, {
        '0xff': {
          address: '0xff',
          balance: BigNumber.from('999'),
          name: '',

        },
        '0xaa': {
          address: '0xaa',
          balance: BigNumber.from('999'),
          name: '',

        },
        '0xbb': {
          address: '0xbb',
          balance: BigNumber.from('999'),
          name: '',

        },
      })
    })
  */

        after(function () {
            sinon.restore();
        });
    });
});
