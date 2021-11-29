import { CurrencyAmountPair } from '../types';
import { IBlankDeposit } from '../BlankDeposit';
import { INoteDeposit } from './INoteDeposit';

export interface INotesService {
    /**
     * It fetches new possible deposits that the user may have done
     */
    getNextFreeDeposit(currencyAmountPair: CurrencyAmountPair): Promise<{
        nextDeposit: {
            spent?: boolean | undefined;
            deposit: INoteDeposit;
            pair: CurrencyAmountPair;
        };
        recoveredDeposits?: IBlankDeposit[];
    }>;

    /**
     * reconstruct
     *
     * Deterministically reconstruct the user's notes from the seed phrase
     *
     * @param mnemonic The account mnemonic
     */
    reconstruct(
        mnemonic: string,
        lastDepositIndex?: number
    ): Promise<PromiseSettledResult<IBlankDeposit[]>[]>;

    /**
     * Returns a note string from a deposit
     *
     * @param deposit The deposit
     */
    getNoteString(deposit: IBlankDeposit, chainId: number): Promise<string>;

    /**
     * Checks for possible spent notes and updates its internal state
     *
     * @param unspentDeposits The unspent deposits list
     */
    updateUnspentNotes(
        unspentDeposits: IBlankDeposit[]
    ): Promise<IBlankDeposit[]>;
}
