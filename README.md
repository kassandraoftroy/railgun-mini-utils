# railgun-mini-utils

railgun typescript utils, simplified fork of aspects of [railgun-community/engine](https://github.com/railgun-community/engine) repo.

for now: just key derivation and 0zk address encoding from mnemonic.

## Usage

clone repo

```
npm install
```

```
npm start
```

change `MNEMONIC` constant in `src/index.ts` and see that it encodes 0zk address in a way that matches your railgun enabled wallet client.