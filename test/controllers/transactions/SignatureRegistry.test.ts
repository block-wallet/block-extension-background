import sinon from 'sinon';
import { expect } from 'chai';
import { Contract } from '@ethersproject/contracts';

import { getNetworkControllerInstance } from '../../mocks/mock-network-instance';
import { SignatureRegistry } from '../../../src/controllers/transactions/SignatureRegistry';
import { mockPreferencesController } from '../../mocks/mock-preferences';
import axios from 'axios';

describe('Signature Registry', () => {
    let signatureRegistry: SignatureRegistry;

    beforeEach(() => {
        sinon.stub(Contract.prototype);
        signatureRegistry = new SignatureRegistry(
            getNetworkControllerInstance()
        );
    });

    afterEach(() => {
        sinon.restore();
    });

    it('Should lookup for a method signature correctly and default to contract registry', async () => {
        sinon
            .stub(axios, 'get')
            .callsFake(() => Promise.reject('Error fetching'));

        signatureRegistry['signatureRegistry'] = {
            entries: (_: string) =>
                Promise.resolve(['transfer(address,uint256)']),
        } as any;

        const signature = await signatureRegistry.lookup('0xa9059cbb');
        expect(signature).to.be.equal('transfer(address,uint256)');
    });

    it('Should try to lookup for a method signature with no response and default with 4bytes result', async () => {
        signatureRegistry['signatureRegistry'] = {
            entries: (_: string) => Promise.resolve(),
        } as any;

        sinon.stub(axios, 'get').callsFake(() =>
            Promise.resolve({
                data: {
                    count: 1,
                    results: [{ text_signature: 'transfer(address,uint256)' }],
                },
            })
        );

        const signature = await signatureRegistry.lookup('0xa9059cbb');
        expect(signature).to.be.equal('transfer(address,uint256)');
    });

    it('Should try to lookup for a method signature, throw and return undefined', async () => {
        sinon
            .stub(axios, 'get')
            .callsFake(() => Promise.reject('Error fetching'));

        signatureRegistry['signatureRegistry'] = {
            entries: (_: string) => Promise.reject(''),
        } as any;

        const signature = await signatureRegistry.lookup('0xa9059cbb');
        expect(signature).to.be.equal(undefined);
    });

    it('Should parse a signature correctly', () => {
        const sig = 'transfer(address,uint256)';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name).to.be.equal('Transfer');
        expect(parsed!.args).to.be.not.equal(undefined);
        expect(parsed!.args.length).to.be.equal(2);
        expect(parsed!.args[0].type).to.be.equal('address');
        expect(parsed!.args[1].type).to.be.equal('uint256');
    });

    it('Should parse a signature without arguments correctly', () => {
        const sig = 'drain()';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name).to.be.equal('Drain');
        expect(parsed!.args.length).to.be.equal(0);
    });

    it('Should parse $() dollar-sign signature correctly', () => {
        const sig = '$()';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name).to.be.equal('$');
        expect(parsed!.args.length).to.be.equal(0);
    });

    it('Should parse _() underscore signature correctly', () => {
        const sig = '_()';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name).to.be.equal('_');
        expect(parsed!.args.length).to.be.equal(0);
    });

    it('Should parse () fallback signature correctly', () => {
        const sig = '()';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name).to.be.equal('');
        expect(parsed!.args.length).to.be.equal(0);
    });

    it('Should add spaces to multi words on parsing correctly', () => {
        const sig = 'transferFrom(address,uint256)';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name, 'Transfer From');
        expect(parsed!.args.length).to.be.equal(2);
        expect(parsed!.args[0].type).to.be.equal('address');
        expect(parsed!.args[1].type).to.be.equal('uint256');
    });

    it('Should parse signature that includes a tuple as the first param correctly', () => {
        const sig = 'method((address,uint256,bytes),uint256,bytes)';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name, 'Method');
        expect(parsed!.args.length).to.be.equal(5);
        expect(parsed!.args[0].type).to.be.equal('address');
        expect(parsed!.args[1].type).to.be.equal('uint256');
        expect(parsed!.args[2].type).to.be.equal('bytes');
        expect(parsed!.args[3].type).to.be.equal('uint256');
        expect(parsed!.args[4].type).to.be.equal('bytes');
    });

    it('Should parse signature that includes a tuple of tuples correctly', () => {
        const sig = 'method(((address,uint256),(address,uint256)))';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name, 'Method');
        expect(parsed!.args.length).to.be.equal(4);
        expect(parsed!.args[0].type).to.be.equal('address');
        expect(parsed!.args[1].type).to.be.equal('uint256');
        expect(parsed!.args[2].type).to.be.equal('address');
        expect(parsed!.args[3].type).to.be.equal('uint256');
    });

    it('Should parse signature that includes a tuple as a middle param correctly', () => {
        const sig = 'method(uint256,(address,uint256,bytes),bytes)';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name, 'Method');
        expect(parsed!.args.length).to.be.equal(5);
        expect(parsed!.args[0].type).to.be.equal('uint256');
        expect(parsed!.args[1].type).to.be.equal('address');
        expect(parsed!.args[2].type).to.be.equal('uint256');
        expect(parsed!.args[3].type).to.be.equal('bytes');
        expect(parsed!.args[4].type).to.be.equal('bytes');
    });

    it('Should parse signature that includes a tuple as the last param correctly', () => {
        const sig = 'method(uint256,bytes,(address,uint256,bytes))';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name, 'Method');
        expect(parsed!.args.length).to.be.equal(5);
        expect(parsed!.args[0].type).to.be.equal('uint256');
        expect(parsed!.args[1].type).to.be.equal('bytes');
        expect(parsed!.args[2].type).to.be.equal('address');
        expect(parsed!.args[3].type).to.be.equal('uint256');
        expect(parsed!.args[4].type).to.be.equal('bytes');
    });

    it('Should parse signature that includes an array param correctly', () => {
        const sig = 'method(uint256[],string)';
        const parsed = signatureRegistry.parse(sig);

        expect(parsed!.name).to.be.equal('Method');
        expect(parsed!.args.length).to.be.equal(2);
        expect(parsed!.args[0].type).to.be.equal('uint256[]');
        expect(parsed!.args[1].type).to.be.equal('string');
    });
});
