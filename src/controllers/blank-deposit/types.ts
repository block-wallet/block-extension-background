/* eslint-disable @typescript-eslint/no-explicit-any */
import TornadoConfig from './tornado/config/config';
const instances = TornadoConfig.deployments.netId1;

/**
 * List of known supported networks
 */
export enum AvailableNetworks {
    MAINNET = 'mainnet',
    GOERLI = 'goerli',
}

/**
 * List of known supported currencies
 */
export enum KnownCurrencies {
    ETH = 'eth',
    DAI = 'dai',
    cDAI = 'cdai',
    USDC = 'usdc',
    USDT = 'usdt',
    WBTC = 'wbtc',
}

/**
 * Defines a type that types the currency with the available amount types
 */
export type CurrencyAmountType = {
    [key in KnownCurrencies]: keyof typeof instances[key]['instanceAddress'];
};

/**
 * Type to match currencies with their specific
 * available deposits.
 *
 * FIXME: Change it to { currency: KnownCurrencies, amount: string }
 * when scaling supported currencies
 */
export type CurrencyAmountPair =
    | {
          currency: KnownCurrencies.ETH;
          amount: CurrencyAmountType[KnownCurrencies.ETH];
      }
    | {
          currency: KnownCurrencies.DAI;
          amount: CurrencyAmountType[KnownCurrencies.DAI];
      }
    | {
          currency: KnownCurrencies.cDAI;
          amount: CurrencyAmountType[KnownCurrencies.cDAI];
      }
    | {
          currency: KnownCurrencies.USDC;
          amount: CurrencyAmountType[KnownCurrencies.USDC];
      }
    | {
          currency: KnownCurrencies.USDT;
          amount: CurrencyAmountType[KnownCurrencies.USDT];
      }
    | {
          currency: KnownCurrencies.WBTC;
          amount: CurrencyAmountType[KnownCurrencies.WBTC];
      };

/**
 * Generic Currency/Amount dictionary type
 */
export type CurrencyAmountDict<T> = {
    [currency in KnownCurrencies]: {
        [amount in CurrencyAmountType[currency]]: T;
    };
};

/**
 * Blank deposits type organized by Currency and Amount
 */
export type AvailableBlankDeposits = CurrencyAmountDict<{
    count: number;
}>;

export enum DepositStatus {
    FAILED = 'FAILED',
    PENDING = 'PENDING',
    CONFIRMED = 'CONFIRMED',
}

type CurrencyAmountArrayType = {
    [ccy in KnownCurrencies]: CurrencyAmountType[ccy][];
};
/**
 * CurrencyAmountArray
 */
export const CurrencyAmountArray: CurrencyAmountArrayType = Object.keys(
    instances
).reduce((pv, cv) => {
    const currency = cv as KnownCurrencies;
    if (Object.values(KnownCurrencies).includes(currency)) {
        pv[currency] = Object.keys(
            instances[currency].instanceAddress
        ).sort() as any[];
    }
    return pv;
}, {} as CurrencyAmountArrayType);
