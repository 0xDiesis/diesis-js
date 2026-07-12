import { NOTE_V1, NULLIFIER_V1, OWNER_KEY_V1 } from './domains.js'
import {
  assertFieldElement,
  randomNonzeroFieldElement,
  type RandomBytes,
} from './field.js'
import { poseidonHash } from './poseidon.js'

export interface NoteV1 {
  ownerPublic: bigint
  rho: bigint
  rseed: bigint
}

export interface SpendableNoteV1 {
  spendSecret: bigint
  rho: bigint
  rseed: bigint
}

export function assertNoteV1(note: NoteV1): NoteV1 {
  assertFieldElement(note.ownerPublic)
  assertFieldElement(note.rho)
  assertFieldElement(note.rseed)
  if (note.ownerPublic === 0n || note.rho === 0n || note.rseed === 0n) {
    throw new RangeError('note values must be nonzero field elements')
  }
  return note
}

export function deriveOwnerPublicV1(spendSecret: bigint): Promise<bigint> {
  assertFieldElement(spendSecret)
  if (spendSecret === 0n) throw new RangeError('spend secret must be nonzero')
  return poseidonHash([OWNER_KEY_V1, spendSecret])
}

export async function deriveCommitmentV1(note: NoteV1): Promise<bigint> {
  assertNoteV1(note)
  return poseidonHash([NOTE_V1, note.ownerPublic, note.rho, note.rseed])
}

export function deriveNullifierV1(note: SpendableNoteV1): Promise<bigint> {
  assertFieldElement(note.spendSecret)
  assertFieldElement(note.rho)
  assertFieldElement(note.rseed)
  if (note.spendSecret === 0n || note.rho === 0n || note.rseed === 0n) {
    throw new RangeError('spendable note values must be nonzero field elements')
  }
  return poseidonHash([NULLIFIER_V1, note.spendSecret, note.rho, note.rseed])
}

export async function createNoteV1(
  ownerPublic: bigint,
  randomBytes?: RandomBytes,
): Promise<NoteV1> {
  assertFieldElement(ownerPublic)
  if (ownerPublic === 0n) throw new RangeError('owner public must be nonzero')
  return {
    ownerPublic,
    rho: randomNonzeroFieldElement(randomBytes),
    rseed: randomNonzeroFieldElement(randomBytes),
  }
}
