import { RailgunAccount } from './wallet-utils';
import { ByteUtils } from './railgun-lib/utils/bytes';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();
const RPC_URL = process.env.RPC_URL || 'https://rpc.ankr.com/sepolia';
const MNEMONIC = process.env.MNEMONIC || 'test test test test test test test test test test test test';
const ACCOUNT_INDEX = Number(process.env.ACCOUNT_INDEX) || 0;

const TOKEN = '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e';
const VALUE = 10000000000000n;

async function main() {
  const railgunAccount = new RailgunAccount(MNEMONIC, ACCOUNT_INDEX, RPC_URL);
  const zkAddress = await railgunAccount.getRailgunAddress();

  console.log('0zk address:', zkAddress);

  const random = ByteUtils.randomHex(16);
  const encodedShieldNote = await railgunAccount.getEncodedShieldNote(TOKEN, VALUE, random);
  
  const checkRandomness = await railgunAccount.decryptShieldNoteRandomness(encodedShieldNote);

  console.log('check randomness:', checkRandomness==random);
}

main();