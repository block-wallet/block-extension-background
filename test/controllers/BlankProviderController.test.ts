import { expect } from 'chai';
import NetworkController from '../../src/controllers/NetworkController';
import { AccountTrackerController } from '../../src/controllers/AccountTrackerController';
import { mockPreferencesController } from '../mocks/mock-preferences';
import { mockKeyringController } from '../mocks/mock-keyring-controller';
import { mockedPermissionsController } from '../mocks/mock-permissions';
import { BigNumber, ethers } from 'ethers';
import { TokenController } from '../../src/controllers/erc-20/TokenController';
import { TokenOperationsController } from '@blank/background/controllers/erc-20/transactions/Transaction';
import { JSONRPCMethod } from '@blank/background/utils/types/ethereum';
import BlankProviderController from '@blank/background/controllers/BlankProviderController';
import sinon from 'sinon';
import { providerInstances } from '@blank/background/infrastructure/connection';
import AppStateController from '@blank/background/controllers/AppStateController';
import MockDepositController from '../mocks/mock-deposit-controller';
import { PreferencesController } from '@blank/background/controllers/PreferencesController';
import PermissionsController, {
    PermissionsControllerState,
} from '@blank/background/controllers/PermissionsController';
import { GasPricesController } from '@blank/background/controllers/GasPricesController';
import initialState from '@blank/background/utils/constants/initialState';
import { TypedTransaction } from '@ethereumjs/tx';
import { getNetworkControllerInstance } from '../mocks/mock-network-instance';
import BlockUpdatesController from '@blank/background/controllers/BlockUpdatesController';
import { ExchangeRatesController } from '@blank/background/controllers/ExchangeRatesController';
import { IncomingTransactionController } from '@blank/background/controllers/IncomingTransactionController';
import TransactionController from '@blank/background/controllers/transactions/TransactionController';
import KeyringControllerDerivated from '@blank/background/controllers/KeyringControllerDerivated';

const TRANSACTION_HASH =
    '0x1f842e47fc13c96a56d57182b1e00d8db34c515bc4366102d4a2a5fb0d23e7d2';
const TEXT_FOR_HASH = 'HASH ME';

describe('Blank Provider Controller', function () {
    const defaultIdleTimeout = 5;
    const initialLastActiveTime = new Date().getTime();
    const portId = '7e24f69d-c740-4eb3-9c6e-4d47df491005';

    providerInstances[portId] = {
        port: chrome.runtime.connect(),
        tabId: 420,
        origin: 'https://app.uniswap.org',
        siteMetadata: {
            iconURL: 'https://app.uniswap.org/favicon.png',
            name: 'Uniswap',
        },
    };

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

    let networkController: NetworkController;
    let accountTrackerController: AccountTrackerController;
    let transactionController: TransactionController;
    let tokenController: TokenController;
    let tokenOperationsController: TokenOperationsController;
    let blankProviderController: BlankProviderController;
    let appStateController: AppStateController;
    let preferencesController: PreferencesController;
    let permissionsController: PermissionsController;
    let keyringController: KeyringControllerDerivated;
    let blockUpdatesController: BlockUpdatesController;
    let exchangeRatesController: ExchangeRatesController;
    let incomingTransactionController: IncomingTransactionController;
    let gasPricesController: GasPricesController;

    beforeEach(function () {
        const depositController = MockDepositController();

        preferencesController = mockPreferencesController;
        permissionsController = mockedPermissionsController;

        networkController = getNetworkControllerInstance();

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
            tokenOperationsController
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

        blockUpdatesController = new BlockUpdatesController(
            networkController,
            accountTrackerController,
            gasPricesController,
            exchangeRatesController,
            incomingTransactionController,
            transactionController,
            { blockData: {} }
        );

        keyringController = new KeyringControllerDerivated({});

        blankProviderController = new BlankProviderController(
            networkController,
            transactionController,
            mockedPermissionsController,
            appStateController,
            keyringController,
            tokenController,
            blockUpdatesController
        );

        accountTrackerController.addPrimaryAccount(
            ethers.Wallet.createRandom().address
        );
    });

    afterEach(function () {
        sinon.restore();
    });

    it('Should get accounts correctly', async function () {
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
        } as PermissionsControllerState);

        const payload = {
            parameters: [],
            method: JSONRPCMethod.eth_accounts,
        };
        const accountsWeb3 = await blankProviderController.handle(
            portId,
            payload
        );
        expect(accountsWeb3).to.deep.equal(
            permissionsController.store.getState().permissions[
                'https://app.uniswap.org'
            ].accounts
        );
    });

    it('Should get balance correctly', async function () {
        sinon
            .stub(ethers.providers.JsonRpcProvider.prototype, 'send')
            .returns(Promise.resolve('0x00'));
        const accountsController =
            accountTrackerController.store.getState().accounts;
        const targetAddress = Object.keys(accountsController)[0];
        const balance = BigNumber.from(0);
        const payload = {
            parameters: [targetAddress],
            method: JSONRPCMethod.eth_getBalance,
        };
        const balanceWeb3 = await blankProviderController.handle(
            portId,
            payload
        );

        expect(balanceWeb3).to.be.equal(balance._hex);
    });

    it('Should fetch latest block number correctly', async function () {
        sinon
            .stub(ethers.providers.JsonRpcProvider.prototype, 'send')
            .returns(Promise.resolve('0x599dbe'));
        const payload = {
            method: JSONRPCMethod.eth_blockNumber,
            params: [],
        };
        const web3latestBlockNr = parseInt(
            (await blankProviderController.handle(portId, payload)) as string
        );

        expect(web3latestBlockNr).to.be.equal(5873086);
    }).timeout(15000);

    it('Should fetch transaction count correctly', async function () {
        sinon
            .stub(ethers.providers.JsonRpcProvider.prototype, 'send')
            .returns(Promise.resolve(0));
        const accountsController =
            accountTrackerController.store.getState().accounts;
        const targetAddress = Object.keys(accountsController)[0];
        const payload = {
            method: JSONRPCMethod.eth_getTransactionCount,
            params: [targetAddress],
        };
        const transactionCountWeb3 = await blankProviderController.handle(
            portId,
            payload
        );

        expect(transactionCountWeb3).to.be.equal(0);
    });

    it('Should get transaction by hash correctly', async function () {
        const providerTrx = await networkController
            .getProvider()
            .getTransaction(TRANSACTION_HASH);
        const payload = {
            method: JSONRPCMethod.eth_getTransactionByHash,
            params: [TRANSACTION_HASH],
        };
        const web3Trx: any = await blankProviderController.handle(
            portId,
            payload
        );

        expect(web3Trx.hash).to.be.equal(providerTrx.hash);
    });

    it('Should sha3 correctly', async function () {
        const utilHash = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(TEXT_FOR_HASH)
        );
        const payload = {
            method: JSONRPCMethod.web3_sha3,
            params: [TEXT_FOR_HASH],
        };
        const web3Hash = await blankProviderController.handle(portId, payload);

        expect(utilHash).to.be.equal(web3Hash);
    });
});
