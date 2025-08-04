import { deriveNodes, WalletNode } from './railgun-lib/key-derivation/wallet-node';
import { encodeAddress, /*decodeAddress*/ } from './railgun-lib/key-derivation/bech32';

const MNEMONIC = 'test test test test test test test test test test test test';
const ACCOUNT_INDEX = 0;
const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;


async function main() {
  const {spending, viewing} = deriveNodes(MNEMONIC, ACCOUNT_INDEX);

  const {pubkey: spendingPubkey} = spending.getSpendingKeyPair();
  const {pubkey: viewingPubkey} = await viewing.getViewingKeyPair();
  const nullifyingKey = await viewing.getNullifyingKey();

  const masterPubkey = WalletNode.getMasterPublicKey(spendingPubkey, nullifyingKey);
  const address = encodeAddress({
    masterPublicKey: masterPubkey,
    viewingPublicKey: viewingPubkey,
    chain: ACCOUNT_CHAIN_ID,
    version: ACCOUNT_VERSION,
  });

  console.log('address:', address);
  // const check = decodeAddress(address);
  // console.log('match?', masterPubkey.toString() == check.masterPublicKey.toString());
  // console.log('match?', viewingPubkey.toString() == check.viewingPublicKey.toString());
}

main();