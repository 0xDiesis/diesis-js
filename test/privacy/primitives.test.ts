import { describe, expect, it } from 'vitest'

import {
  BN254_SCALAR_R,
  assertFieldElement,
  fieldToBytes,
} from '../../src/privacy/field.js'
import { frame, h2f } from '../../src/privacy/framing.js'
import {
  createNoteV1,
  deriveCommitmentV1,
  deriveNullifierV1,
  deriveOwnerPublicV1,
} from '../../src/privacy/note.js'

const hex = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'))

describe('privacy field and framing primitives', () => {
  it('rejects non-canonical BN254 scalar values', () => {
    expect(assertFieldElement(0n)).toBe(0n)
    expect(assertFieldElement(BN254_SCALAR_R - 1n)).toBe(BN254_SCALAR_R - 1n)
    expect(() => assertFieldElement(-1n)).toThrow(/canonical field element/)
    expect(() => assertFieldElement(BN254_SCALAR_R)).toThrow(
      /canonical field element/,
    )
  })

  it('encodes field elements as exact 32-byte big-endian values', () => {
    expect(fieldToBytes(0x0102n)).toEqual(hex(`0x${'00'.repeat(30)}0102`))
  })

  it('matches the canonical transfer-context H2F vector', () => {
    const tag = new TextEncoder().encode('diesis/privacy/transfer-context/v1')
    const parts = [
      hex(`0x${'00'.repeat(30)}4d5b`),
      hex('0xd1e515000000000000000000000000000000fade'),
      hex('0x00000001'),
    ]
    const expectedFrame = hex(
      '0x000000226469657369732f707269766163792f7472616e736665722d636f6e746578742f763100000003000000200000000000000000000000000000000000000000000000000000000000004d5b00000014d1e515000000000000000000000000000000fade0000000400000001',
    )

    expect(frame(tag, parts)).toEqual(expectedFrame)
    expect(h2f(tag, parts)).toBe(
      0x21a0e5bad5fdf099897cf32daea6eb22f0fdcda4adbeec3d290a9680239d2e03n,
    )
  })
})

describe('privacy note primitives', () => {
  it('keeps owner derivation separate from note randomness', async () => {
    const spendSecret = 1n
    expect(await deriveOwnerPublicV1(spendSecret)).toBe(
      0x2e09e2f88f01af6208f261c2dd50fccfb667dabba567e3e99f062599c94cfadcn,
    )
  })

  it('matches canonical commitment and nullifier vectors', async () => {
    const commitment = await deriveCommitmentV1({
      ownerPublic: 0x15n,
      rho: 0x16n,
      rseed: 0x17n,
    })
    const nullifier = await deriveNullifierV1({
      spendSecret: 0x1fn,
      rho: 0x20n,
      rseed: 0x21n,
    })

    expect(commitment).toBe(
      0x138a437bff4c19fd52f2787c6cb7cb466f97f374f8f3d0d66ee1da64559b46aan,
    )
    expect(nullifier).toBe(
      0x1c023c74cad59e028893c14183e3a75c09d58c1c63bb17ecb65886894e4667b9n,
    )
  })

  it('uses the injected CSPRNG and rejects zero samples', async () => {
    const samples = [new Uint8Array(32), fieldToBytes(22n), fieldToBytes(23n)]
    let calls = 0
    const note = await createNoteV1(21n, (length) => {
      expect(length).toBe(32)
      return samples[calls++]!
    })

    expect(note).toEqual({ ownerPublic: 21n, rho: 22n, rseed: 23n })
    expect(calls).toBe(3)
  })
})
