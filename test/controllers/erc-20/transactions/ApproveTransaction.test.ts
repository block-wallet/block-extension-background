import {
    amountParamNotPresentError,
    gasPriceParamNotPresentError,
    tokenAddressParamNotPresentError,
    spenderParamNotPresentError,
    transactionIdParamNotPresentError,
    transactionNotFound,
    gasMaxFeePerGasParamNotPresentError,
    gasMaxPriorityFeePerGasParamNotPresentError,
    TokenController,
} from '../../../../src/controllers/erc-20/TokenController';
import { expect } from 'chai';
import NetworkController from '../../../../src/controllers/NetworkController';
import { mockPreferencesController } from '../../../mocks/mock-preferences';
import sinon from 'sinon';
import { ApproveTransaction } from '@blank/background/controllers/erc-20/transactions/ApproveTransaction';
import { PreferencesController } from '@blank/background/controllers/PreferencesController';
import { TransactionController } from '@blank/background/controllers/transactions/TransactionController';
import { BigNumber } from '@ethersproject/bignumber';
import { TransactionMeta } from '@blank/background/controllers/transactions/utils/types';
import { mockedPermissionsController } from '../../../mocks/mock-permissions';
import PermissionsController from '@blank/background/controllers/PermissionsController';
import { GasPricesController } from '@blank/background/controllers/GasPricesController';
import initialState from '@blank/background/utils/constants/initialState';
import { TypedTransaction } from '@ethereumjs/tx';
import { getNetworkControllerInstance } from '../../../mocks/mock-network-instance';
import { mockKeyringController } from '../../../mocks/mock-keyring-controller';
import { TokenOperationsController } from '@blank/background/controllers/erc-20/transactions/Transaction';
import { AccountTrackerController } from '@blank/background/controllers/AccountTrackerController';
import { ExchangeRatesController } from '@blank/background/controllers/ExchangeRatesController';
import { IncomingTransactionController } from '@blank/background/controllers/IncomingTransactionController';
import BlockUpdatesController from '@blank/background/controllers/BlockUpdatesController';

