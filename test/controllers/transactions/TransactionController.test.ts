import { expect } from 'chai';
import { BigNumber, providers } from 'ethers';
import sinon from 'sinon';
import { TypedTransaction } from '@ethereumjs/tx';
import { TokenController } from '@blank/background/controllers/erc-20/TokenController';
import { TokenOperationsController } from '@blank/background/controllers/erc-20/transactions/Transaction';
import { GasPricesController } from '@blank/background/controllers/GasPricesController';
import PermissionsController from '@blank/background/controllers/PermissionsController';
import initialState from '@blank/background/utils/constants/initialState';
import NetworkController from '../../../src/controllers/NetworkController';
import { PreferencesController } from '../../../src/controllers/PreferencesController';
import {
    SEND_GAS_COST,
    TransactionController,
} from '../../../src/controllers/transactions/TransactionController';
import { getNetworkControllerInstance } from 'test/mocks/mock-network-instance';
import { mockPreferencesController } from 'test/mocks/mock-preferences';
import { mockedPermissionsController } from 'test/mocks/mock-permissions';
import {
    TransactionCategories,
    TransactionMeta,
    TransactionStatus,
} from '@blank/background/controllers/transactions/utils/types';
import { ProviderError } from '@blank/background/utils/types/ethereum';

describe('Transactions Controller', () => {
    const providerMock = {
        getTransactionCount: (address: string, block: string) =>
            Promise.resolve(1),
        getGasPrice: () => Promise.resolve(BigNumber.from('2000000000')),
        getCode: (addresOrName: string) => Promise.resolve('0x0'),
        getNetwork: () =>
            Promise.resolve({
                name: 'goerli',
                chainId: '5',
            }),
        getBlock: () => Promise.resolve({}),
        sendTransaction: ((rawTransaction: any) => {
            return Promise.resolve({
                hash: '0x6d4bd8f2381fe620ac08e48786ec3a6b66e06668663bd5557b6f4ef1c838689b',
            });
        }) as any,
        getTransaction: () => undefined,
        getTransactionReceipt: () => undefined,
    } as any;

    let networkController: NetworkController;
    let transactionController: TransactionController;
    let preferencesController: PreferencesController;
    let permissionsController: PermissionsController;
    let gasPricesController: GasPricesController;
    let tokenController: TokenController;
    let tokenOperationsController: TokenOperationsController;
    const mockedAccounts = {
        goerli: [
            {
                key: 'a3acfb0b9644040cb2eabfa58016ec23d059db048cb925d572e249085509ac02',
                address: '0x281ae730d284bDA68F4e9Ac747319c8eDC7dF3B1',
            },
            {
                key: '',
                address: '0xbda8C7b7B5d0579Eb18996D1f684A434E4fF701f',
            },
        ],
    };

    describe('Gas Estimation', () => {
        beforeEach(() => {
            // Instantiate objects
            networkController = getNetworkControllerInstance();

            preferencesController = mockPreferencesController;
            preferencesController.setSelectedAddress(
                mockedAccounts['goerli'][0].address
            );

            gasPricesController = new GasPricesController(
                initialState.GasPricesController,
                networkController
            );

            transactionController = new TransactionController(
                networkController,
                preferencesController,
                mockedPermissionsController,
                gasPricesController,
                {
                    transactions: [],
                },
                async (ethTx: TypedTransaction) => {
                    const privateKey = Buffer.from(
                        mockedAccounts.goerli[0].key,
                        'hex'
                    );
                    return Promise.resolve(ethTx.sign(privateKey));
                },
                { txHistoryLimit: 40 }
            );

            sinon
                .stub(transactionController['_signatureRegistry'], 'lookup')
                .returns(Promise.resolve('multicall(bytes[] data)'));
        });

        afterEach(() => {
            sinon.restore();
        });

        it('Should estimate the transaction gasLimit', async () => {
            sinon.stub(networkController, 'getProvider').returns({
                ...providerMock,
                getBlock: (block: any) => ({
                    gasLimit: BigNumber.from('20000000'),
                }),
                estimateGas: () => BigNumber.from('150000'),
                getGasPrice: () => BigNumber.from('2000000000'),
                on: (event: string, func: Function) => {},
                getCode: (addresOrName: string) => Promise.resolve('0xabc'),
            });

            const { gasLimit, estimationSucceeded } =
                await transactionController.estimateGas({
                    transactionParams: {
                        chainId: 1,
                        from: '0xfff',
                        to: '0x00',
                        data: '0x6888fcd',
                    },
                } as any);

            expect(estimationSucceeded).to.be.true;

            expect(gasLimit.toString()).to.be.equal('225000');
        });

        it('Should fallback the gasLimit to the latest block one', async () => {
            sinon.stub(networkController, 'getProvider').returns({
                ...providerMock,
                on: (event: string, func: Function) => {},
                getGasPrice: () => BigNumber.from('2000000000'),
                estimateGas: () => {
                    throw new Error('Error estimating');
                },
                getBlock: (block: any) => ({
                    gasLimit: BigNumber.from('200000'),
                }),
                getCode: (addresOrName: string) => Promise.resolve('0xabc'),
            });
            const { gasLimit, estimationSucceeded } =
                await transactionController.estimateGas({
                    transactionParams: {
                        chainId: 1,
                        from: '0xfff',
                        to: '0x00',
                        data: '0x6888fcd',
                    },
                } as any);

            expect(estimationSucceeded).to.be.false;
            expect(gasLimit.toString()).to.be.equal('190000');
        });

        it('Should fail while trying to estimate gas and return a fallback value', async () => {
            sinon.stub(networkController, 'getProvider').returns({
                ...providerMock,
                on: (event: string, func: Function) => {},
                getGasPrice: () => BigNumber.from('2000000000'),
                estimateGas: () => {
                    throw new Error('Error estimating');
                },
                getBlock: (block: any) => ({
                    gasLimit: BigNumber.from('200000'),
                }),
                getCode: (addresOrName: string) => Promise.resolve('0xabc'),
            });

            const { gasLimit, estimationSucceeded } =
                await transactionController.estimateGas(
                    {
                        transactionParams: {
                            chainId: 1,
                            from: '0xfff',
                            to: '0x00',
                            data: '0x6888fcd',
                        },
                    } as any,
                    BigNumber.from('1200000')
                );

            expect(estimationSucceeded).to.be.false;
            expect(gasLimit.toString()).to.be.equal('1200000');
        });

        it('Should return the block upper gasLimit', async () => {
            sinon.stub(networkController, 'getProvider').returns({
                ...providerMock,
                getBlock: (block: any) => ({
                    gasLimit: BigNumber.from('200000'),
                }),
                estimateGas: () => BigNumber.from('150000'),
                getGasPrice: () => BigNumber.from('2000000000'),
                on: (event: string, func: Function) => {},
                getCode: (addresOrName: string) => Promise.resolve('0xabc'),
            });

            // It should return upperGasLimit //
            const gasEstimation = await transactionController.estimateGas({
                transactionParams: {
                    chainId: 1,
                    from: '0xfff',
                    to: '0x00',
                    data: '0x6888fcd',
                },
            } as any);

            const bufferedGasLimit = gasEstimation.gasLimit;
            expect(gasEstimation.estimationSucceeded).to.be.true;
            expect(bufferedGasLimit.toString()).to.be.equal('180000');
        });

        it('Should return the unmodified estimated gasLimit', async () => {
            sinon.stub(networkController, 'getProvider').returns({
                ...providerMock,
                on: (event: string, func: Function) => {},
                getGasPrice: () => BigNumber.from('2000000000'),
                estimateGas: () => BigNumber.from('190000'),
                getBlock: (block: any) => ({
                    gasLimit: BigNumber.from('200000'),
                }),
                getCode: (addresOrName: string) => Promise.resolve('0xabc'),
            });

            const gasEstimation2 = await transactionController.estimateGas({
                transactionParams: {
                    chainId: 1,
                    from: '0xfff',
                    to: '0x00',
                    data: '0x6888fcd',
                },
            } as any);

            const bufferedGasLimit2 = gasEstimation2.gasLimit;
            expect(gasEstimation2.estimationSucceeded).to.be.true;
            expect(bufferedGasLimit2.toString()).to.be.equal('190000');
        });

        it('Should return the send gas cost', async () => {
            sinon.stub(networkController, 'getProvider').returns({
                ...providerMock,
                on: (event: string, func: Function) => {},
                getGasPrice: () => BigNumber.from('2000000000'),
                estimateGas: () => {
                    throw new Error('Error estimating');
                },
                getBlock: (block: any) => ({
                    gasLimit: BigNumber.from('200000'),
                }),
                getCode: (addresOrName: string) => Promise.resolve('0x0'),
            });
            const { gasLimit, estimationSucceeded } =
                await transactionController.estimateGas({
                    transactionParams: {
                        chainId: 1,
                        from: '0xfff',
                        to: '0xab',
                        value: BigNumber.from(1),
                    },
                } as any);

            expect(estimationSucceeded).to.be.true;
            expect(gasLimit.toString()).to.be.equal('21000');
        });

        it('Should estimate gas cost of a send in a custom network', async () => {
            sinon
                .stub(networkController, 'isChainIdCustomNetwork')
                .returns(true);

            sinon.stub(networkController, 'getProvider').returns({
                ...providerMock,
                on: (event: string, func: Function) => {},
                getGasPrice: () => BigNumber.from('2000000000'),
                estimateGas: () => {
                    return BigNumber.from('1200000');
                },
                getBlock: (block: any) => ({
                    gasLimit: BigNumber.from('200000'),
                }),
                getCode: (addresOrName: string) => Promise.resolve('0x0'),
            });
            const { gasLimit, estimationSucceeded } =
                await transactionController.estimateGas({
                    transactionParams: {
                        chainId: 1,
                        from: '0xfff',
                        to: '0xab',
                        value: BigNumber.from(1),
                    },
                } as any);

            expect(estimationSucceeded).to.be.true;
            expect(gasLimit.toString()).to.be.equal('1200000');
        });
    });

    describe('Transactions', () => {
        let mockedProvider: sinon.SinonStub<
            [],
            providers.InfuraProvider | providers.StaticJsonRpcProvider
        >;

        beforeEach(() => {
            networkController = getNetworkControllerInstance();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns(providerMock);

            sinon.stub(networkController, 'getLatestBlock').returns(
                Promise.resolve({
                    baseFeePerGas: BigNumber.from('100000000000'),
                    gasLimit: BigNumber.from('30000000'),
                } as any)
            );

            permissionsController = mockedPermissionsController;
            preferencesController = mockPreferencesController;
            preferencesController.setSelectedAddress(
                mockedAccounts['goerli'][0].address
            );

            gasPricesController = new GasPricesController(
                initialState.GasPricesController,
                networkController
            );

            sinon.stub(gasPricesController, 'getFeeData').returns(
                Promise.resolve({
                    maxFeePerGas: BigNumber.from('200000000000'),
                    maxPriorityFeePerGas: BigNumber.from('1000000000'),
                    gasPrice: BigNumber.from('100000000000'),
                })
            );

            sinon.stub(gasPricesController, 'store').get(() => ({
                getState: () => ({
                    gasPriceData: {
                        5: {
                            isEIP1559Compatible: true,
                        },
                    },
                }),
            }));

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

            transactionController = new TransactionController(
                networkController,
                preferencesController,
                permissionsController,
                gasPricesController,
                {
                    transactions: [],
                },
                async (ethTx: TypedTransaction) => {
                    const privateKey = Buffer.from(
                        mockedAccounts.goerli[0].key,
                        'hex'
                    );
                    return Promise.resolve(ethTx.sign(privateKey));
                },
                { txHistoryLimit: 40 }
            );
        });

        afterEach(() => {
            sinon.restore();
        });

        it('Should throw trying to add an invalid transaction', async () => {
            transactionController
                .addTransaction(
                    {
                        from: '0x1',
                    },
                    'blank'
                )
                .then(() => {
                    throw new Error('Expected addTransaction to throw');
                })
                .catch((e: Error) => {
                    expect(e.message).to.contain('Invalid "from" address');
                });
        });

        it('Should throw trying to add a transaction due to invalid blank origin', async () => {
            return transactionController
                .addTransaction(
                    {
                        from: mockedAccounts['goerli'][1].address,
                        to: mockedAccounts['goerli'][0].address,
                        value: BigNumber.from('1'),
                    },
                    'blank'
                )
                .then(() => {
                    throw new Error('Expected addTransaction to throw');
                })
                .catch((e: Error) => {
                    expect(e.message).to.be.equal(
                        'Internally initiated transaction is using invalid account.'
                    );
                });
        });

        it('Should throw trying to add a transaction due to account with no permission', async () => {
            sinon
                .stub(permissionsController, 'accountHasPermissions')
                .returns(false);

            return transactionController
                .addTransaction(
                    {
                        from: mockedAccounts['goerli'][1].address,
                        to: mockedAccounts['goerli'][0].address,
                        value: BigNumber.from('1'),
                    },
                    'https://app.uniswap.org'
                )
                .then(() => {
                    throw new Error('Expected addTransaction to throw');
                })
                .catch((e: Error) => {
                    expect(e.message).to.contain(
                        'Externally initiated transaction has no permission to make transaction with account'
                    );
                });
        });

        it('Should add a valid transaction correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            const { transactionMeta } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts['goerli'][0].address,
                        to: mockedAccounts['goerli'][1].address,
                        value: BigNumber.from('1'),
                    },
                    'blank'
                );

            const { transactions } = transactionController.store.getState();
            expect(transactions.length).to.be.equal(1);

            expect(transactionMeta.gasEstimationFailed).to.be.equal(false);
            expect(
                transactionMeta.transactionParams.gasLimit?._hex
            ).to.be.equal(SEND_GAS_COST);
            expect(transactionMeta).to.be.deep.equal(transactions[0]);
        });

        it('Should approve and submit a transaction correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            const { transactionMeta, result } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts['goerli'][0].address,
                        to: mockedAccounts['goerli'][1].address,
                        value: BigNumber.from('1'),
                    },
                    'blank'
                );

            await transactionController.approveTransaction(transactionMeta.id);
            return result.then((hash) =>
                expect(hash).to.be.equal(
                    '0x6d4bd8f2381fe620ac08e48786ec3a6b66e06668663bd5557b6f4ef1c838689b'
                )
            );
        });

        it('Should fail a transaction due to an error obtaining the nonce', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getTransactionCount: () =>
                        Promise.reject(
                            new Error('Error in getTransactionCount')
                        ),
                });

            const { transactionMeta, result } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts['goerli'][0].address,
                        to: mockedAccounts['goerli'][1].address,
                        value: BigNumber.from('1'),
                    },
                    'blank'
                );

            try {
                await transactionController.approveTransaction(
                    transactionMeta.id
                );
            } catch (error) {
                expect(error.message).to.be.equal(
                    'Error in getTransactionCount'
                );
            }

            return result
                .then(() => {
                    throw new Error('Approval should have failed');
                })
                .catch((e: Error) => {
                    expect(e.message).to.be.equal(
                        'Error in getTransactionCount'
                    );
                    const tx = transactionController.getTransaction(
                        transactionMeta.id
                    );
                    expect(tx?.status).to.be.equal(TransactionStatus.FAILED);
                    expect(tx?.error).to.be.not.undefined;
                    expect(tx?.error?.message).to.be.equal(e.message);
                });
        });

        it('Should fail a transaction due to an error signing', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            sinon.stub(transactionController, 'sign').returns(
                Promise.resolve({
                    r: undefined,
                    s: undefined,
                    v: undefined,
                } as TypedTransaction)
            );

            const { transactionMeta, result } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts['goerli'][0].address,
                        to: mockedAccounts['goerli'][1].address,
                        value: BigNumber.from('1'),
                    },
                    'blank'
                );

            try {
                await transactionController.approveTransaction(
                    transactionMeta.id
                );
            } catch (error) {
                expect(error.message).to.be.equal(
                    'An error while signing the transaction ocurred'
                );
            }

            return result
                .then(() => {
                    throw new Error('Approval should have failed');
                })
                .catch((e: Error) => {
                    expect(e.message).to.be.equal(
                        'An error while signing the transaction ocurred'
                    );
                    const tx = transactionController.getTransaction(
                        transactionMeta.id
                    );
                    expect(tx?.status).to.be.equal(TransactionStatus.FAILED);
                    expect(tx?.error).to.be.not.undefined;
                    expect(tx?.error?.message).to.be.equal(e.message);
                });
        });

        it('Should fail a transaction due to an error sending the transaction', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    sendTransaction: () =>
                        Promise.reject(new Error('Error in sendTransaction')),
                });

            const { transactionMeta, result } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts['goerli'][0].address,
                        to: mockedAccounts['goerli'][1].address,
                        value: BigNumber.from('1'),
                    },
                    'blank'
                );

            try {
                await transactionController.approveTransaction(
                    transactionMeta.id
                );
            } catch (error) {
                expect(error.message).to.be.equal('Error in sendTransaction');
            }

            return result
                .then(() => {
                    throw new Error('Approval should have failed');
                })
                .catch((e: Error) => {
                    expect(e.message).to.be.equal('Error in sendTransaction');
                    const tx = transactionController.getTransaction(
                        transactionMeta.id
                    );
                    expect(tx?.status).to.be.equal(TransactionStatus.FAILED);
                    expect(tx?.error).to.be.not.undefined;
                    expect(tx?.error?.message).to.be.equal(e.message);
                });
        });

        it('Should reject a transaction correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            const { transactionMeta, result } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts['goerli'][0].address,
                        to: mockedAccounts['goerli'][1].address,
                        value: BigNumber.from('1'),
                    },
                    'blank'
                );

            expect(
                transactionController.store.getState().transactions.length
            ).to.be.equal(1);

            transactionController.rejectTransaction(transactionMeta.id);
            return result
                .then(() => {
                    throw new Error('Transaction should have been rejected');
                })
                .catch((e: Error) => {
                    expect(e.message).to.be.equal(
                        ProviderError.TRANSACTION_REJECTED
                    );

                    expect(
                        transactionController.store.getState().transactions
                            .length
                    ).to.be.equal(0);
                });
        });

        it('Should clear the list of unapproved transactions', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            await transactionController.addTransaction(
                {
                    from: mockedAccounts['goerli'][0].address,
                    to: mockedAccounts['goerli'][1].address,
                    value: BigNumber.from('1'),
                },
                'blank'
            );

            await transactionController.addTransaction(
                {
                    from: mockedAccounts['goerli'][0].address,
                    to: mockedAccounts['goerli'][1].address,
                    value: BigNumber.from('1'),
                },
                'blank'
            );

            expect(
                transactionController.store.getState().transactions.length
            ).to.be.equal(2);

            transactionController.clearUnapprovedTransactions();

            expect(
                transactionController.store.getState().transactions.length
            ).to.be.equal(0);
        });

        it('Should clear the list of transactions correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            await transactionController.addTransaction(
                {
                    from: mockedAccounts['goerli'][0].address,
                    to: mockedAccounts['goerli'][1].address,
                    value: BigNumber.from('1'),
                },
                'blank'
            );

            await transactionController.addTransaction(
                {
                    from: mockedAccounts['goerli'][0].address,
                    to: mockedAccounts['goerli'][1].address,
                    value: BigNumber.from('1'),
                },
                'blank'
            );

            transactionController.store.updateState({
                transactions: [
                    transactionController.store.getState().transactions[0],
                    {
                        ...transactionController.store.getState()
                            .transactions[1],
                        chainId: 1,
                    },
                ],
            });

            expect(
                transactionController.store.getState().transactions.length
            ).to.be.equal(2);
            transactionController.wipeTransactions();

            expect(
                transactionController.store.getState().transactions.length
            ).to.be.equal(1);

            transactionController.wipeTransactions(true);
            expect(
                transactionController.store.getState().transactions.length
            ).to.be.equal(0);
        });

        it('Should determine different transaction categories correctly', async () => {
            sinon
                .stub(transactionController['_signatureRegistry'], 'lookup')
                .returns(Promise.resolve('multicall(bytes[] data)'));

            let { transactionCategory, methodSignature } =
                await transactionController.determineTransactionCategory({
                    to: mockedAccounts.goerli[0].address,
                    data: '0xa9059cbb000000000000000000000000e7327602980619ebe59e90becfb868d48603c4f500000000000000000000000000000000000000000000006194049f30f7200000',
                });

            expect(transactionCategory).to.be.equal(
                TransactionCategories.TOKEN_METHOD_TRANSFER
            );
            expect(methodSignature).to.be.undefined;

            ({ transactionCategory, methodSignature } =
                await transactionController.determineTransactionCategory({
                    data: '0x64b07f210000000000000000000000000000000000000000000000000000000000000001',
                }));

            expect(transactionCategory).to.be.equal(
                TransactionCategories.CONTRACT_DEPLOYMENT
            );
            expect(methodSignature).to.be.undefined;

            ({ transactionCategory, methodSignature } =
                await transactionController.determineTransactionCategory({
                    to: mockedAccounts.goerli[0].address,
                }));

            expect(transactionCategory).to.be.equal(
                TransactionCategories.SENT_ETHER
            );
            expect(methodSignature).to.be.undefined;

            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getCode: () => Promise.resolve('0x123'),
                });

            ({ transactionCategory, methodSignature } =
                await transactionController.determineTransactionCategory({
                    to: mockedAccounts.goerli[0].address,
                    data: '0xac9650d8',
                }));

            expect(transactionCategory).to.be.equal(
                TransactionCategories.CONTRACT_INTERACTION
            );
            expect(methodSignature?.name).to.be.equal('Multicall');
        });

        it('Should add default EIP-1559 parameters values on a supported network correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            let {
                transactionMeta: { transactionParams },
            } = await transactionController.addTransaction(
                {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                },
                'blank'
            );

            expect(transactionParams.gasPrice).to.be.undefined;
            expect(transactionParams.maxFeePerGas).to.not.be.undefined;
            expect(transactionParams.maxPriorityFeePerGas).to.not.be.undefined;

            expect(transactionParams.maxFeePerGas!.toString()).to.be.equal(
                '200000000000'
            );
            expect(
                transactionParams.maxPriorityFeePerGas!.toString()
            ).to.be.equal('1000000000');
        });

        it('Should cancel a EIP-1559 transaction correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    sendTransaction: ((rawTransaction: any) => {
                        return Promise.resolve({
                            hash: '0x6d4bd8f2381fe620ac08e48786ec3a6b66e06668663bd5557b6f4ef1c838689b',
                        });
                    }) as any,
                });

            const { transactionMeta } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts.goerli[0].address,
                        to: mockedAccounts.goerli[1].address,
                        value: BigNumber.from('1'),
                        maxFeePerGas: BigNumber.from('200000000000'),
                        maxPriorityFeePerGas: BigNumber.from('1000000000'),
                    },
                    'blank'
                );

            await transactionController.approveTransaction(transactionMeta.id);

            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    sendTransaction: ((rawTransaction: any) => {
                        return Promise.resolve({
                            hash: '0x4930060e5e465f32c78cea9d467b8d7e9176653cd0416040c44af404dac53fed',
                        });
                    }) as any,
                    getTransactionReceipt: (hash) => {
                        return hash ===
                            '0x4930060e5e465f32c78cea9d467b8d7e9176653cd0416040c44af404dac53fed'
                            ? Promise.resolve({
                                  status: '1',
                              })
                            : Promise.resolve(null);
                    },
                    getTransaction: (hash) => {
                        return hash ===
                            '0x4930060e5e465f32c78cea9d467b8d7e9176653cd0416040c44af404dac53fed'
                            ? Promise.resolve({
                                  blockNumber: 1,
                                  timestamp: new Date().getTime() / 1000,
                              })
                            : Promise.resolve(null);
                    },
                });

            await transactionController.cancelTransaction(transactionMeta.id);

            const promise = new Promise((resolve) => {
                transactionController.hub.once(
                    `${transactionMeta.id}:finished`,
                    (meta: TransactionMeta) => {
                        const { transactions } =
                            transactionController.store.getState();

                        expect(transactions.length).to.be.equal(2);
                        expect(transactions[0].id).to.be.equal(meta.id);
                        expect(transactions[0].status).to.be.equal(
                            TransactionStatus.CANCELLED
                        );
                        expect(transactions[1].status).to.be.equal(
                            TransactionStatus.CONFIRMED
                        );
                        expect(
                            transactions[1].transactionParams.value?.toString()
                        ).to.be.equal('0');
                        expect(
                            transactions[1].transactionParams.maxFeePerGas?.toString()
                        ).to.be.equal('300000000000');
                        expect(
                            transactions[1].transactionParams.maxPriorityFeePerGas?.toString()
                        ).to.be.equal('1500000000');

                        resolve('');
                    }
                );
            });

            await transactionController.queryTransactionStatuses(1);
            await transactionController.queryTransactionStatuses(2);

            return promise;
        });

        it('Should cancel a legacy pre EIP-1559 transaction correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            sinon
                .stub(gasPricesController, 'getEIP1559Compatibility')
                .returns(Promise.resolve(false));

            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    sendTransaction: ((rawTransaction: any) => {
                        return Promise.resolve({
                            hash: '0x6d4bd8f2381fe620ac08e48786ec3a6b66e06668663bd5557b6f4ef1c838689b',
                        });
                    }) as any,
                });

            const { transactionMeta } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts.goerli[0].address,
                        to: mockedAccounts.goerli[1].address,
                        value: BigNumber.from('1'),
                        gasPrice: BigNumber.from('1000000000'),
                    },
                    'blank'
                );

            await transactionController.approveTransaction(transactionMeta.id);

            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    sendTransaction: ((rawTransaction: any) => {
                        return Promise.resolve({
                            hash: '0x4930060e5e465f32c78cea9d467b8d7e9176653cd0416040c44af404dac53fed',
                        });
                    }) as any,
                    getTransactionReceipt: (hash) => {
                        return hash ===
                            '0x4930060e5e465f32c78cea9d467b8d7e9176653cd0416040c44af404dac53fed'
                            ? Promise.resolve({
                                  status: '1',
                              })
                            : Promise.resolve(null);
                    },
                    getTransaction: (hash) => {
                        return hash ===
                            '0x4930060e5e465f32c78cea9d467b8d7e9176653cd0416040c44af404dac53fed'
                            ? Promise.resolve({
                                  blockNumber: 1,
                                  timestamp: new Date().getTime() / 1000,
                              })
                            : Promise.resolve(null);
                    },
                });

            await transactionController.cancelTransaction(transactionMeta.id);

            const promise = new Promise((resolve) => {
                transactionController.hub.once(
                    `${transactionMeta.id}:finished`,
                    (meta: TransactionMeta) => {
                        const { transactions } =
                            transactionController.store.getState();

                        expect(transactions.length).to.be.equal(2);
                        expect(transactions[0].id).to.be.equal(meta.id);
                        expect(transactions[0].status).to.be.equal(
                            TransactionStatus.CANCELLED
                        );
                        expect(transactions[1].status).to.be.equal(
                            TransactionStatus.CONFIRMED
                        );
                        expect(
                            transactions[1].transactionParams.value?.toString()
                        ).to.be.equal('0');
                        expect(
                            transactions[1].transactionParams.gasPrice?.toString()
                        ).to.be.equal('1500000000');

                        resolve('');
                    }
                );
            });

            await transactionController.queryTransactionStatuses(1);
            await transactionController.queryTransactionStatuses(2);

            return promise;
        });

        it('Should speed up a EIP-1559 transaction correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            const { transactionMeta } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts.goerli[0].address,
                        to: mockedAccounts.goerli[1].address,
                        value: BigNumber.from('1'),
                        maxFeePerGas: BigNumber.from('200000000000'),
                        maxPriorityFeePerGas: BigNumber.from('1000000000'),
                    },
                    'blank'
                );

            await transactionController.speedUpTransaction(transactionMeta.id);

            const { transactions } = transactionController.store.getState();

            expect(transactions.length).to.be.equal(2);
            expect(
                transactions[1].transactionParams.maxFeePerGas?.toString()
            ).to.be.equal('220000000000');
            expect(
                transactions[1].transactionParams.maxPriorityFeePerGas?.toString()
            ).to.be.equal('1100000000');
        });

        it('Should speed up a legacy pre EIP-1559 transaction correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            sinon
                .stub(gasPricesController, 'getEIP1559Compatibility')
                .returns(Promise.resolve(false));

            const { transactionMeta, result } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts.goerli[0].address,
                        to: mockedAccounts.goerli[1].address,
                        value: BigNumber.from('1'),
                        gasPrice: BigNumber.from('1000000000'),
                    },
                    'blank'
                );

            await transactionController.speedUpTransaction(transactionMeta.id);

            const { transactions } = transactionController.store.getState();

            expect(transactions.length).to.be.equal(2);
            expect(
                transactions[1].transactionParams.gasPrice?.toString()
            ).to.be.equal('1100000000');
        });

        it('Should keep the transaction status as submitted while pending confirmation', async () => {
            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.SUBMITTED,
                transactionHash: '1338',
                blocksDropCount: 0,
                loadingGasValues: false,
                time: new Date().getTime(),
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.queryTransactionStatuses(1);
            expect(
                transactionController.store.getState().transactions[0].status
            ).to.be.equal(TransactionStatus.SUBMITTED);
        });

        it('Should transition to DROPPED a failed transaction with no transaction object response', async () => {
            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getTransactionReceipt: () =>
                        Promise.resolve({
                            status: '0',
                        }),
                });

            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.SUBMITTED,
                transactionHash: '1338',
                blocksDropCount: 0,
                loadingGasValues: false,
                time: new Date().getTime(),
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.queryTransactionStatuses(1);
            expect(
                transactionController.store.getState().transactions[0].status
            ).to.be.equal(TransactionStatus.DROPPED);
            expect(transactionController.store.getState().transactions[0].error)
                .to.not.be.undefined;
            expect(
                transactionController.store.getState().transactions[0].error
                    ?.message
            ).to.be.equal(
                'Transaction failed. The transaction was dropped or replaced by a new one'
            );
        });

        it('Should transition to CONFIRMED a transaction that was included in a block', async () => {
            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getTransaction: () =>
                        Promise.resolve({
                            blockNumber: 1,
                            timestamp: new Date().getTime() / 1000,
                        }),
                });

            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.SUBMITTED,
                transactionHash: '1338',
                blocksDropCount: 0,
                loadingGasValues: false,
                time: new Date().getTime(),
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.queryTransactionStatuses(1);
            expect(
                transactionController.store.getState().transactions[0].status
            ).to.be.equal(TransactionStatus.CONFIRMED);
            expect(
                transactionController.store.getState().transactions[0]
                    .confirmationTime
            ).to.not.be.undefined;
        });

        it('Should drop due to account nonce higher after N waiting blocks', async () => {
            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getTransactionCount: () => Promise.resolve(3),
                    getTransaction: () => undefined,
                });

            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.SUBMITTED,
                transactionHash: '1338',
                blocksDropCount: 4,
                loadingGasValues: false,
                time: new Date().getTime(),
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.queryTransactionStatuses(1);
            expect(
                transactionController.store.getState().transactions[0].status
            ).to.be.equal(TransactionStatus.DROPPED);
            expect(transactionController.store.getState().transactions[0].error)
                .to.not.be.undefined;
            expect(
                transactionController.store.getState().transactions[0].error
                    ?.message
            ).to.be.equal(
                'Transaction failed. The transaction was dropped or replaced by a new one'
            );
        });

        it('Should transition to FAILED a confirmed, but reverted transaction', async () => {
            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getTransactionReceipt: () =>
                        Promise.resolve({
                            status: '0',
                        }),
                });

            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.CONFIRMED,
                transactionHash: '1338',
                blocksDropCount: 0,
                loadingGasValues: false,
                time: new Date().getTime(),
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.queryTransactionStatuses(1);
            expect(
                transactionController.store.getState().transactions[0].status
            ).to.be.equal(TransactionStatus.FAILED);
            expect(transactionController.store.getState().transactions[0].error)
                .to.not.be.undefined;
            expect(
                transactionController.store.getState().transactions[0].error
                    ?.message
            ).to.be.equal('Transaction failed. The transaction was reversed');
            expect(
                transactionController.store.getState().transactions[0]
                    .verifiedOnBlockchain
            ).to.be.true;
            expect(
                transactionController.store.getState().transactions[0]
                    .transactionReceipt
            ).to.be.deep.equal({
                status: '0',
            });
        });

        it('Should keep transaction as SUBMITTED if privacy deposit confirmations has not been reached', async () => {
            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getTransaction: () =>
                        Promise.resolve({
                            blockNumber: 1,
                            timestamp: new Date().getTime() / 1000,
                        }),
                });

            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.SUBMITTED,
                blankDepositId: '11',
                transactionHash: '1338',
                blocksDropCount: 0,
                loadingGasValues: false,
                time: new Date().getTime(),
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.queryTransactionStatuses(2);
            expect(
                transactionController.store.getState().transactions[0].status
            ).to.be.equal(TransactionStatus.SUBMITTED);
        });

        it('Should transition transaction to CONFIRMED if privacy deposit confirmations has been reached', async () => {
            mockedProvider.restore();
            mockedProvider = sinon
                .stub(networkController, 'getProvider')
                .returns({
                    ...providerMock,
                    getTransaction: () =>
                        Promise.resolve({
                            blockNumber: 1,
                            timestamp: new Date().getTime() / 1000,
                        }),
                });

            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.SUBMITTED,
                blankDepositId: '11',
                transactionHash: '1338',
                blocksDropCount: 0,
                loadingGasValues: false,
                time: new Date().getTime(),
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.queryTransactionStatuses(5);
            expect(
                transactionController.store.getState().transactions[0].status
            ).to.be.equal(TransactionStatus.CONFIRMED);
        });

        it('Should allow transaction state to be greater than txHistorylimit due to speed up same nonce', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            transactionController.config = {
                txHistoryLimit: 1,
            };

            const { transactionMeta } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts.goerli[0].address,
                        to: mockedAccounts.goerli[1].address,
                        value: BigNumber.from('1'),
                        maxFeePerGas: BigNumber.from('200000000000'),
                        maxPriorityFeePerGas: BigNumber.from('1000000000'),
                    },
                    'blank'
                );

            await transactionController.speedUpTransaction(transactionMeta.id);

            const { transactions } = transactionController.store.getState();
            expect(transactions.length).to.be.equal(2);
        });

        it('Should keep transactions in history that are pending or unapproved', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            transactionController.config = {
                txHistoryLimit: 1,
            };

            const { transactionMeta } =
                await transactionController.addTransaction(
                    {
                        from: mockedAccounts.goerli[0].address,
                        to: mockedAccounts.goerli[1].address,
                        value: BigNumber.from('1'),
                        maxFeePerGas: BigNumber.from('200000000000'),
                        maxPriorityFeePerGas: BigNumber.from('1000000000'),
                    },
                    'blank'
                );
            await transactionController.approveTransaction(transactionMeta.id);

            await transactionController.addTransaction(
                {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('100'),
                    maxFeePerGas: BigNumber.from('200000000000'),
                    maxPriorityFeePerGas: BigNumber.from('1000000000'),
                },
                'blank'
            );

            const { transactions } = transactionController.store.getState();
            expect(transactions.length).to.be.equal(2);
        });

        it('Should remove transactions that exceed the txHistoryLimit correctly', async () => {
            sinon.stub(transactionController, 'estimateGas').returns(
                Promise.resolve({
                    estimationSucceeded: true,
                    gasLimit: BigNumber.from(SEND_GAS_COST),
                })
            );

            transactionController.config = {
                txHistoryLimit: 1,
            };

            transactionController.store.getState().transactions.push({
                id: '123',
                chainId: 5,
                status: TransactionStatus.CONFIRMED,
                blankDepositId: '11',
                transactionHash: '1338',
                blocksDropCount: 0,
                loadingGasValues: false,
                time: 1637199846373,
                transactionParams: {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('1'),
                    gasPrice: BigNumber.from('1000000000'),
                    nonce: 2,
                },
            } as TransactionMeta);

            await transactionController.addTransaction(
                {
                    from: mockedAccounts.goerli[0].address,
                    to: mockedAccounts.goerli[1].address,
                    value: BigNumber.from('100'),
                    maxFeePerGas: BigNumber.from('200000000000'),
                    maxPriorityFeePerGas: BigNumber.from('1000000000'),
                },
                'blank'
            );

            const { transactions } = transactionController.store.getState();
            expect(transactions.length).to.be.equal(1);
            expect(
                transactions[0].transactionParams.value?.toString()
            ).to.be.equal('100');
        });
    });
});
