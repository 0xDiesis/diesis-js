/** BN254 scalar-field modulus used by Circom and Groth16 public signals. */
export const BN254_SCALAR_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

export type RandomBytes = (length: number) => Uint8Array

export function assertFieldElement(value: bigint): bigint {
  if (value < 0n || value >= BN254_SCALAR_R) {
    throw new RangeError('value is not a canonical field element')
  }
  return value
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

export function fieldToBytes(value: bigint): Uint8Array {
  assertFieldElement(value)
  const bytes = new Uint8Array(32)
  let remaining = value
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return bytes
}

export function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('random byte length must be a non-negative integer')
  }
  if (globalThis.crypto?.getRandomValues === undefined) {
    throw new Error('secure random source unavailable')
  }
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

export function randomNonzeroFieldElement(
  randomBytes: RandomBytes = secureRandomBytes,
): bigint {
  for (;;) {
    const sample = randomBytes(32)
    if (sample.length !== 32) {
      throw new Error('random source returned an invalid byte length')
    }
    const value = bytesToBigInt(sample)
    if (value > 0n && value < BN254_SCALAR_R) return value
  }
}