describe('ApproveTransaction implementation', function () {
    const daiAddress = '0xdc31Ee1784292379Fbb2964b3B9C4124D8F89C60';
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
    let approveTransaction: ApproveTransaction;
    let networkController: NetworkController;
    let preferencesController: PreferencesController;
    let transactionController: TransactionController;
    let permissionsController: PermissionsController;
    let gasPricesController: GasPricesController;
    let tokenController: TokenController;
    let tokenOperationsController: TokenOperationsController;
    let blockUpdatesController: BlockUpdatesController;
    let exchangeRatesController: ExchangeRatesController;
    let incomingTransactionController: IncomingTransactionController;
    let accountTrackerController: AccountTrackerController;

    beforeEach(() => {
        networkController = getNetworkControllerInstance();
        preferencesController = mockPreferencesController;
        permissionsController = mockedPermissionsController;
        gasPricesController = new GasPricesController(
            initialState.GasPricesController,
            networkController
        );

        tokenOperationsController = new TokenOperationsController({
            networkController,
        });

        tokenController = new TokenController(initialState.TokenController, {
            networkController,
            preferencesController,
            tokenOperationsController,
        });

        accountTrackerController = new AccountTrackerController(
            mockKeyringController,
            networkController,
            tokenController,
            tokenOperationsController,
            preferencesController
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

        approveTransaction = new ApproveTransaction({
            transactionController: transactionController,
            preferencesController: preferencesController,
            networkController: networkController,
        });
    });
    afterEach(function () {
        sinon.restore();
    });

    describe('populateTransaction', function () {
        it('Should fail - tokenAddress not present', async () => {
            try {
                await approveTransaction.populateTransaction({
                    tokenAddress: '',
                    spender: '',
                    amount: BigNumber.from(0),
                });
            } catch (e: any) {
                expect(e).equal(tokenAddressParamNotPresentError);
            }
        });
        it('Should fail - spender not present', async () => {
            try {
                await approveTransaction.populateTransaction({
                    tokenAddress: daiAddress,
                    spender: '',
                    amount: BigNumber.from(0),
                });
            } catch (e: any) {
                expect(e).equal(spenderParamNotPresentError);
            }
        });
        it('Should fail - amount not present', async () => {
            try {
                await approveTransaction.populateTransaction({
                    tokenAddress: daiAddress,
                    spender: daiAddress,
                    amount: BigNumber.from(0),
                });
            } catch (e: any) {
                expect(e).equal(amountParamNotPresentError);
            }
        });
        it('Transaction should be populated ok', async () => {
            const populatedTransaction =
                await approveTransaction.populateTransaction({
                    tokenAddress: daiAddress,
                    spender: daiAddress,
                    amount: BigNumber.from(1000),
                });

            expect(populatedTransaction).to.be.not.null;
            expect(populatedTransaction).to.be.not.undefined;
            expect(populatedTransaction.data).to.be.not.null;
            expect(populatedTransaction.data).to.be.not.undefined;
        });

        describe('calculateTransactionGasLimit', function () {
            it('Should fail - tokenAddress not present', async () => {
                try {
                    await approveTransaction.calculateTransactionGasLimit({
                        tokenAddress: '',
                        spender: '',
                        amount: BigNumber.from(0),
                    });
                } catch (e: any) {
                    expect(e).equal(tokenAddressParamNotPresentError);
                }
            });
            it('Should fail - to not present', async () => {
                try {
                    await approveTransaction.calculateTransactionGasLimit({
                        tokenAddress: daiAddress,
                        spender: '',
                        amount: BigNumber.from(0),
                    });
                } catch (e: any) {
                    expect(e).equal(spenderParamNotPresentError);
                }
            });
            it('Should fail - amount not present', async () => {
                try {
                    await approveTransaction.calculateTransactionGasLimit({
                        tokenAddress: daiAddress,
                        spender: daiAddress,
                        amount: BigNumber.from(0),
                    });
                } catch (e: any) {
                    expect(e).equal(amountParamNotPresentError);
                }
            });
            it('Should calculate gas limit', async () => {
                const { gasLimit } =
                    await approveTransaction.calculateTransactionGasLimit({
                        tokenAddress: daiAddress,
                        spender: daiAddress,
                        amount: BigNumber.from(1000),
                    });

                expect(gasLimit).to.be.not.null;
                expect(gasLimit).to.be.not.undefined;
                expect(gasLimit.toNumber() > 0).to.be.true;
            });
        });

        describe('addAsNewTransaction', function () {
            it('Should fail - tokenAddress not present', async () => {
                try {
                    await approveTransaction.addAsNewTransaction(
                        {
                            tokenAddress: '',
                            spender: '',
                            amount: BigNumber.from(0),
                        },
                        {
                            gasPrice: BigNumber.from(0),
                            gasLimit: BigNumber.from(0),
                        }
                    );
                } catch (e: any) {
                    expect(e).equal(tokenAddressParamNotPresentError);
                }
            });
            it('Should fail - spender not present', async () => {
                try {
                    await approveTransaction.addAsNewTransaction(
                        {
                            tokenAddress: daiAddress,
                            spender: '',
                            amount: BigNumber.from(0),
                        },
                        {
                            gasPrice: BigNumber.from(0),
                            gasLimit: BigNumber.from(0),
                        }
                    );
                } catch (e: any) {
                    expect(e).equal(spenderParamNotPresentError);
                }
            });
            it('Should fail - amount not present', async () => {
                try {
                    await approveTransaction.addAsNewTransaction(
                        {
                            tokenAddress: daiAddress,
                            spender: daiAddress,
                            amount: BigNumber.from(0),
                        },
                        {
                            gasPrice: BigNumber.from(0),
                            gasLimit: BigNumber.from(0),
                        }
                    );
                } catch (e: any) {
                    expect(e).equal(amountParamNotPresentError);
                }
            });
            it('Should fail - gas price not present', async () => {
                sinon
                    .stub(networkController, 'getEIP1559Compatibility')
                    .callsFake(() => new Promise((resolve) => resolve(false)));

                try {
                    await approveTransaction.addAsNewTransaction(
                        {
                            tokenAddress: daiAddress,
                            spender: daiAddress,
                            amount: BigNumber.from(100),
                        },
                        {
                            gasPrice: BigNumber.from(0),
                            gasLimit: BigNumber.from(0),
                        }
                    );
                } catch (e: any) {
                    expect(e).equal(gasPriceParamNotPresentError);
                }
            });
            it('Should fail - maxFeePerGas not present', async () => {
                sinon
                    .stub(networkController, 'getEIP1559Compatibility')
                    .callsFake(() => new Promise((resolve) => resolve(true)));

                try {
                    await approveTransaction.addAsNewTransaction(
                        {
                            tokenAddress: daiAddress,
                            spender: daiAddress,
                            amount: BigNumber.from(100),
                        },
                        {
                            maxFeePerGas: BigNumber.from(0),
                            maxPriorityFeePerGas: BigNumber.from(0),
                            gasLimit: BigNumber.from(0),
                        }
                    );
                } catch (e: any) {
                    expect(e).equal(gasMaxFeePerGasParamNotPresentError);
                }
            });
            it('Should fail - maxPriorityFeePerGas not present', async () => {
                sinon
                    .stub(networkController, 'getEIP1559Compatibility')
                    .callsFake(() => new Promise((resolve) => resolve(true)));

                try {
                    await approveTransaction.addAsNewTransaction(
                        {
                            tokenAddress: daiAddress,
                            spender: daiAddress,
                            amount: BigNumber.from(100),
                        },
                        {
                            maxFeePerGas: BigNumber.from(1),
                            maxPriorityFeePerGas: BigNumber.from(0),
                            gasLimit: BigNumber.from(0),
                        }
                    );
                } catch (e: any) {
                    expect(e).equal(
                        gasMaxPriorityFeePerGasParamNotPresentError
                    );
                }
            });
            it('Should add an unnaproval transaction', async () => {
                sinon
                    .stub(networkController, 'getEIP1559Compatibility')
                    .callsFake(() => new Promise((resolve) => resolve(false)));

                const meta = await approveTransaction.addAsNewTransaction(
                    {
                        tokenAddress: daiAddress,
                        spender: daiAddress,
                        amount: BigNumber.from(1000),
                    },
                    {
                        gasPrice: BigNumber.from(100000),
                        gasLimit: BigNumber.from(100000),
                    }
                );

                expect(meta).to.be.not.null;
                expect(meta).to.be.not.undefined;
                expect(meta.id).to.be.not.null;
                expect(meta.id).to.be.not.undefined;
            });
            it('Should add an unnaproval transaction - EIP-1559', async () => {
                sinon
                    .stub(networkController, 'getEIP1559Compatibility')
                    .callsFake(() => new Promise((resolve) => resolve(true)));

                const meta = await approveTransaction.addAsNewTransaction(
                    {
                        tokenAddress: daiAddress,
                        spender: daiAddress,
                        amount: BigNumber.from(1000),
                    },
                    {
                        maxFeePerGas: BigNumber.from(1000000),
                        maxPriorityFeePerGas: BigNumber.from(100000),
                        gasLimit: BigNumber.from(100000),
                    }
                );

                expect(meta).to.be.not.null;
                expect(meta).to.be.not.undefined;
                expect(meta.id).to.be.not.null;
                expect(meta.id).to.be.not.undefined;
            });
        });

        describe('updateTransactionGas', function () {
            it('Should fail - transactionId not present', async () => {
                try {
                    await approveTransaction.updateTransactionGas('', {
                        gasPrice: BigNumber.from(0),
                        gasLimit: BigNumber.from(0),
                    });
                } catch (e: any) {
                    expect(e).equal(transactionIdParamNotPresentError);
                }
            });
            it('Should fail - transactionId invalid', async () => {
                try {
                    await approveTransaction.updateTransactionGas('not valid', {
                        gasPrice: BigNumber.from(0),
                        gasLimit: BigNumber.from(0),
                    });
                } catch (e: any) {
                    expect(e).equal(transactionNotFound);
                }
            });
            it('Should update the gas configuration for an unnaproval transaction', async () => {
                sinon
                    .stub(networkController, 'getEIP1559Compatibility')
                    .callsFake(() => new Promise((resolve) => resolve(false)));

                const meta = await approveTransaction.addAsNewTransaction(
                    {
                        tokenAddress: daiAddress,
                        spender: daiAddress,
                        amount: BigNumber.from(1000),
                    },
                    {
                        gasPrice: BigNumber.from(100000),
                        gasLimit: BigNumber.from(100000),
                    }
                );

                expect(meta).to.be.not.null;
                expect(meta).to.be.not.undefined;
                expect(meta.id).to.be.not.null;
                expect(meta.id).to.be.not.undefined;
                expect(meta.transactionParams.gasPrice?.eq(100000)).to.be.true;
                expect(meta.transactionParams.gasLimit?.eq(100000)).to.be.true;

                await approveTransaction.updateTransactionGas(meta.id, {
                    gasPrice: BigNumber.from(200000),
                    gasLimit: BigNumber.from(200000),
                });

                const updatedMeta = transactionController.getTransaction(
                    meta.id
                );

                expect(updatedMeta).to.be.not.null;
                expect(updatedMeta).to.be.not.undefined;
                expect(updatedMeta!.id).to.be.not.null;
                expect(updatedMeta!.id).to.be.not.undefined;
                expect(updatedMeta!.transactionParams.gasPrice?.eq(200000)).to
                    .be.true;
                expect(updatedMeta!.transactionParams.gasLimit?.eq(200000)).to
                    .be.true;
            });
            it('Should update the gas configuration for an unnaproval transaction - EIP-1559', async () => {
                sinon
                    .stub(networkController, 'getEIP1559Compatibility')
                    .callsFake(() => new Promise((resolve) => resolve(true)));

                const meta = await approveTransaction.addAsNewTransaction(
                    {
                        tokenAddress: daiAddress,
                        spender: daiAddress,
                        amount: BigNumber.from(1000),
                    },
                    {
                        maxFeePerGas: BigNumber.from(1000000),
                        maxPriorityFeePerGas: BigNumber.from(100000),
                        gasLimit: BigNumber.from(100000),
                    }
                );

                expect(meta).to.be.not.null;
                expect(meta).to.be.not.undefined;
                expect(meta.id).to.be.not.null;
                expect(meta.id).to.be.not.undefined;
                expect(meta.transactionParams.maxFeePerGas?.eq(1000000)).to.be
                    .true;
                expect(meta.transactionParams.maxPriorityFeePerGas?.eq(100000))
                    .to.be.true;
                expect(meta.transactionParams.gasLimit?.eq(100000)).to.be.true;

                await approveTransaction.updateTransactionGas(meta.id, {
                    maxFeePerGas: BigNumber.from(2000000),
                    maxPriorityFeePerGas: BigNumber.from(200000),
                    gasLimit: BigNumber.from(200000),
                });

                const updatedMeta = transactionController.getTransaction(
                    meta.id
                );

                expect(updatedMeta).to.be.not.null;
                expect(updatedMeta).to.be.not.undefined;
                expect(updatedMeta!.id).to.be.not.null;
                expect(updatedMeta!.id).to.be.not.undefined;
                expect(meta.transactionParams.maxFeePerGas?.eq(2000000)).to.be
                    .true;
                expect(meta.transactionParams.maxPriorityFeePerGas?.eq(200000))
                    .to.be.true;
                expect(meta.transactionParams.gasLimit?.eq(200000)).to.be.true;
            });
        });

        describe('approveTransaction', function () {
            it('Should fail - transactionId not present', async () => {
                try {
                    await approveTransaction.approveTransaction('');
                } catch (e: any) {
                    expect(e).equal(transactionIdParamNotPresentError);
                }
            });
            it('Should approve the transaction', async () => {
                sinon.stub(transactionController, 'approveTransaction').returns(
                    new Promise<void>((resolve) => {
                        resolve();
                    })
                );
                await approveTransaction.approveTransaction(
                    'a mock transaction'
                );
            });
        });

        describe('getTransactionResult', function () {
            it('Should fail - transactionId not present', async () => {
                try {
                    await approveTransaction.getTransactionResult('');
                } catch (e: any) {
                    expect(e).equal(transactionIdParamNotPresentError);
                }
            });
            it('Should get the transaction result', async () => {
                sinon
                    .stub(
                        TransactionController.prototype,
                        'waitForTransactionResult'
                    )
                    .returns(
                        new Promise((resolve) => {
                            resolve('0x123af');
                        })
                    );
                const result = await approveTransaction.getTransactionResult(
                    'a mock transaction'
                );

                expect(result).to.be.not.null;
                expect(result).to.be.not.undefined;
                expect(result).to.be.true;
            });
        });
    });
});
