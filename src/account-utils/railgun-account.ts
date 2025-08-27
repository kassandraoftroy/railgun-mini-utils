import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { Wallet, Contract, JsonRpcProvider, TransactionReceipt } from 'ethers';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import { getSharedSymmetricKey } from '../railgun-lib/utils/keys-utils';
import { hexToBytes } from 'ethereum-cryptography/utils';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { ABIRailgunSmartWallet } from '../railgun-lib/abi/abi';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun-logic/logic/wallet';
import { Note, TokenData, UnshieldNote } from '../railgun-logic/logic/note';
import { transact, PublicInputs } from '../railgun-logic/logic/transaction';

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;
export const RAILGUN_ADDRESS = '0x942D5026b421cf2705363A525897576cFAdA5964';
const GLOBAL_START_BLOCK = 4495479;
const CHAIN_ID = BigInt(11155111);

export interface Cache {
  receipts: TransactionReceipt[];
  endBlock: number;
}

const getWalletNodeFromKey = (priv: string) => {
  const wallet = new Wallet(priv);
  return new WalletNode({chainKey: wallet.privateKey, chainCode: ''});
};

const getAllReceipts = async (provider: JsonRpcProvider, startBlock: number, endBlock: number) => {
  const BATCH_SIZE = 500;
  let allLogs: any[] = [];
  for (let from = startBlock; from <= endBlock; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, endBlock);
    const logs = await provider.getLogs({
      address: RAILGUN_ADDRESS,
      fromBlock: from,
      toBlock: to,
    });
    allLogs = allLogs.concat(logs);
  }
  const TXIDs = Array.from(new Set(allLogs.map(log => log.transactionHash)));
  const receipts: TransactionReceipt[] = [];
  for (const txID of TXIDs) {
    const receipt = await provider.getTransactionReceipt(txID);
    if (receipt) {
      receipts.push(receipt);
    }
  }

  return receipts;
}

export default class RailgunAccount {

  private spendingNode: WalletNode;
  private viewingNode: WalletNode;
  private shieldKeyEthSigner?: Wallet;
  private merkleTree?: MerkleTree;
  private noteBook?: NoteBook;

  constructor(spendingNode: WalletNode, viewingNode: WalletNode, ethSigner?: Wallet) {
    this.spendingNode = spendingNode;
    this.viewingNode = viewingNode;
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

  setShieldKeyEthSigner(ethKey: string) {
    this.shieldKeyEthSigner = new Wallet(ethKey);
  }

  async init() {
    const {privateKey: viewingKey} = await this.viewingNode.getViewingKeyPair();
    const {privateKey: spendingKey} = this.spendingNode.getSpendingKeyPair();
    this.merkleTree = await MerkleTree.createTree();
    this.noteBook = new NoteBook(spendingKey, viewingKey);
  }

  async sync(provider: JsonRpcProvider, startBlock: number = GLOBAL_START_BLOCK, cached?: Cache) {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }

    const startingBlock = cached ? cached.endBlock : startBlock;
    const endBlock = await provider.getBlockNumber();

    const newReceipts = await getAllReceipts(provider, startingBlock, endBlock);
    const receipts = cached ? Array.from(new Set(cached.receipts.concat(newReceipts))) : newReceipts;

    for (const receipt of receipts) {
      await this.noteBook.scanTX(receipt, RAILGUN_ADDRESS);
      await this.merkleTree.scanTX(receipt, RAILGUN_ADDRESS);
    }

    return {
      receipts,
      endBlock
    };
  }

  async getRailgunAddress(): Promise<string> {
    const {pubkey: viewingPubkey} = await this.viewingNode.getViewingKeyPair();
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
    const {pubkey: spendingPubkey} = this.spendingNode.getSpendingKeyPair();
    const nullifyingKey = await this.viewingNode.getNullifyingKey();
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
    const {privateKey: viewingPrivateKey} = await this.viewingNode.getViewingKeyPair();

    const sharedKey = await getSharedSymmetricKey(viewingPrivateKey, hexToBytes(shieldKey));
    if (!sharedKey) {
      throw new Error('Failed to get shared key');
    }
    return ShieldNoteERC20.decryptRandom(bundle, sharedKey);
  }

