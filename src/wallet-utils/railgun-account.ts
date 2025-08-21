import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { Wallet, Contract, JsonRpcProvider, Interface } from 'ethers';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import { getSharedSymmetricKey } from '../railgun-lib/utils/keys-utils';
import { hexToBytes } from 'ethereum-cryptography/utils';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { ABIRailgunSmartWallet } from '../railgun-lib/abi/abi';

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;
const RAILGUN_ADDRESS = '0x942D5026b421cf2705363A525897576cFAdA5964';

const getWalletNodeFromKey = (priv: string) => {
  const wallet = new Wallet(priv);
  return new WalletNode({chainKey: wallet.privateKey, chainCode: ''});
};

const getRailgunEventTopic = (eventName: string) => {
  const eventAbi = ABIRailgunSmartWallet.find(
    (item: any) => item.type === 'event' && item.name === eventName
  );
  if (!eventAbi) {
    throw new Error('Event ABI not found');
  }

  // Build the event topic
  const eventIface = new Interface([eventAbi]);
  const event = eventIface.getEvent(eventName);
  if (!event) {
    throw new Error('Event not found');
  }
  return {iface: eventIface, topic: event.topicHash};
}

const getAllLogs = async (provider: JsonRpcProvider, topic: string, startBlock: number, endBlock: number) => {
  const BATCH_SIZE = 500;
  let allLogs: any[] = [];
  for (let from = startBlock; from <= endBlock; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, endBlock);
    const logs = await provider.getLogs({
      address: RAILGUN_ADDRESS,
      fromBlock: from,
      toBlock: to,
      topics: [topic],
    });
    allLogs = allLogs.concat(logs);
  }
  return allLogs;
}

export default class RailgunAccount {

  private spending: WalletNode;
  private viewing: WalletNode;
  private shieldKeyEthSigner?: Wallet;

  constructor(spendingNode: WalletNode, viewingNode: WalletNode, ethSigner?: Wallet) {
    this.spending = spendingNode;
    this.viewing = viewingNode;
    this.shieldKeyEthSigner = ethSigner;
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

  setShieldKeyEthSigner(ethSigner: Wallet) {
    this.shieldKeyEthSigner = ethSigner;
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
    if (!this.shieldKeyEthSigner) {
      throw new Error('shield key eth signer not set');
    }
    const msg = ShieldNoteERC20.getShieldPrivateKeySignatureMessage();
    const signature = await this.shieldKeyEthSigner.signMessage(msg);
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

  async sendShieldNote(shieldNote: ShieldRequestStruct, signer: Wallet): Promise<string> {
    const contract = new Contract(RAILGUN_ADDRESS, ABIRailgunSmartWallet, signer);
    const tx = await contract.shield([shieldNote]);
    return tx.hash;
  }

  async scanShieldEvents(
    provider: JsonRpcProvider,
    startBlock: number,
    endBlock: number
  ): Promise<
    Array<{
      treeNumber: bigint;
      startPosition: bigint;
      commitments: any[];
      shieldCiphertext: any[];
      fees: bigint[];
      event: any;
    }>
  > {
    const {iface, topic} = getRailgunEventTopic('Shield');

    const logs = await getAllLogs(provider, topic, startBlock, endBlock);

    const results = [];
    for (const log of logs) {
      const parsed = iface.parseLog(log);
      if (!parsed) {
        continue;
      }
      results.push({
        treeNumber: parsed.args.treeNumber,
        startPosition: parsed.args.startPosition,
        commitments: parsed.args.commitments,
        shieldCiphertext: parsed.args.shieldCiphertext,
        fees: parsed.args.fees,
        event: log,
      });
    }
    return results;
  }

  async scanNullifiedEvents(
    provider: JsonRpcProvider,
    startBlock: number,
    endBlock: number
  ): Promise<
    Array<{
      treeNumber: bigint;
      nullifier: string[];
      event: any;
    }>
  > {
    const {iface, topic} = getRailgunEventTopic('Nullified');

    const logs = await getAllLogs(provider, topic, startBlock, endBlock);

    const results = [];
    for (const log of logs) {
      const parsed = iface.parseLog(log);
      if (!parsed) {
        continue;
      }
      results.push({
        treeNumber: parsed.args.treeNumber,
        nullifier: parsed.args.nullifier,
        event: log,
      });
    }
    return results;
  }

  async scanTransactEvents(
    provider: JsonRpcProvider,
    startBlock: number,
    endBlock: number
  ): Promise<
    Array<{
      treeNumber: bigint;
      startPosition: bigint;
      hash: string[];
      ciphertext: any[];
      event: any;
    }>
  > {
    const {iface, topic} = getRailgunEventTopic('Transact');

    const logs = await getAllLogs(provider, topic, startBlock, endBlock);

    const results = [];
    for (const log of logs) {
      const parsed = iface.parseLog(log);
      if (!parsed) {
        continue;
      }
      results.push({
        treeNumber: parsed.args.treeNumber,
        startPosition: parsed.args.startPosition,
        hash: parsed.args.hash,
        ciphertext: parsed.args.ciphertext,
        event: log,
      });
    }
    return results;
  }
}
