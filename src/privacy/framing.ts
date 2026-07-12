import { keccak_256 } from '@noble/hashes/sha3.js'
import { concatBytes } from '@noble/hashes/utils.js'

import { BN254_SCALAR_R, bytesToBigInt } from './field.js'

const U32_MAX = 0xffff_ffff

export function u32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
    throw new RangeError('value does not fit uint32')
  }
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, false)
  return result
}

/** Length-prefix a domain tag and ordered byte parts without ambiguity. */
export function frame(
  tag: Uint8Array,
  parts: readonly Uint8Array[],
): Uint8Array {
  return concatBytes(
    u32be(tag.length),
    tag,
    u32be(parts.length),
    ...parts.flatMap((part) => [u32be(part.length), part]),
  )
}

/** Hash the canonical frame into the BN254 scalar field. */
export function h2f(tag: Uint8Array, parts: readonly Uint8Array[]): bigint {
  return bytesToBigInt(keccak_256(frame(tag, parts))) % BN254_SCALAR_R
}
