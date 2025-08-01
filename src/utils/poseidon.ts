/// <reference path="../../types/types.d.ts" />
import circom from '@railgun-community/circomlibjs';
import { ByteLength, ByteUtils } from './bytes';

interface PoseidonModule {
  default?: () => Promise<void>;
  poseidon?: (args: Array<bigint>) => bigint;
  poseidonHex?: (args: Array<string>) => string;
}

const { default: initPoseidonWasm, poseidon: poseidonWasm, poseidonHex: poseidonHexWasm } =
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  (require('@railgun-community/poseidon-hash-wasm')) as PoseidonModule;

const initPoseidon = (): Promise<void> => {
  try {
    // Try WASM implementation.
    return typeof initPoseidonWasm === 'function' ? initPoseidonWasm() : Promise.resolve();
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from initPoseidon');
    }
    // Fallback to Javascript. No init needed.
    return Promise.resolve();
  }
};
export const initPoseidonPromise = initPoseidon();

export const poseidon = (args: Array<bigint>): bigint => {
  if (!poseidonWasm) {
    // Fallback to JavaScript if this module is running directly in React Native
    return circom.poseidon(args);
  }
  try {
    // Try WASM implementation.
    return poseidonWasm(args);
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from poseidon');
    }
    // Fallback to Javascript.
    return circom.poseidon(args);
  }
};

export const poseidonHex = (args: Array<string>): string => {
  if (!poseidonHexWasm) {
    return ByteUtils.nToHex(
      circom.poseidon(args.map((x) => ByteUtils.hexToBigInt(x))),
      ByteLength.UINT_256,
    );
  }
  try {
    // We need to strip 0x prefix from hex strings before passing to WASM,
    // however, let's first make sure we actually need to do this, to avoid
    // creating an unnecessary copy of the array (via `map`)
    const needsStripping = args.some((arg) => arg.startsWith('0x'));
    const strippedArgs = needsStripping ? args.map((x) => ByteUtils.strip0x(x)) : args;
    return ByteUtils.padToLength(poseidonHexWasm(strippedArgs), ByteLength.UINT_256) as string;
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from poseidonHex');
    }
    // Fallback to Javascript.
    return ByteUtils.nToHex(
      circom.poseidon(args.map((x) => ByteUtils.hexToBigInt(x))),
      ByteLength.UINT_256,
    );
  }
};