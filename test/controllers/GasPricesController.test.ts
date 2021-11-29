import initialState from '@blank/background/utils/constants/initialState';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { GasPricesController } from '../../src/controllers/GasPricesController';
import NetworkController from '../../src/controllers/NetworkController';
import sinon from 'sinon';
import {
    TransactionMeta,
    TransactionStatus,
} from '@blank/background/controllers/transactions/utils/types';
import { getNetworkControllerInstance } from '../mocks/mock-network-instance';

describe('GasPrices Controller', () => {
    let gasPricesController: GasPricesController;
    let networkController: NetworkController;
    beforeEach(() => {
        networkController = getNetworkControllerInstance();

        gasPricesController = new GasPricesController(
            initialState.GasPricesController,
            networkController
        );
    });
    afterEach(function () {
        sinon.restore();
    });

    it('Should update the gas prices due to expiration policy', async () => {
        sinon.stub(gasPricesController, 'getEIP1599GasPriceLevels').returns(
            Promise.resolve({
                slow: {
                    maxFeePerGas: BigNumber.from('101'),
                    maxPriorityFeePerGas: BigNumber.from('102'),
                },
                average: {
                    maxFeePerGas: BigNumber.from('103'),
                    maxPriorityFeePerGas: BigNumber.from('104'),
                },
                fast: {
                    maxFeePerGas: BigNumber.from('105'),
                    maxPriorityFeePerGas: BigNumber.from('106'),
                },
            })
        );

        (gasPricesController as any).expiration = 1616620739553;

        await gasPricesController.updateGasPrices(5);

        const { gasPrices } =
            gasPricesController.store.getState().gasPriceData[5];

        expect(gasPrices.slow.maxFeePerGas!.toString()).to.be.equal('101');
        expect(gasPrices.slow.maxPriorityFeePerGas!.toString()).to.be.equal(
            '102'
        );
        expect(gasPrices.average.maxFeePerGas!.toString()).to.be.equal('103');
        expect(gasPrices.average.maxPriorityFeePerGas!.toString()).to.be.equal(
            '104'
        );
        expect(gasPrices.fast.maxFeePerGas!.toString()).to.be.equal('105');
        expect(gasPrices.fast.maxPriorityFeePerGas!.toString()).to.be.equal(
            '106'
        );
    });

    it('Should update the legacy gas prices due to price variation policy', async () => {
        gasPricesController.store.setState({
            gasPriceData: {
                5: {
                    gasPrices: {
                        average: { gasPrice: BigNumber.from('181000000000') },
                        fast: { gasPrice: BigNumber.from('165000000000') },
                        slow: { gasPrice: BigNumber.from('125000000000') },
                    },
                    isEIP1559Compatible: false,
                },
            },
        });

        // Check for average change
        gasPricesController.getGasPriceLevels = () =>
            Promise.resolve({
                average: { gasPrice: BigNumber.from('201000000000') },
                fast: { gasPrice: BigNumber.from('165000000000') },
                slow: { gasPrice: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        let { gasPrices } =
            gasPricesController.store.getState().gasPriceData[5];

        expect(gasPrices.average.gasPrice!.toString()).to.be.equal(
            '201000000000'
        );
        expect(gasPrices.fast.gasPrice!.toString()).to.be.equal('165000000000');
        expect(gasPrices.slow.gasPrice!.toString()).to.be.equal('125000000000');

        // Check for fast change
        (gasPricesController as any).getGasPriceLevels = () =>
            Promise.resolve({
                average: { gasPrice: BigNumber.from('201000000000') },
                fast: { gasPrice: BigNumber.from('185000000000') },
                slow: { gasPrice: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.gasPrice!.toString()).to.be.equal(
            '201000000000'
        );
        expect(gasPrices.fast.gasPrice!.toString()).to.be.equal('185000000000');
        expect(gasPrices.slow.gasPrice!.toString()).to.be.equal('125000000000');

        // Check for slow change
        (gasPricesController as any).getGasPriceLevels = () =>
            Promise.resolve({
                average: { gasPrice: BigNumber.from('201000000000') },
                fast: { gasPrice: BigNumber.from('185000000000') },
                slow: { gasPrice: BigNumber.from('145000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.gasPrice!.toString()).to.be.equal(
            '201000000000'
        );
        expect(gasPrices.fast.gasPrice!.toString()).to.be.equal('185000000000');
        expect(gasPrices.slow.gasPrice!.toString()).to.be.equal('145000000000');
    });

    it('Should not update the legacy gas prices due to policy', async () => {
        gasPricesController.store.setState({
            gasPriceData: {
                5: {
                    gasPrices: {
                        average: { gasPrice: BigNumber.from('181000000000') },
                        fast: { gasPrice: BigNumber.from('165000000000') },
                        slow: { gasPrice: BigNumber.from('125000000000') },
                    },
                    isEIP1559Compatible: false,
                },
            },
        });

        // Check for average change < 5%
        (gasPricesController as any).getGasPriceLevels = () =>
            Promise.resolve({
                average: { gasPrice: BigNumber.from('181000000001') },
                fast: { gasPrice: BigNumber.from('165000000000') },
                slow: { gasPrice: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        let { gasPrices } =
            gasPricesController.store.getState().gasPriceData[5];

        expect(gasPrices.average.gasPrice!.toString()).to.be.equal(
            '181000000000'
        );
        expect(gasPrices.fast.gasPrice!.toString()).to.be.equal('165000000000');
        expect(gasPrices.slow.gasPrice!.toString()).to.be.equal('125000000000');

        // Check for fast change
        (gasPricesController as any).getGasPriceLevels = () =>
            Promise.resolve({
                average: { gasPrice: BigNumber.from('181000000000') },
                fast: { gasPrice: BigNumber.from('165000000001') },
                slow: { gasPrice: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.gasPrice!.toString()).to.be.equal(
            '181000000000'
        );
        expect(gasPrices.fast.gasPrice!.toString()).to.be.equal('165000000000');
        expect(gasPrices.slow.gasPrice!.toString()).to.be.equal('125000000000');

        // Check for slow change
        (gasPricesController as any).getGasPriceLevels = () =>
            Promise.resolve({
                average: { gasPrice: BigNumber.from('181000000000') },
                fast: { gasPrice: BigNumber.from('165000000000') },
                slow: { gasPrice: BigNumber.from('125000000001') },
            });

        await (gasPricesController as any).updateGasPrices();
        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.gasPrice!.toString()).to.be.equal(
            '181000000000'
        );
        expect(gasPrices.fast.gasPrice!.toString()).to.be.equal('165000000000');
        expect(gasPrices.slow.gasPrice!.toString()).to.be.equal('125000000000');
    });

    it('Should update the EIP1559 gas prices due to price variation policy', async () => {
        gasPricesController.store.setState({
            gasPriceData: {
                5: {
                    gasPrices: {
                        average: {
                            maxPriorityFeePerGas:
                                BigNumber.from('181000000000'),
                        },
                        fast: {
                            maxPriorityFeePerGas:
                                BigNumber.from('165000000000'),
                        },
                        slow: {
                            maxPriorityFeePerGas:
                                BigNumber.from('125000000000'),
                        },
                    },
                    isEIP1559Compatible: true,
                },
            },
        });

        // Check for average change
        (gasPricesController as any).getEIP1599GasPriceLevels = () =>
            Promise.resolve({
                average: {
                    maxPriorityFeePerGas: BigNumber.from('201000000000'),
                },
                fast: { maxPriorityFeePerGas: BigNumber.from('165000000000') },
                slow: { maxPriorityFeePerGas: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();

        let gos =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        let { gasPrices } =
            gasPricesController.store.getState().gasPriceData[5];

        expect(gasPrices.average.maxPriorityFeePerGas!.toString()).to.be.equal(
            '201000000000'
        );
        expect(gasPrices.fast.maxPriorityFeePerGas!.toString()).to.be.equal(
            '165000000000'
        );
        expect(gasPrices.slow.maxPriorityFeePerGas!.toString()).to.be.equal(
            '125000000000'
        );

        // Check for fast change
        (gasPricesController as any).getEIP1599GasPriceLevels = () =>
            Promise.resolve({
                average: {
                    maxPriorityFeePerGas: BigNumber.from('201000000000'),
                },
                fast: { maxPriorityFeePerGas: BigNumber.from('185000000000') },
                slow: { maxPriorityFeePerGas: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.maxPriorityFeePerGas!.toString()).to.be.equal(
            '201000000000'
        );
        expect(gasPrices.fast.maxPriorityFeePerGas!.toString()).to.be.equal(
            '185000000000'
        );
        expect(gasPrices.slow.maxPriorityFeePerGas!.toString()).to.be.equal(
            '125000000000'
        );

        // Check for slow change
        (gasPricesController as any).getEIP1599GasPriceLevels = () =>
            Promise.resolve({
                average: {
                    maxPriorityFeePerGas: BigNumber.from('201000000000'),
                },
                fast: { maxPriorityFeePerGas: BigNumber.from('185000000000') },
                slow: { maxPriorityFeePerGas: BigNumber.from('145000000000') },
            });

        await (gasPricesController as any).updateGasPrices();

        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.maxPriorityFeePerGas!.toString()).to.be.equal(
            '201000000000'
        );
        expect(gasPrices.fast.maxPriorityFeePerGas!.toString()).to.be.equal(
            '185000000000'
        );
        expect(gasPrices.slow.maxPriorityFeePerGas!.toString()).to.be.equal(
            '145000000000'
        );
    }).timeout(10000);

    it('Should not update the EIP1559 gas prices due to policy', async () => {
        gasPricesController.store.setState({
            gasPriceData: {
                5: {
                    gasPrices: {
                        average: {
                            maxPriorityFeePerGas:
                                BigNumber.from('181000000000'),
                        },
                        fast: {
                            maxPriorityFeePerGas:
                                BigNumber.from('165000000000'),
                        },
                        slow: {
                            maxPriorityFeePerGas:
                                BigNumber.from('125000000000'),
                        },
                    },
                    isEIP1559Compatible: true,
                },
            },
        });

        // Check for average change < 5%
        (gasPricesController as any).getEIP1599GasPriceLevels = () =>
            Promise.resolve({
                average: {
                    maxPriorityFeePerGas: BigNumber.from('181000000001'),
                },
                fast: { maxPriorityFeePerGas: BigNumber.from('165000000000') },
                slow: { maxPriorityFeePerGas: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        let { gasPrices } =
            gasPricesController.store.getState().gasPriceData[5];

        expect(gasPrices.average.maxPriorityFeePerGas!.toString()).to.be.equal(
            '181000000000'
        );
        expect(gasPrices.fast.maxPriorityFeePerGas!.toString()).to.be.equal(
            '165000000000'
        );
        expect(gasPrices.slow.maxPriorityFeePerGas!.toString()).to.be.equal(
            '125000000000'
        );

        // Check for fast change
        (gasPricesController as any).getEIP1599GasPriceLevels = () =>
            Promise.resolve({
                average: {
                    maxPriorityFeePerGas: BigNumber.from('181000000000'),
                },
                fast: { maxPriorityFeePerGas: BigNumber.from('165000000001') },
                slow: { maxPriorityFeePerGas: BigNumber.from('125000000000') },
            });

        await (gasPricesController as any).updateGasPrices();
        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.maxPriorityFeePerGas!.toString()).to.be.equal(
            '181000000000'
        );
        expect(gasPrices.fast.maxPriorityFeePerGas!.toString()).to.be.equal(
            '165000000000'
        );
        expect(gasPrices.slow.maxPriorityFeePerGas!.toString()).to.be.equal(
            '125000000000'
        );

        // Check for slow change
        (gasPricesController as any).getEIP1599GasPriceLevels = () =>
            Promise.resolve({
                average: {
                    maxPriorityFeePerGas: BigNumber.from('181000000000'),
                },
                fast: { maxPriorityFeePerGas: BigNumber.from('165000000000') },
                slow: { maxPriorityFeePerGas: BigNumber.from('125000000001') },
            });

        await (gasPricesController as any).updateGasPrices();
        gasPrices =
            gasPricesController.store.getState().gasPriceData[5].gasPrices;

        expect(gasPrices.average.maxPriorityFeePerGas!.toString()).to.be.equal(
            '181000000000'
        );
        expect(gasPrices.fast.maxPriorityFeePerGas!.toString()).to.be.equal(
            '165000000000'
        );
        expect(gasPrices.slow.maxPriorityFeePerGas!.toString()).to.be.equal(
            '125000000000'
        );
    });

    it('Should detect EIP1559 compatibility properly', async function () {
        await gasPricesController.updateEIP1559Compatibility();
        expect(
            gasPricesController.store.getState().gasPriceData[5]
                .isEIP1559Compatible
        ).to.be.true;
    }).timeout(100000);

    it('Should transform legacy gas price to EIP1559 format', async () => {
        await networkController.setNetwork('goerli');
        await gasPricesController.updateEIP1559Compatibility();

        const transactionMeta: TransactionMeta = {
            id: '1',
            status: TransactionStatus.UNAPPROVED,
            time: new Date().getTime(),
            loadingGasValues: false,
            transactionParams: {
                gasPrice: BigNumber.from(100),
            },
            blocksDropCount: 0,
        };

        await gasPricesController.transformLegacyGasPriceToEIP1559FeeData(
            transactionMeta
        );

        expect(transactionMeta).to.be.not.null;
        expect(transactionMeta).to.be.not.undefined;
        expect(transactionMeta.transactionParams).to.be.not.undefined;

        expect(transactionMeta.transactionParams.maxPriorityFeePerGas).to.be.not
            .undefined;
        expect(transactionMeta.transactionParams.maxFeePerGas).to.be.not
            .undefined;
        expect(transactionMeta.transactionParams.gasPrice).to.be.undefined;

        expect(
            transactionMeta.transactionParams.maxPriorityFeePerGas?.eq(
                BigNumber.from(100)
            )
        ).equal(true);
        expect(
            transactionMeta.transactionParams.maxFeePerGas?.eq(
                BigNumber.from(100)
            )
        ).equal(true);
    });

    it('Should not transform legacy gas price to EIP1559 format - network incompatible', async () => {
        sinon
            .stub(NetworkController.prototype, 'getEIP1559Compatibility')
            .returns(Promise.resolve(false));

        await networkController.setNetwork('goerli');
        await gasPricesController.updateEIP1559Compatibility();

        const transactionMeta: TransactionMeta = {
            id: '1',
            status: TransactionStatus.UNAPPROVED,
            time: new Date().getTime(),
            loadingGasValues: false,
            transactionParams: {
                gasPrice: BigNumber.from(100),
            },
            blocksDropCount: 0,
        };

        gasPricesController.transformLegacyGasPriceToEIP1559FeeData(
            transactionMeta
        );

        expect(transactionMeta).to.be.not.null;
        expect(transactionMeta).to.be.not.undefined;
        expect(transactionMeta.transactionParams).to.be.not.undefined;

        expect(transactionMeta.transactionParams.maxPriorityFeePerGas).to.be
            .undefined;
        expect(transactionMeta.transactionParams.maxFeePerGas).to.be.undefined;
        expect(transactionMeta.transactionParams.gasPrice).to.be.not.undefined;

        expect(
            transactionMeta.transactionParams.gasPrice?.eq(BigNumber.from(100))
        ).equal(true);
    });

    it('Should not transform legacy gas price to EIP1559 format - transaction already EIP1559', async () => {
        await networkController.setNetwork('goerli');
        await gasPricesController.updateEIP1559Compatibility();

        const transactionMeta: TransactionMeta = {
            id: '1',
            status: TransactionStatus.UNAPPROVED,
            time: new Date().getTime(),
            loadingGasValues: false,
            transactionParams: {
                maxPriorityFeePerGas: BigNumber.from(100),
                maxFeePerGas: BigNumber.from(100),
            },
            blocksDropCount: 0,
        };

        gasPricesController.transformLegacyGasPriceToEIP1559FeeData(
            transactionMeta
        );

        expect(transactionMeta).to.be.not.null;
        expect(transactionMeta).to.be.not.undefined;
        expect(transactionMeta.transactionParams).to.be.not.undefined;

        expect(transactionMeta.transactionParams.maxPriorityFeePerGas).to.be.not
            .undefined;
        expect(transactionMeta.transactionParams.maxFeePerGas).to.be.not
            .undefined;
        expect(transactionMeta.transactionParams.gasPrice).to.be.undefined;

        expect(
            transactionMeta.transactionParams.maxPriorityFeePerGas?.eq(
                BigNumber.from(100)
            )
        ).equal(true);
        expect(
            transactionMeta.transactionParams.maxFeePerGas?.eq(
                BigNumber.from(100)
            )
        ).equal(true);
    });
});
