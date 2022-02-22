import { isCurrencyCodeValid } from '@blank/background/utils/currency';
import { expect } from 'chai';

describe('Currency tests', () => {
    it('should return that the currency is not valid', () => {
        expect(isCurrencyCodeValid('NOT_VALID')).to.be.false;
    });
    it('should return that the currency is valid', () => {
        expect(isCurrencyCodeValid('USD')).to.be.true;
    });
});
