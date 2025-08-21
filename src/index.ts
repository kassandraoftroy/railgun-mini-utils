import { RailgunAccount } from './wallet-utils';
import { ByteUtils } from './railgun-lib/utils/bytes';
import dotenv from 'dotenv';
import storedEvents from '../storedEvents.json';
// import { Wallet, JsonRpcProvider } from 'ethers';
// import fs from 'fs';


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

  // 2. scan events

  // const startBlock = 9024458;
  // const endBlock = 9026688;
  // const provider = new JsonRpcProvider(RPC_URL);
  // const events = await railgunAccount.scanShieldEvents(provider, startBlock, endBlock);
  // console.log('shield events found:', events.length);

  const shieldEvents = storedEvents.events.shield;
  console.log('shield events found:', shieldEvents.length);
  console.log('example event:', shieldEvents[0]);
}

main();