declare module 'circomlibjs' {
  interface PoseidonField {
    toObject(value: unknown): bigint
  }

  interface Poseidon {
    (inputs: readonly bigint[]): unknown
    F: PoseidonField
  }

  export function buildPoseidon(): Promise<Poseidon>
}

declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: unknown,
      wasm: Uint8Array,
      zkey: Uint8Array,
    ): Promise<{
      proof: import('./prover.js').Groth16Proof
      publicSignals: string[]
    }>
    verify(
      verificationKey: unknown,
      publicSignals: readonly string[],
      proof: import('./prover.js').Groth16Proof,
    ): Promise<boolean>
  }
}
