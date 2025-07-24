import { deriveNodes } from './key-derivation/wallet-node';
import { poseidon } from './utils/poseidon';
import { encodeAddress, /*decodeAddress*/ } from './key-derivation/bech32';

const MNEMONIC = 'test test test test test test test test test test test test';
const ACCOUNT_INDEX = 0;

async function main() {
  const {spending, viewing} = deriveNodes(MNEMONIC, ACCOUNT_INDEX);

  const {pubkey: [spendingPubX, spendingPubY]} = spending.getSpendingKeyPair();
  const {pubkey: viewingPubkey} = await viewing.getViewingKeyPair();
  const nullifyingKey = await viewing.getNullifyingKey();

  const masterPubkey = poseidon([spendingPubX, spendingPubY, nullifyingKey]);
  const address = encodeAddress({
    masterPublicKey: masterPubkey,
    viewingPublicKey: viewingPubkey,
    chain: undefined,
    version: 1,
  });

  console.log('address:', address);
  // const check = decodeAddress(address);
  // console.log('match?', masterPubkey.toString() == check.masterPublicKey.toString());
  // console.log('match?', viewingPubkey.toString() == check.viewingPublicKey.toString());
}

main();