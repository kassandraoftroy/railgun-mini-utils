import { RailgunAccount } from './wallet-utils';

const MNEMONIC = 'test test test test test test test test test test test test';
const ACCOUNT_INDEX = 0;

async function main() {
  const railgunWallet = new RailgunAccount(MNEMONIC, ACCOUNT_INDEX);
  const address = await railgunWallet.getAddress();

  console.log('address:', address);
}

main();