  async getEncodedShieldNote(token: string, value: bigint): Promise<ShieldRequestStruct> {
    const shieldNote = await this.createShieldNote(token, value);
    const request = await this.encodeShieldNote(shieldNote);
    return request;
  }

  async createShieldNote(token: string, value: bigint): Promise<ShieldNoteERC20> {
    const masterPubkey = await this.getMasterPublicKey();
    return new ShieldNoteERC20(masterPubkey, ByteUtils.randomHex(16), value, token);
  }

  async encodeShieldNote(shieldNote: ShieldNoteERC20): Promise<ShieldRequestStruct> {
    const shieldPrivateKey = await this.getShieldPrivateKey();
    const {pubkey: viewingPubkey} = await this.viewingNode.getViewingKeyPair();
    return shieldNote.serialize(shieldPrivateKey, viewingPubkey);
  }

  async sendShieldNote(shieldNote: ShieldRequestStruct, signer: Wallet): Promise<string> {
    const contract = new Contract(RAILGUN_ADDRESS, ABIRailgunSmartWallet, signer);
    const tx = await contract.shield([shieldNote]);
    return tx.hash;
  }

  async sendTransact(input: PublicInputs, signer: Wallet): Promise<string> {
    const contract = new Contract(RAILGUN_ADDRESS, ABIRailgunSmartWallet, signer);
    const tx = await contract.transact([input]);
    return tx.hash;
  }

  async getBalance(token: string): Promise<bigint> {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }
    const tokenData = {
      tokenType: 0,
      tokenAddress: token,
      tokenSubID: 0n,
    };
    return this.noteBook.getBalance(this.merkleTree, tokenData);
  }

  async createUnshieldTx(token: string, value: bigint, unshieldAddress: string): Promise<PublicInputs> {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }

    const unspentNotes = await this.getUnspentNotes(token);

    let totalValue = 0n;
    let notesIn: Note[] = [];
    for (const note of unspentNotes) {
      totalValue += note.value;
      notesIn.push(note);
      if (totalValue >= value) {
        break;
      }
    }

    if (totalValue < value) {
      throw new Error('insufficient value in unspent notes');
    }

    const tokenData = {
      tokenType: 0,
      tokenAddress: token,
      tokenSubID: 0n,
    };

    const leftover = totalValue - value;
    const outputNotes: (Note | UnshieldNote)[] = [];
    if (leftover > 0n) { 
      const changeNote = new Note(this.noteBook.spendingKey, this.noteBook.viewingKey, leftover, ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)), tokenData, '');
      outputNotes.push(changeNote);
    }

    outputNotes.push(new UnshieldNote(unshieldAddress, value, tokenData));

    const txParams = await transact(
      this.merkleTree,
      BigInt(0), // min gas price
      1, // unshield type
      CHAIN_ID,
      '0x0000000000000000000000000000000000000000', // adapt contract
      new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]), // adapt params
      notesIn,
      outputNotes,
    );

    return txParams;

  }

  async getAllNotes(): Promise<Note[]> {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }
    return this.noteBook.notes;
  }

  async getUnspentNotes(token: string): Promise<Note[]> {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }
    const tokenData = {
      tokenType: 0,
      tokenAddress: token,
      tokenSubID: 0n,
    };
    return this.noteBook.getUnspentNotes(this.merkleTree, tokenData);
  }

  static getERC20TokenData(token: string): TokenData {
    const tokenData = {
      tokenType: 0,
      tokenAddress: token,
      tokenSubID: 0n,
    };
    return tokenData;
  }

  getMerkleRoot() {
    if (!this.merkleTree) {
      throw new Error('not initialized');
    }
    return this.merkleTree.root;
  }
}
