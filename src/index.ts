import { RailgunAccount } from './account-utils';
import { ByteUtils } from './railgun-lib/utils/bytes';
import dotenv from 'dotenv';
import { /*Wallet,*/ JsonRpcProvider } from 'ethers';
import cached from '../cached.json';
import { Cache } from './account-utils/railgun-account';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config();
const MNEMONIC = process.env.MNEMONIC || 'test test test test test test test test test test test test';
const ACCOUNT_INDEX = Number(process.env.ACCOUNT_INDEX) || 0;
const RPC_URL = process.env.RPC_URL || '';
const TX_SIGNER_PK = process.env.TX_SIGNER_PK || '';

const TOKEN = '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e';
const VALUE = 10000000000000n;

async function main() {
  const railgunAccount = RailgunAccount.fromMnemonic(MNEMONIC, ACCOUNT_INDEX);
  const zkAddress = await railgunAccount.getRailgunAddress();

  console.log('0zk address:', zkAddress);

  const random = ByteUtils.randomHex(16);
  const encodedShieldNote = await railgunAccount.getEncodedShieldNote(TOKEN, VALUE, random);
  
  const checkRandomness = await railgunAccount.decryptShieldNoteRandomness(encodedShieldNote);

  console.log('check randomness:', checkRandomness==random);

  // 1. send a shield note

  // const txSigner = new Wallet(TX_SIGNER_PK, new JsonRpcProvider(RPC_URL));
  // const txHash = await railgunAccount.sendShieldNote(encodedShieldNote, txSigner);
  // console.log('tx:', txHash);

  const provider = new JsonRpcProvider(RPC_URL);

  await railgunAccount.init();

  const toCache = await railgunAccount.sync(provider, [RailgunAccount.getERC20TokenData(TOKEN)], cached as unknown as Cache);
  fs.writeFileSync('cached.json', JSON.stringify(toCache, null, 2));

  console.log("number of cached receipts:", toCache.receipts.length);
  console.log("last block:", toCache.endBlock);

  const balance = await railgunAccount.getBalance(TOKEN);
  console.log("balance:", balance);

  const notes = await railgunAccount.getAllNotes();
  console.log("number of notes:", notes.length);

  const unspentNotes = await railgunAccount.getUnspentNotes(TOKEN);
  console.log("number of unspent notes:", unspentNotes.length);

  const tokens = await railgunAccount.getAllTokens();
  console.log("number of tokens:", tokens.length);
}

main();