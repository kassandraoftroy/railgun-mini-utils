import { bech32m } from '@scure/base';
import xor from 'buffer-xor';
import { ByteLength, ByteUtils } from '../utils/bytes';

const getChainFullNetworkID = (chain: Chain): string => {
    // 1 byte: chainType.
    const formattedChainType = ByteUtils.formatToByteLength(
      ByteUtils.hexlify(chain.type),
      ByteLength.UINT_8,
    );
    // 7 bytes: chainID.
    const formattedChainID = ByteUtils.formatToByteLength(
      ByteUtils.hexlify(chain.id),
      ByteLength.UINT_56,
    );
    return `${formattedChainType}${formattedChainID}`;
};

export enum ChainType {
  EVM = 0,
}
  
export type Chain = {
  type: ChainType;
  id: number;
};
  

export type AddressData = {
  masterPublicKey: bigint;
  viewingPublicKey: Uint8Array;
  chain?: Chain;
  version?: number;
};
const ADDRESS_LENGTH_LIMIT = 127;
const ADDRESS_VERSION = 1;
const ALL_CHAINS_NETWORK_ID = 'ffffffffffffffff';
const PREFIX = '0zk';

/**
 * @param chainID - hex value of chainID
 * @returns - chainID XOR'd with 'railgun' to make address prettier
 */
const xorNetworkID = (chainID: string) => {
  const chainIDBuffer = Buffer.from(chainID, 'hex');
  const railgunBuffer = Buffer.from('railgun', 'utf8');
  return xor(chainIDBuffer, railgunBuffer).toString('hex');
};

const chainToNetworkID = (chain: Chain | undefined): string => {
  if (chain == null) {
    return ALL_CHAINS_NETWORK_ID;
  }

  const networkID = getChainFullNetworkID(chain);
  return networkID;
};

const networkIDToChain = (networkID: string): Chain | undefined => {
  if (networkID === ALL_CHAINS_NETWORK_ID) {
    return undefined;
  }

  const chain: Chain = {
    type: parseInt(networkID.slice(0, 2), 16),
    id: parseInt(networkID.slice(2, 16), 16),
  };
  return chain;
};

const getChainFromChainID = (chainID: number): Chain => {
  return {
    type: ChainType.EVM,
    id: chainID,
  };
};

/**
 * Bech32 encodes address
 * @param addressData - AddressData to encode
 */
function encodeAddress(addressData: AddressData): string {
  const masterPublicKey = ByteUtils.nToHex(addressData.masterPublicKey, ByteLength.UINT_256, false);
  const viewingPublicKey = ByteUtils.formatToByteLength(addressData.viewingPublicKey, ByteLength.UINT_256);

  const { chain } = addressData;
  const networkID = xorNetworkID(chainToNetworkID(chain));
  const version = '01';

  const addressString = `${version}${masterPublicKey}${networkID}${viewingPublicKey}`;

  // Create 73 byte address buffer
  const addressBuffer = Buffer.from(addressString, 'hex');

  // Encode address
  const address = bech32m.encode(PREFIX, bech32m.toWords(addressBuffer), ADDRESS_LENGTH_LIMIT);

  return address;
}

/**
 * @param address - RAILGUN encoded address
 * @returns
 */
function decodeAddress(address: string): AddressData {
  try {
    if (!address) {
      throw new Error('No address to decode');
    }
    const [address0, address1] = address.split('1').map(str => str.trim());
    const decoded = bech32m.decode(`${address0}1${address1}`, ADDRESS_LENGTH_LIMIT);

    if (decoded.prefix !== PREFIX) {
      throw new Error('Invalid address prefix');
    }

    // Hexlify data
    const data = ByteUtils.hexlify(bech32m.fromWords(decoded.words));

    // Get version
    const version = parseInt(data.slice(0, 2), 16);
    const masterPublicKey = ByteUtils.hexToBigInt(data.slice(2, 66));
    const networkID = xorNetworkID(data.slice(66, 82));
    const viewingPublicKey = ByteUtils.hexStringToBytes(data.slice(82, 146));

    const chain: Chain | undefined = networkIDToChain(networkID);

    // Throw if address version is not supported
    if (version !== ADDRESS_VERSION) throw new Error('Incorrect address version');

    const result: AddressData = {
      masterPublicKey,
      viewingPublicKey,
      version,
      chain,
    };

    return result;
  } catch (cause) {
    if (cause instanceof Error && cause.message && cause.message.includes('Invalid checksum')) {
      throw new Error('Invalid checksum');
    }
    throw new Error('Failed to decode bech32 address');
  }
}

export { encodeAddress, decodeAddress, getChainFromChainID, ADDRESS_LENGTH_LIMIT, ALL_CHAINS_NETWORK_ID };
