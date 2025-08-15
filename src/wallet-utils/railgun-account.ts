import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { Wallet } from 'ethers';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import { getSharedSymmetricKey } from '../railgun-lib/utils/keys-utils';
import { hexToBytes } from 'ethereum-cryptography/utils';
import { keccak256 } from 'ethereum-cryptography/keccak';

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;

const getWalletNodeFromKey = (priv: string) => {
  const wallet = new Wallet(priv);
  return new WalletNode({chainKey: wallet.privateKey, chainCode: ''});
};

export default class RailgunAccount {

  private spending: WalletNode;
  private viewing: WalletNode;
  private ethSigner?: Wallet;

  constructor(spendingNode: WalletNode, viewingNode: WalletNode, ethSigner?: Wallet) {
    this.spending = spendingNode;
    this.viewing = viewingNode;
    this.ethSigner = ethSigner;
  }

  static fromMnemonic(mnemonic: string, accountIndex: number): RailgunAccount {
    const {spending, viewing} = deriveNodes(mnemonic, accountIndex);
    const ethSigner = new Wallet(Mnemonic.to0xPrivateKey(mnemonic, accountIndex));
    return new RailgunAccount(spending, viewing, ethSigner);
  }

  static fromPrivateKeys(spendingKey: string, viewingKey: string, ethKey?: string): RailgunAccount {
    const spendingNode = getWalletNodeFromKey(spendingKey);
    const viewingNode = getWalletNodeFromKey(viewingKey);
    const ethSigner = ethKey ? new Wallet(ethKey) : undefined;
    return new RailgunAccount(spendingNode, viewingNode, ethSigner);
  }

  setEthSigner(ethSigner: Wallet) {
    this.ethSigner = ethSigner;
  }

  async getRailgunAddress(): Promise<string> {
    const {pubkey: viewingPubkey} = await this.viewing.getViewingKeyPair();
    const masterPubkey = await this.getMasterPublicKey();
    
    const address = encodeAddress({
      masterPublicKey: masterPubkey,
      viewingPublicKey: viewingPubkey,
      chain: ACCOUNT_CHAIN_ID,
      version: ACCOUNT_VERSION,
    });

    return address;
  }

  async getMasterPublicKey(): Promise<bigint> {
    const {pubkey: spendingPubkey} = this.spending.getSpendingKeyPair();
    const nullifyingKey = await this.viewing.getNullifyingKey();
    return WalletNode.getMasterPublicKey(spendingPubkey, nullifyingKey);
  }

  async getShieldPrivateKey(): Promise<Uint8Array> {
    if (!this.ethSigner) {
      throw new Error('Eth signer not set');
    }
    const msg = ShieldNoteERC20.getShieldPrivateKeySignatureMessage();
    const signature = await this.ethSigner.signMessage(msg);
    const signatureBytes = ByteUtils.hexStringToBytes(signature);
    return keccak256(signatureBytes);
  }

  async decryptShieldNoteRandomness(shieldNote: ShieldRequestStruct): Promise<string> {
    const bundle = shieldNote.ciphertext.encryptedBundle.map(String) as [string, string, string];
    const shieldKey = String(shieldNote.ciphertext.shieldKey);
    const {privateKey: viewingPrivateKey} = await this.viewing.getViewingKeyPair();

    const sharedKey = await getSharedSymmetricKey(viewingPrivateKey, hexToBytes(shieldKey));
    if (!sharedKey) {
      throw new Error('Failed to get shared key');
    }
    return ShieldNoteERC20.decryptRandom(bundle, sharedKey);
  }

  async getEncodedShieldNote(token: string, value: bigint, random: string): Promise<ShieldRequestStruct> {
    const shieldNote = await this.getShieldNote(token, value, random);
    const request = await this.encodeShieldNote(shieldNote);
    return request;
  }

  async getShieldNote(token: string, value: bigint, random: string): Promise<ShieldNoteERC20> {
    const masterPubkey = await this.getMasterPublicKey();
    return new ShieldNoteERC20(masterPubkey, random, value, token);
  }

  async encodeShieldNote(shieldNote: ShieldNoteERC20): Promise<ShieldRequestStruct> {
    const shieldPrivateKey = await this.getShieldPrivateKey();
    const {pubkey: viewingPubkey} = await this.viewing.getViewingKeyPair();
    return shieldNote.serialize(shieldPrivateKey, viewingPubkey);
  }
}
