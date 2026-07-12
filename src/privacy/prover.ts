import type {
  LoadedPrivacyArtifactsV1,
  PrivacyCircuitIdV1,
} from './artifacts.js'
import { assertFieldElement } from './field.js'

const BN254_BASE_Q =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n
const UINT256_LIMIT = 1n << 256n

export interface Groth16Proof {
  protocol: string
  curve: string
  pi_a: readonly string[]
  pi_b: readonly (readonly string[])[]
  pi_c: readonly string[]
}

export interface PrivacyProofRequest {
  witness: Readonly<Record<string, unknown>>
  wasm: Uint8Array
  zkey: Uint8Array
  verificationKey: unknown
}

export interface PrivacyProofEngineResult {
  proof: Groth16Proof
  publicSignals: readonly string[]
  verified: boolean
}

export interface PrivacyProofEngine {
  proveAndVerify(
    request: PrivacyProofRequest,
  ): Promise<PrivacyProofEngineResult>
}

export interface BuiltCircuitWitnessV1 {
  witness: Readonly<Record<string, unknown>>
  publicSignals: readonly bigint[]
}

export interface PrivacyProofV1 {
  proof: Groth16Proof
  proofBytes: Uint8Array
  publicSignals: readonly bigint[]
}

function proofCoordinate(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('invalid proof coordinate')
  }
  const coordinate = BigInt(value)
  if (coordinate >= BN254_BASE_Q || coordinate >= UINT256_LIMIT) {
    throw new Error('invalid proof coordinate')
  }
  return coordinate
}

function writeUint256(target: Uint8Array, offset: number, value: bigint): void {
  let remaining = value
  for (let index = offset + 31; index >= offset; index -= 1) {
    target[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
}

export function encodeGroth16Proof(proof: Groth16Proof): Uint8Array {
  if (
    proof.protocol !== 'groth16' ||
    proof.curve !== 'bn128' ||
    proof.pi_a.length < 2 ||
    proof.pi_b.length < 2 ||
    proof.pi_b[0]!.length < 2 ||
    proof.pi_b[1]!.length < 2 ||
    proof.pi_c.length < 2
  ) {
    throw new Error('invalid Groth16 proof')
  }
  // Solidity verifier calldata reverses each Fq2 pair relative to snarkjs.
  const coordinates = [
    proof.pi_a[0]!,
    proof.pi_a[1]!,
    proof.pi_b[0]![1]!,
    proof.pi_b[0]![0]!,
    proof.pi_b[1]![1]!,
    proof.pi_b[1]![0]!,
    proof.pi_c[0]!,
    proof.pi_c[1]!,
  ].map(proofCoordinate)
  const encoded = new Uint8Array(256)
  coordinates.forEach((coordinate, index) =>
    writeUint256(encoded, index * 32, coordinate),
  )
  return encoded
}

function parsePublicSignals(signals: readonly string[]): bigint[] {
  return signals.map((signal) => {
    if (!/^(0|[1-9][0-9]*)$/.test(signal)) {
      throw new Error('prover returned an invalid public signal')
    }
    return assertFieldElement(BigInt(signal))
  })
}

async function proveCircuitV1(
  circuitId: PrivacyCircuitIdV1,
  artifacts: LoadedPrivacyArtifactsV1,
  statement: BuiltCircuitWitnessV1,
  engine: PrivacyProofEngine,
): Promise<PrivacyProofV1> {
  if (artifacts.manifest.circuit.id !== circuitId) {
    throw new Error('proof artifact circuit mismatch')
  }
  if (artifacts.publicSignals.length !== statement.publicSignals.length) {
    throw new Error('proof public layout mismatch')
  }
  statement.publicSignals.forEach(assertFieldElement)
  const result = await engine.proveAndVerify({
    witness: statement.witness,
    wasm: artifacts.wasm.slice(),
    zkey: artifacts.zkey.slice(),
    verificationKey: artifacts.verificationKey,
  })
  const returnedSignals = parsePublicSignals(result.publicSignals)
  if (
    returnedSignals.length !== statement.publicSignals.length ||
    returnedSignals.some(
      (signal, index) => signal !== statement.publicSignals[index],
    )
  ) {
    throw new Error('prover public signals mismatch')
  }
  if (!result.verified) throw new Error('local proof verification failed')
  return {
    proof: result.proof,
    proofBytes: encodeGroth16Proof(result.proof),
    publicSignals: [...statement.publicSignals],
  }
}

export function proveTransferV1({
  artifacts,
  statement,
  engine,
}: {
  artifacts: LoadedPrivacyArtifactsV1
  statement: BuiltCircuitWitnessV1
  engine: PrivacyProofEngine
}): Promise<PrivacyProofV1> {
  return proveCircuitV1('transfer-v1', artifacts, statement, engine)
}

export function proveWithdrawalV1({
  artifacts,
  statement,
  engine,
}: {
  artifacts: LoadedPrivacyArtifactsV1
  statement: BuiltCircuitWitnessV1
  engine: PrivacyProofEngine
}): Promise<PrivacyProofV1> {
  return proveCircuitV1('withdraw-v1', artifacts, statement, engine)
}

export function proveAssociationV1({
  artifacts,
  statement,
  engine,
}: {
  artifacts: LoadedPrivacyArtifactsV1
  statement: BuiltCircuitWitnessV1
  engine: PrivacyProofEngine
}): Promise<PrivacyProofV1> {
  return proveCircuitV1('association-v1', artifacts, statement, engine)
}
