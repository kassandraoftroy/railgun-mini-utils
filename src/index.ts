import { RailgunAccount, RAILGUN_ADDRESS } from './account-utils';
import { ByteUtils } from './railgun-lib/utils/bytes';
import dotenv from 'dotenv';
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import cached from '../cached.json';
import { Cache } from './account-utils/railgun-account';
// import fs from 'fs';

// Load environment variables from .env file
dotenv.config();
const MNEMONIC = process.env.MNEMONIC || 'test test test test test test test test test test test test';
const ACCOUNT_INDEX = Number(process.env.ACCOUNT_INDEX) || 0;
const RPC_URL = process.env.RPC_URL || '';
const TX_SIGNER_KEY = process.env.TX_SIGNER_KEY || '';

const TOKEN = '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e';
const VALUE = 10000000000000n;

async function main() {
  if (RPC_URL === '') {
    console.log("WARN: RPC_URL not set, script will fail");
  }
  if (TX_SIGNER_KEY === '') {
    console.log("WARN: TX_SIGNER_KEY not set, script will fail");
  }
  const provider = new JsonRpcProvider(RPC_URL);

  // 1. instantiate account from mnemonic
  const railgunAccount = RailgunAccount.fromMnemonic(MNEMONIC, ACCOUNT_INDEX);
  await railgunAccount.init();

  // 2. get railgun 0zk address
  const zkAddress = await railgunAccount.getRailgunAddress();
  console.log('0zk address:', zkAddress);

  // 3. sync account and display state
  const {endBlock} = await railgunAccount.sync(provider, undefined, cached as unknown as Cache);
  const balance = await railgunAccount.getBalance(TOKEN);
  console.log("private WETH balance:", balance);
  const root = railgunAccount.getMerkleRoot();
  console.log("root:", ByteUtils.hexlify(root, true));

  // 4. create shield tx data
  const encodedShieldNote = await railgunAccount.getEncodedShieldNote(TOKEN, VALUE);

  // 5. do shield tx
  const txSigner = new Wallet(TX_SIGNER_KEY, provider);

  // acquire WETH and approve WETH
  const tokenContract = new Contract(TOKEN, ["function approve(address, uint256) external returns(bool)", "function deposit() external payable"], txSigner);
  const depositTx = await tokenContract.deposit({value: VALUE});
  console.log("wrap eth tx:", depositTx.hash);
  await provider.waitForTransaction(depositTx.hash);

  const approveTx = await tokenContract.approve(RAILGUN_ADDRESS, VALUE);
  console.log("approve WETH tx:", approveTx.hash);
  await provider.waitForTransaction(approveTx.hash);

  // shield WETH
  const shieldTxHash = await railgunAccount.sendShieldNote(encodedShieldNote, txSigner);
  console.log('shield WETH tx:', shieldTxHash);
  await provider.waitForTransaction(shieldTxHash);

  // 6. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  const {endBlock: endBlock2} = await railgunAccount.sync(provider, endBlock);
  const balance2 = await railgunAccount.getBalance(TOKEN);
  console.log("new private WETH balance:", balance2);
  const root2 = railgunAccount.getMerkleRoot();
  console.log("new root:", ByteUtils.hexlify(root2, true));

  // 7. create unshield tx data
  const txParams = await railgunAccount.createUnshieldTx(TOKEN, VALUE/2n, txSigner.address);

  // 8. do unshield tx
  const unshieldTxHash = await railgunAccount.sendTransact(txParams, txSigner);
  console.log("unshield hash:", unshieldTxHash);
  await provider.waitForTransaction(unshieldTxHash);

  // 9. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  await railgunAccount.sync(provider, endBlock2);
  const balance3 = await railgunAccount.getBalance(TOKEN);
  console.log("new private weth balance:", balance3);
  const root3 = railgunAccount.getMerkleRoot();
  console.log("new root:", ByteUtils.hexlify(root3, true));

  // exit (prover hangs)
  setImmediate(() => process.exit(0));
}

main();