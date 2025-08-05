import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress, /*decodeAddress*/ } from '../railgun-lib/key-derivation/bech32';

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;

export default class RailgunAccount {

  private spending: WalletNode;
  private viewing: WalletNode;

  constructor(mnemonic: string, accountIndex: number) {
    const {spending, viewing} = deriveNodes(mnemonic, accountIndex);
    this.spending = spending;
    this.viewing = viewing;
  }


  async getAddress() {
    const {pubkey: spendingPubkey} = this.spending.getSpendingKeyPair();
    const {pubkey: viewingPubkey} = await this.viewing.getViewingKeyPair();
    const nullifyingKey = await this.viewing.getNullifyingKey();
  
    const masterPubkey = WalletNode.getMasterPublicKey(spendingPubkey, nullifyingKey);
    const address = encodeAddress({
      masterPublicKey: masterPubkey,
      viewingPublicKey: viewingPubkey,
      chain: ACCOUNT_CHAIN_ID,
      version: ACCOUNT_VERSION,
    });

    return address;
  }
}
