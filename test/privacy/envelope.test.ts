import { describe, expect, it } from 'vitest'

import {
  ENCRYPTED_NOTE_V1_BYTES,
  encryptNoteEnvelopeV1,
  scanningKeyPairFromPrivateKey,
  scanNoteEnvelopeV1,
  type NoteEnvelopeContextV1,
} from '../../src/privacy/envelope.js'

const recipientPrivateKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const recipient = scanningKeyPairFromPrivateKey(recipientPrivateKey)
const note = { ownerPublic: 21n, rho: 22n, rseed: 23n }
const context: NoteEnvelopeContextV1 = {
  chainId: 19_803n,
  poolAddress: '0xd1e515000000000000000000000000000000fade',
  commitment:
    0x138a437bff4c19fd52f2787c6cb7cb466f97f374f8f3d0d66ee1da64559b46aan,
  outputOrdinal: 0,
}

function deterministicRandomBytes(): (length: number) => Uint8Array {
  let call = 0
  return (length) => {
    call += 1
    return Uint8Array.from({ length }, (_, i) => (i + call * 17) & 0xff)
  }
}

describe('encrypted note envelope V1', () => {
  it('round-trips exactly 169 bytes with an injected CSPRNG', async () => {
    const envelope = encryptNoteEnvelopeV1({
      note,
      recipientPublicKey: recipient.publicKey,
      context,
      randomBytes: deterministicRandomBytes(),
    })

    expect(envelope).toHaveLength(ENCRYPTED_NOTE_V1_BYTES)
    await expect(
      scanNoteEnvelopeV1(envelope, recipient.privateKey, context),
    ).resolves.toEqual(note)
  })

  it.each([
    ['chain ID', { chainId: context.chainId + 1n }],
    [
      'pool address',
      { poolAddress: '0xd1e515000000000000000000000000000000facf' },
    ],
    ['commitment', { commitment: context.commitment + 1n }],
    ['output ordinal', { outputOrdinal: 1 }],
  ] as const)(
    'treats %s AAD tampering as a scan miss',
    async (_name, patch) => {
      const envelope = encryptNoteEnvelopeV1({
        note,
        recipientPublicKey: recipient.publicKey,
        context,
        randomBytes: deterministicRandomBytes(),
      })

      await expect(
        scanNoteEnvelopeV1(envelope, recipient.privateKey, {
          ...context,
          ...patch,
        }),
      ).resolves.toBeNull()
    },
  )

  it('treats ciphertext corruption and the wrong scanning key as scan misses', async () => {
    const envelope = encryptNoteEnvelopeV1({
      note,
      recipientPublicKey: recipient.publicKey,
      context,
      randomBytes: deterministicRandomBytes(),
    })
    const corrupted = envelope.slice()
    corrupted[80] ^= 1
    const wrongKey = Uint8Array.from({ length: 32 }, (_, i) => i + 2)

    await expect(
      scanNoteEnvelopeV1(corrupted, recipient.privateKey, context),
    ).resolves.toBeNull()
    await expect(
      scanNoteEnvelopeV1(envelope, wrongKey, context),
    ).resolves.toBeNull()
  })

  it('rejects malformed envelopes without exposing secret material', async () => {
    await expect(
      scanNoteEnvelopeV1(new Uint8Array(168), recipient.privateKey, context),
    ).rejects.toThrow('invalid encrypted note envelope')
  })
})
