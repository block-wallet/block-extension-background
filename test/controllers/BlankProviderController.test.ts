import AppStateController from '@blank/background/controllers/AppStateController';
import BlankProviderController from '@blank/background/controllers/BlankProviderController';
import KeyringControllerDerivated from '@blank/background/controllers/KeyringControllerDerivated';
import MockDepositController from '../mocks/mock-deposit-controller';
import NetworkController from '../../src/controllers/NetworkController';
import PermissionsController from '@blank/background/controllers/PermissionsController';
import TransactionController from '@blank/background/controllers/transactions/TransactionController';
import initialState from '@blank/background/utils/constants/initialState';
import sinon from 'sinon';
import { AccountTrackerController } from '../../src/controllers/AccountTrackerController';
import { BigNumber, ethers } from 'ethers';
import { GasPricesController } from '@blank/background/controllers/GasPricesController';
import { JSONRPCMethod } from '@blank/background/utils/types/ethereum';
import { PreferencesController } from '@blank/background/controllers/PreferencesController';
import { TokenController } from '../../src/controllers/erc-20/TokenController';
import { TokenOperationsController } from '@blank/background/controllers/erc-20/transactions/Transaction';
import { TypedTransaction } from '@ethereumjs/tx';
import { expect } from 'chai';
import { getNetworkControllerInstance } from '../mocks/mock-network-instance';
import { hexValue } from 'ethers/lib/utils';
import { mockKeyringController } from '../mocks/mock-keyring-controller';
import { mockPreferencesController } from '../mocks/mock-preferences';
import { mockedPermissionsController } from '../mocks/mock-permissions';
import { providerInstances } from '@blank/background/infrastructure/connection';

const UNI_ORIGIN = 'https://app.uniswap.org';
const TX_HASH =
    '0x3979f7ae255171ae6c6fd1c625219b45e2da7e52e6401028c29f0f27581af601';
const TEXT_FOR_HASH = 'HASH ME';

