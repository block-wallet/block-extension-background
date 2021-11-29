import { AvailableNetworks } from '../../types';

const relayers: { [network in AvailableNetworks]: string } = {
    goerli: 'goerli-relayer.goblank.io',
    mainnet: 'mainnet-relayer.goblank.io',
};

export default relayers;
