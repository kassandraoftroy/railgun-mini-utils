declare module '@railgun-community/circomlibjs' {
  export const eddsa: {
    prv2pub: (privateKey: Buffer) => [bigint, bigint];
    signPoseidon: (privateKey: Buffer, message: bigint) => Signature;
    verifyPoseidon: (message: bigint, signature: Signature, pubkey: [bigint, bigint]) => boolean;
  };

  export const poseidon: (args: Array<bigint>) => bigint;
  
  export interface Signature {
    R8: [bigint, bigint];
    S: bigint;
  }
} 