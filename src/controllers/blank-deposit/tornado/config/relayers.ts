import { AvailableNetworks } from '../../types';

const relayers: { [network in AvailableNetworks]: string } = {
    goerli: 'goerli-relayer.blockwallet.io',
    mainnet: 'mainnet-relayer.blockwallet.io',
};

export default relayers;
