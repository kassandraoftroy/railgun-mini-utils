import { RailgunAccount, RAILGUN_ADDRESS } from './account-utils';
import { ByteUtils } from './railgun-lib/utils/bytes';
import dotenv from 'dotenv';
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import cached from '../cached.json';
import { Cache } from './account-utils/railgun-account';

// load environment variables from .env file
dotenv.config();
const MNEMONIC = process.env.MNEMONIC || 'test test test test test test test test test test test junk';
const ACCOUNT_INDEX = Number(process.env.ACCOUNT_INDEX) || 0;
const RPC_URL = process.env.RPC_URL || '';
const TX_SIGNER_KEY = process.env.TX_SIGNER_KEY || '';

const TOKEN = '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e'; // WETH
const VALUE = 10000000000000n; // 0.00001 ETH

async function main() {
  console.log("\n ///// RAILGUN SEPOLIA DEMO /////\n");

  // 1. instantiate account from mnemonic
  const railgunAccount = RailgunAccount.fromMnemonic(MNEMONIC, ACCOUNT_INDEX);
  await railgunAccount.init();

  // 2. get railgun 0zk address
  const zkAddress = await railgunAccount.getRailgunAddress();
  console.log('0zk address:', zkAddress);

  // 3. sync account and display state
  if (RPC_URL === '') {
    console.error("\nERROR: RPC_URL not set");
    process.exit(1);
  }
  const provider = new JsonRpcProvider(RPC_URL);
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) !== 11155111) {
    console.error(`\nERROR: wrong chain provider (expect chainId 11155111, got: ${Number(chainId)})`);
    process.exit(1);
  }

  const {endBlock: lastSyncedBlock} = await railgunAccount.sync(provider, 0, cached as unknown as Cache);
  const balance = await railgunAccount.getBalance(TOKEN);
  console.log("private WETH balance:", balance);
  const root = railgunAccount.getMerkleRoot();
  console.log("root:", ByteUtils.hexlify(root, true));

  // 4. create shield tx data
  const encodedShieldNote = await railgunAccount.createShieldTx(TOKEN, VALUE);

  // 5. do shield tx(s)
  if (TX_SIGNER_KEY === '') {
    console.error("\nERROR: TX_SIGNER_KEY not set");
    process.exit(1);
  }
  const txSigner = new Wallet(TX_SIGNER_KEY, provider);

  // wrap ETH
  const tokenContract = new Contract(TOKEN, ["function approve(address, uint256) external returns(bool)", "function deposit() external payable"], txSigner);
  const depositTx = await tokenContract.deposit({value: VALUE});
  console.log("wrap ETH tx:", depositTx.hash);
  await provider.waitForTransaction(depositTx.hash);

  // approve WETH
  const approveTx = await tokenContract.approve(RAILGUN_ADDRESS, VALUE);
  console.log("approve WETH tx:", approveTx.hash);
  await provider.waitForTransaction(approveTx.hash);

  // shield WETH
  const shieldTxHash = await railgunAccount.submitShieldTx(encodedShieldNote, txSigner);
  console.log('shield WETH tx:', shieldTxHash);
  await provider.waitForTransaction(shieldTxHash);

  // 6. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  const {endBlock: lastSyncedBlock2} = await railgunAccount.sync(provider, lastSyncedBlock);
  const balance2 = await railgunAccount.getBalance(TOKEN);
  console.log("new private WETH balance:", balance2);
  const root2 = railgunAccount.getMerkleRoot();
  console.log("new root:", ByteUtils.hexlify(root2, true));

  // 7. create unshield tx data
  const txParams = await railgunAccount.createUnshieldTx(TOKEN, VALUE/2n, txSigner.address);

  // 8. do unshield tx
  const unshieldTxHash = await railgunAccount.submitTransactTx([txParams], txSigner);
  console.log("unshield tx:", unshieldTxHash);
  await provider.waitForTransaction(unshieldTxHash);

  // 9. refresh account, show new balance and merkle root
  await new Promise(resolve => setTimeout(resolve, 2000));
  await railgunAccount.sync(provider, lastSyncedBlock2);
  const balance3 = await railgunAccount.getBalance(TOKEN);
  console.log("new private WETH balance:", balance3);
  const root3 = railgunAccount.getMerkleRoot();
  console.log("new root:", ByteUtils.hexlify(root3, true));

  // exit (because prover hangs)
  setImmediate(() => process.exit(0));
}

main();