describe('Blank provider controller', function () {
    const defaultIdleTimeout = 5;
    const initialLastActiveTime = new Date().getTime();
    const portId = '7e24f69d-c740-4eb3-9c6e-4d47df491005';
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

    providerInstances[portId] = {
        port: chrome.runtime.connect(),
        tabId: 420,
        origin: UNI_ORIGIN,
        siteMetadata: {
            iconURL: 'https://app.uniswap.org/favicon.png',
            name: 'Uniswap',
        },
    };

    let accountTrackerController: AccountTrackerController;
    let appStateController: AppStateController;
    let blankProviderController: BlankProviderController;
    let gasPricesController: GasPricesController;
    let keyringController: KeyringControllerDerivated;
    let networkController: NetworkController;
    let permissionsController: PermissionsController;
    let preferencesController: PreferencesController;
    let tokenController: TokenController;
    let tokenOperationsController: TokenOperationsController;
    let transactionController: TransactionController;

    beforeEach(function () {
        const depositController = MockDepositController();

        // Instantiate objects
        networkController = getNetworkControllerInstance();

        preferencesController = mockPreferencesController;
        permissionsController = mockedPermissionsController;

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
                preferencesController: preferencesController,
                tokenOperationsController,
            }
        );

        accountTrackerController = new AccountTrackerController(
            mockKeyringController,
            networkController,
            tokenController,
            tokenOperationsController,
            preferencesController
        );

        appStateController = new AppStateController(
            {
                idleTimeout: defaultIdleTimeout,
                lastActiveTime: initialLastActiveTime,
            },
            mockKeyringController,
            depositController
        );

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

        keyringController = new KeyringControllerDerivated({});

        blankProviderController = new BlankProviderController(
            networkController,
            transactionController,
            mockedPermissionsController,
            appStateController,
            keyringController,
            tokenController
        );

        accountTrackerController.addPrimaryAccount(
            ethers.Wallet.createRandom().address
        );
    });

    afterEach(function () {
        sinon.restore();
    });

    it('Should init properly', () => {
        const { dappRequests } = blankProviderController.store.getState();
        expect(dappRequests).to.be.empty;
    });

    describe('Provider requests', () => {
        before(async () => {
            // Stub ethers methods
            sinon.stub(ethers, 'Contract').returns({
                balances: (
                    addresses: string[],
                    _ethBalance: string[]
                ): BigNumber[] => addresses.map(() => BigNumber.from('999')),
            } as any);
        });

        it('Should get balance', async function () {
            sinon
                .stub(ethers.providers.JsonRpcProvider.prototype, 'send')
                .returns(Promise.resolve('0x00'));
            const accountsController =
                accountTrackerController.store.getState().accounts;
            const targetAddress = Object.keys(accountsController)[0];
            const balance = BigNumber.from(0);
            const balanceWeb3 = await blankProviderController.handle(portId, {
                params: [targetAddress],
                method: JSONRPCMethod.eth_getBalance,
            });

            expect(balanceWeb3).to.be.equal(balance._hex);
        });

        it('Should fetch latest block number', async function () {
            sinon
                .stub(ethers.providers.JsonRpcProvider.prototype, 'send')
                .returns(Promise.resolve('0x599dbe'));

            const web3latestBlockNr = parseInt(
                (await blankProviderController.handle(portId, {
                    method: JSONRPCMethod.eth_blockNumber,
                    params: [],
                })) as string
            );

            expect(web3latestBlockNr).to.be.equal(5873086);
        });

        it('Should fetch transaction count', async function () {
            sinon
                .stub(ethers.providers.JsonRpcProvider.prototype, 'send')
                .returns(Promise.resolve(0));
            const accountsController =
                accountTrackerController.store.getState().accounts;
            const targetAddress = Object.keys(accountsController)[0];
            const transactionCountWeb3 = await blankProviderController.handle(
                portId,
                {
                    method: JSONRPCMethod.eth_getTransactionCount,
                    params: [targetAddress],
                }
            );

            expect(transactionCountWeb3).to.be.equal(0);
        });

        it('Should get transaction by hash', async function () {
            sinon
                .stub(ethers.providers.JsonRpcProvider.prototype, 'send')
                .returns(
                    Promise.resolve({
                        blockHash:
                            '0x4262f108d324574999aac9e5d9500118732e252b600d71c44079dd25ad2e7ee1',
                        blockNumber: '0xd2d61b',
                        from: '0xd911f68222acff6f6036d98e2909f85f781d3a47',
                        gas: '0x2aea6',
                        gasPrice: '0x25fda44264',
                        maxFeePerGas: '0x2721e01771',
                        maxPriorityFeePerGas: '0x64f29720',
                        hash: '0x3979f7ae255171ae6c6fd1c625219b45e2da7e52e6401028c29f0f27581af601',
                        input: '0x7ff36ab500000000000000000000000000000000000000000000001990c704258d5b3bd90000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d911f68222acff6f6036d98e2909f85f781d3a470000000000000000000000000000000000000000000000000000000061bb75890000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000041a3dba3d677e573636ba691a70ff2d606c29666',
                        nonce: '0x1',
                        to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
                        transactionIndex: '0x69',
                        value: '0x13fbe85edc90000',
                        type: '0x2',
                        accessList: [],
                        chainId: '0x1',
                        v: '0x0',
                        r: '0xc2fe0bda3cf75fe3ba24468ff1eeb7ba9e7cd6990a240ac9b6763f44100fd78',
                        s: '0x10f7879ba1451691e924280c3881066fa047e37aef50bcc15dfd8082ca099026',
                    })
                );

            const web3Trx: any = await blankProviderController.handle(portId, {
                method: JSONRPCMethod.eth_getTransactionByHash,
                params: [TX_HASH],
            });

            expect(web3Trx.hash).to.be.equal(TX_HASH);
        });
    }).timeout(10000);

    describe('Wallet requests', () => {
        it('Should get accounts', async function () {
            const accounts = Object.keys(
                accountTrackerController.store.getState().accounts
            );

            sinon.stub(appStateController.UIStore, 'getState').returns({
                isAppUnlocked: true,
            });
            sinon.stub(permissionsController.store, 'getState').returns({
                permissions: {
                    'https://app.uniswap.org': {
                        accounts: accounts,
                        activeAccount: accounts[0],
                        data: { name: '', iconURL: '' },
                        origin: '',
                    },
                },
                permissionRequests: {},
            });

            const accountsWeb3 = await blankProviderController.handle(portId, {
                params: [],
                method: JSONRPCMethod.eth_accounts,
            });

            expect(accountsWeb3).to.deep.equal(
                permissionsController.store.getState().permissions[
                    'https://app.uniswap.org'
                ].accounts
            );
        });

        it('Should get chain id', async function () {
            const chainId = await blankProviderController.handle(portId, {
                params: [],
                method: JSONRPCMethod.eth_chainId,
            });

            const network = networkController.network;

            expect(chainId).to.be.equal(hexValue(network.chainId));
        });
    }).timeout(10000);

    describe('Utils', () => {
        it('Should hash sha3', async function () {
            const utilHash = ethers.utils.keccak256(
                ethers.utils.toUtf8Bytes(TEXT_FOR_HASH)
            );

            const web3Hash = await blankProviderController.handle(portId, {
                method: JSONRPCMethod.web3_sha3,
                params: [TEXT_FOR_HASH],
            });

            expect(utilHash).to.be.equal(web3Hash);
        });
    });
});
