import { expect } from 'chai';
import NetworkController from '../../src/controllers/NetworkController';
import { ethers } from 'ethers';
import { getNetworkControllerInstance } from '../mocks/mock-network-instance';

describe('Network controller', function () {
    let networkController: NetworkController;

    beforeEach(function () {
        networkController = getNetworkControllerInstance();
    });

    it('should get and set selected network', async function () {
        networkController.selectedNetwork = 'goerli';
        expect(networkController.selectedNetwork).to.equal('goerli');

        networkController.selectedNetwork = 'mainnet';
        expect(networkController.selectedNetwork).to.equal('mainnet');
    });

    it('should init properly', async function () {
        await networkController.waitUntilNetworkLoaded();

        let network = await networkController.getNetwork();
        expect(network.name).to.equal('goerli');
    });

    it('should set and get network', async function () {
        await networkController.setNetwork('mainnet');
        let network = await networkController.getNetwork();
        expect(network.name).to.equal('homestead');
    }).timeout(100000);

    it('should get a real provider', async function () {
        const provider = networkController.getProvider();
        expect(networkController.getProvider()).to.be.instanceOf(
            ethers.providers.StaticJsonRpcProvider
        );
    });

    it('should add and remove block listeners', async function () {
        networkController.getProvider().on('block', () => {});
        expect(
            networkController.getProvider().listenerCount('block')
        ).not.equal(0);
        networkController.getProvider().removeAllListeners('block');
        expect(networkController.getProvider().listenerCount('block')).equal(0);
    });

    it('should get the latest block', async function () {
        await networkController.setNetwork('mainnet');
        expect(
            (await networkController.getLatestBlock()).number
        ).to.be.greaterThan(12556240);
    }).timeout(30000);
});
