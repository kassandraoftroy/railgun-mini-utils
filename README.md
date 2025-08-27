# railgun-mini-utils

simplified railgun typescript utils, borrowing code from internals of [railgun-community/engine](https://github.com/railgun-community/engine) and [railgun-privacy/contract](https://github.com/railgun-privacy/contract) (the helpers)

code in `src/railgun-lib` was forked 1:1 from the engine repo at commit `3ae608337095046d926aabc3cb0eda2f1507cc8d` with a few small compatibility edits marked with `!EDIT` comments

## Setup

clone repo, then

```
npm i
```

## Demo

fill `.env` file with `RPC_URL` (a sepolia RPC) and `TX_SIGNER_KEY` (0x prefixed private key of an EOA funded with at least 0.1 sepolia ETH)


```
npm start
```

runs a demo of end-to-end shield and unshield operations on sepolia testnet

## Tests

run

```
npm test
```