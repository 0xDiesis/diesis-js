import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes } from '@noble/hashes/utils.js'

import {
  assertFieldElement,
  bytesToBigInt,
  fieldToBytes,
  secureRandomBytes,
  type RandomBytes,
} from './field.js'
import { frame, u32be } from './framing.js'
import { assertNoteV1, deriveCommitmentV1, type NoteV1 } from './note.js'

const ENVELOPE_VERSION_V1 = 1
const PRIVATE_KEY_BYTES = 32
const PUBLIC_KEY_BYTES = 32
const NONCE_BYTES = 24
const PLAINTEXT_BYTES = 96
const TAG_BYTES = 16
export const ENCRYPTED_NOTE_V1_BYTES =
  1 + PUBLIC_KEY_BYTES + NONCE_BYTES + PLAINTEXT_BYTES + TAG_BYTES

const textEncoder = new TextEncoder()
const AAD_TAG = textEncoder.encode('diesis/privacy/encrypted-note-aad/v1')
const KDF_SALT = sha256(
  textEncoder.encode('diesis/privacy/encrypted-note-kdf-salt/v1'),
)

export interface NoteEnvelopeContextV1 {
  chainId: bigint
  poolAddress: `0x${string}`
  commitment: bigint
  outputOrdinal: number
}

export interface ScanningKeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

function assertExactBytes(
  value: Uint8Array,
  length: number,
  label: string,
): void {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new RangeError(`${label} must be exactly ${length} bytes`)
  }
}

function uint256Bytes(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) {
    throw new RangeError('chain ID does not fit uint256')
  }
  const bytes = new Uint8Array(32)
  let remaining = value
  for (let index = 31; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return bytes
}

function addressBytes(address: `0x${string}`): Uint8Array {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new RangeError('pool address must be exactly 20 bytes')
  }
  const result = new Uint8Array(20)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(
      address.slice(2 + index * 2, 4 + index * 2),
      16,
    )
  }
  return result
}

function associatedData(context: NoteEnvelopeContextV1): Uint8Array {
  assertFieldElement(context.commitment)
  return frame(AAD_TAG, [
    uint256Bytes(context.chainId),
    addressBytes(context.poolAddress),
    Uint8Array.of(ENVELOPE_VERSION_V1),
    fieldToBytes(context.commitment),
    u32be(context.outputOrdinal),
  ])
}

function deriveEncryptionKey(
  sharedSecret: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return hkdf(sha256, sharedSecret, KDF_SALT, aad, 32)
}

function noteToPlaintext(note: NoteV1): Uint8Array {
  assertNoteV1(note)
  return concatBytes(
    fieldToBytes(note.ownerPublic),
    fieldToBytes(note.rho),
    fieldToBytes(note.rseed),
  )
}

function plaintextToNote(plaintext: Uint8Array): NoteV1 {
  assertExactBytes(plaintext, PLAINTEXT_BYTES, 'note plaintext')
  return assertNoteV1({
    ownerPublic: bytesToBigInt(plaintext.subarray(0, 32)),
    rho: bytesToBigInt(plaintext.subarray(32, 64)),
    rseed: bytesToBigInt(plaintext.subarray(64, 96)),
  })
}

export function scanningKeyPairFromPrivateKey(
  privateKey: Uint8Array,
): ScanningKeyPair {
  assertExactBytes(privateKey, PRIVATE_KEY_BYTES, 'scanning private key')
  const ownedPrivateKey = privateKey.slice()
  return {
    privateKey: ownedPrivateKey,
    publicKey: x25519.getPublicKey(ownedPrivateKey),
  }
}

export function encryptNoteEnvelopeV1({
  note,
  recipientPublicKey,
  context,
  randomBytes = secureRandomBytes,
}: {
  note: NoteV1
  recipientPublicKey: Uint8Array
  context: NoteEnvelopeContextV1
  randomBytes?: RandomBytes
}): Uint8Array {
  assertExactBytes(recipientPublicKey, PUBLIC_KEY_BYTES, 'scanning public key')
  const ephemeralPrivateKey = randomBytes(PRIVATE_KEY_BYTES)
  const nonce = randomBytes(NONCE_BYTES)
  assertExactBytes(
    ephemeralPrivateKey,
    PRIVATE_KEY_BYTES,
    'ephemeral private key',
  )
  assertExactBytes(nonce, NONCE_BYTES, 'envelope nonce')

  const aad = associatedData(context)
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey)
  const sharedSecret = x25519.getSharedSecret(
    ephemeralPrivateKey,
    recipientPublicKey,
  )
  const key = deriveEncryptionKey(sharedSecret, aad)
  const plaintext = noteToPlaintext(note)
  try {
    const sealed = xchacha20poly1305(key, nonce, aad).encrypt(plaintext)
    if (sealed.length !== PLAINTEXT_BYTES + TAG_BYTES) {
      throw new Error('encrypted note envelope invariant failed')
    }
    return concatBytes(
      Uint8Array.of(ENVELOPE_VERSION_V1),
      ephemeralPublicKey,
      nonce,
      sealed,
    )
  } finally {
    ephemeralPrivateKey.fill(0)
    sharedSecret.fill(0)
    key.fill(0)
    plaintext.fill(0)
  }
}

export async function scanNoteEnvelopeV1(
  envelope: Uint8Array,
  recipientPrivateKey: Uint8Array,
  context: NoteEnvelopeContextV1,
): Promise<NoteV1 | null> {
  if (
    !(envelope instanceof Uint8Array) ||
    envelope.length !== ENCRYPTED_NOTE_V1_BYTES
  ) {
    throw new Error('invalid encrypted note envelope')
  }
  assertExactBytes(
    recipientPrivateKey,
    PRIVATE_KEY_BYTES,
    'scanning private key',
  )
  if (envelope[0] !== ENVELOPE_VERSION_V1) return null

  const ephemeralPublicKey = envelope.subarray(1, 33)
  const nonce = envelope.subarray(33, 57)
  const sealed = envelope.subarray(57)
  const aad = associatedData(context)
  let sharedSecret: Uint8Array | undefined
  let key: Uint8Array | undefined
  let plaintext: Uint8Array | undefined
  try {
    sharedSecret = x25519.getSharedSecret(
      recipientPrivateKey,
      ephemeralPublicKey,
    )
    key = deriveEncryptionKey(sharedSecret, aad)
    plaintext = xchacha20poly1305(key, nonce, aad).decrypt(sealed)
    const note = plaintextToNote(plaintext)
    if ((await deriveCommitmentV1(note)) !== context.commitment) return null
    return note
  } catch {
    return null
  } finally {
    sharedSecret?.fill(0)
    key?.fill(0)
    plaintext?.fill(0)
  }
}
