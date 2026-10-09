import {
  ASSOCIATION_LEAF_V1,
  TRANSFER_BINDING_V1,
  WITHDRAW_BINDING_V1,
} from './domains.js'
import { assertFieldElement, fieldToBytes } from './field.js'
import { h2f, u32be } from './framing.js'
import {
  assertNoteV1,
  deriveCommitmentV1,
  deriveNullifierV1,
  deriveOwnerPublicV1,
  type NoteV1,
} from './note.js'
import { poseidonHash } from './poseidon.js'
import { NOTE_TREE_DEPTH_V1, type MerkleWitnessV1 } from './tree.js'

type Address = `0x${string}`

export interface PrivacyNetworkContextV1 {
  chainId: bigint
  shieldedPoolAddress: Address
  privacyPoolsAddress: Address
}

export interface SpendInputV1 {
  spendSecret: bigint
  rho: bigint
  rseed: bigint
  merkle: MerkleWitnessV1
}

const encoder = new TextEncoder()
const TRANSFER_CONTEXT_TAG = encoder.encode(
  'diesis/privacy/transfer-context/v1',
)
const WITHDRAW_CONTEXT_TAG = encoder.encode(
  'diesis/privacy/withdraw-context/v1',
)
const ASSOCIATION_CONTEXT_TAG = encoder.encode(
  'diesis/privacy/association-context/v1',
)
const TRANSFER_EXTERNAL_DATA_TAG = encoder.encode(
  'diesis/privacy/transfer-external-data/v1',
)
const VERSION_V1 = u32be(1)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function uint256Bytes(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) {
    throw new RangeError('value does not fit uint256')
  }
  const result = new Uint8Array(32)
  let remaining = value
  for (let index = 31; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

function addressBytes(address: Address): Uint8Array {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new RangeError('address must be exactly 20 bytes')
  }
  return Uint8Array.from({ length: 20 }, (_, index) =>
    Number.parseInt(address.slice(2 + index * 2, 4 + index * 2), 16),
  )
}

function addressField(address: Address): bigint {
  let value = 0n
  for (const byte of addressBytes(address)) value = (value << 8n) | BigInt(byte)
  return value
}

function circuitContext(
  tag: Uint8Array,
  chainId: bigint,
  address: Address,
): bigint {
  return h2f(tag, [uint256Bytes(chainId), addressBytes(address), VERSION_V1])
}

async function assertMerkleWitness(
  merkle: MerkleWitnessV1,
  expectedLeaf: bigint,
): Promise<void> {
  if (merkle.leaf !== expectedLeaf) {
    throw new Error('input commitment does not match tree leaf')
  }
  if (
    merkle.siblings.length !== NOTE_TREE_DEPTH_V1 ||
    merkle.pathIndices.length !== NOTE_TREE_DEPTH_V1
  ) {
    throw new Error('Merkle witness must have depth 32')
  }
  let root = expectedLeaf
  for (let level = 0; level < NOTE_TREE_DEPTH_V1; level += 1) {
    const sibling = assertFieldElement(merkle.siblings[level]!)
    const bit = merkle.pathIndices[level]!
    if (bit !== 0n && bit !== 1n) throw new Error('invalid Merkle path bit')
    root =
      bit === 0n
        ? await poseidonHash([root, sibling])
        : await poseidonHash([sibling, root])
  }
  if (root !== merkle.root) throw new Error('Merkle witness root mismatch')
}

export async function buildTransferWitnessV1({
  network,
  inputs,
  outputs,
  encryptedOutputs,
}: {
  network: PrivacyNetworkContextV1
  inputs: readonly SpendInputV1[]
  outputs: readonly NoteV1[]
  encryptedOutputs: Uint8Array
}) {
  if (
    inputs.length !== outputs.length ||
    (inputs.length !== 1 && inputs.length !== 2)
  ) {
    throw new Error(
      'transfer requires equal one-or-two input and output counts',
    )
  }
  if (encryptedOutputs.length !== inputs.length * 169) {
    throw new Error('invalid encrypted output length')
  }
  const activeCount = inputs.length as 1 | 2
  const context = circuitContext(
    TRANSFER_CONTEXT_TAG,
    network.chainId,
    network.shieldedPoolAddress,
  )
  const root = inputs[0]!.merkle.root
  const nullifiers: [bigint, bigint] = [0n, 0n]
  const commitments: [bigint, bigint] = [0n, 0n]
  const inputSpendSecret: [bigint, bigint] = [0n, 0n]
  const inputRho: [bigint, bigint] = [0n, 0n]
  const inputRseed: [bigint, bigint] = [0n, 0n]
  const inputSiblings: [bigint[], bigint[]] = [
    Array(NOTE_TREE_DEPTH_V1).fill(0n),
    Array(NOTE_TREE_DEPTH_V1).fill(0n),
  ]
  const inputPathIndices: [bigint[], bigint[]] = [
    Array(NOTE_TREE_DEPTH_V1).fill(0n),
    Array(NOTE_TREE_DEPTH_V1).fill(0n),
  ]
  const outputOwnerPublic: [bigint, bigint] = [0n, 0n]
  const outputRho: [bigint, bigint] = [0n, 0n]
  const outputRseed: [bigint, bigint] = [0n, 0n]

  for (let slot = 0; slot < activeCount; slot += 1) {
    const input = inputs[slot]!
    if (input.merkle.root !== root) {
      throw new Error('transfer inputs must use the same Merkle root')
    }
    const ownerPublic = await deriveOwnerPublicV1(input.spendSecret)
    const inputCommitment = await deriveCommitmentV1({
      ownerPublic,
      rho: input.rho,
      rseed: input.rseed,
    })
    await assertMerkleWitness(input.merkle, inputCommitment)
    nullifiers[slot] = await deriveNullifierV1(input)
    commitments[slot] = await deriveCommitmentV1(outputs[slot]!)
    if (nullifiers[slot] === 0n || commitments[slot] === 0n) {
      throw new Error('active transfer values must be nonzero')
    }
    inputSpendSecret[slot] = input.spendSecret
    inputRho[slot] = input.rho
    inputRseed[slot] = input.rseed
    inputSiblings[slot] = [...input.merkle.siblings]
    inputPathIndices[slot] = [...input.merkle.pathIndices]
    const output = assertNoteV1(outputs[slot]!)
    outputOwnerPublic[slot] = output.ownerPublic
    outputRho[slot] = output.rho
    outputRseed[slot] = output.rseed
  }
  if (
    activeCount === 2 &&
    (nullifiers[0] === nullifiers[1] || commitments[0] === commitments[1])
  ) {
    throw new Error('active transfer values must be distinct')
  }

  const extDataField = h2f(TRANSFER_EXTERNAL_DATA_TAG, [
    uint256Bytes(network.chainId),
    addressBytes(network.shieldedPoolAddress),
    VERSION_V1,
    Uint8Array.of(activeCount),
    fieldToBytes(commitments[0]),
    fieldToBytes(commitments[1]),
    encryptedOutputs,
  ])
  const transactionBinding = await poseidonHash([
    TRANSFER_BINDING_V1,
    context,
    root,
    nullifiers[0],
    nullifiers[1],
    commitments[0],
    commitments[1],
    BigInt(activeCount),
    extDataField,
  ])
  const witness = {
    context,
    root,
    nullifier: nullifiers,
    commitment: commitments,
    activeCount: BigInt(activeCount),
    extDataField,
    transactionBinding,
    inputSpendSecret,
    inputRho,
    inputRseed,
    inputSiblings,
    inputPathIndices,
    outputOwnerPublic,
    outputRho,
    outputRseed,
  }
  return {
    witness,
    publicSignals: [
      context,
      root,
      ...nullifiers,
      ...commitments,
      BigInt(activeCount),
      extDataField,
      transactionBinding,
    ] as const,
  }
}

export async function buildWithdrawalWitnessV1({
  network,
  note,
  recipient,
  relayer,
  fee,
}: {
  network: PrivacyNetworkContextV1
  note: SpendInputV1
  recipient: Address
  relayer: Address
  fee: bigint
}) {
  const recipientField = addressField(recipient)
  const relayerField = addressField(relayer)
  if (recipientField === 0n)
    throw new Error('withdrawal recipient must be nonzero')
  if (fee < 0n || fee > 1_000_000_000_000_000_000n) {
    throw new Error('withdrawal fee exceeds denomination')
  }
  if ((fee === 0n) !== (relayer.toLowerCase() === ZERO_ADDRESS)) {
    throw new Error('withdrawal relayer and fee are inconsistent')
  }
  const ownerPublic = await deriveOwnerPublicV1(note.spendSecret)
  const commitment = await deriveCommitmentV1({
    ownerPublic,
    rho: note.rho,
    rseed: note.rseed,
  })
  await assertMerkleWitness(note.merkle, commitment)
  const context = circuitContext(
    WITHDRAW_CONTEXT_TAG,
    network.chainId,
    network.shieldedPoolAddress,
  )
  const nullifier = await deriveNullifierV1(note)
  const withdrawalBinding = await poseidonHash([
    WITHDRAW_BINDING_V1,
    context,
    note.merkle.root,
    nullifier,
    recipientField,
    relayerField,
    fee,
  ])
  const witness = {
    context,
    root: note.merkle.root,
    nullifier,
    recipient: recipientField,
    relayer: relayerField,
    fee,
    withdrawalBinding,
    spendSecret: note.spendSecret,
    rho: note.rho,
    rseed: note.rseed,
    siblings: [...note.merkle.siblings],
    pathIndices: [...note.merkle.pathIndices],
  }
  return {
    witness,
    publicSignals: [
      context,
      witness.root,
      nullifier,
      recipientField,
      relayerField,
      fee,
      withdrawalBinding,
    ] as const,
  }
}

export async function buildAssociationWitnessV1({
  network,
  provider,
  nullifier,
  merkle,
}: {
  network: PrivacyNetworkContextV1
  provider: Address
  nullifier: bigint
  merkle: MerkleWitnessV1
}) {
  assertFieldElement(nullifier)
  if (nullifier === 0n) throw new Error('association nullifier must be nonzero')
  const providerField = addressField(provider)
  if (providerField === 0n)
    throw new Error('association provider must be nonzero')
  const context = circuitContext(
    ASSOCIATION_CONTEXT_TAG,
    network.chainId,
    network.privacyPoolsAddress,
  )
  const leaf = await poseidonHash([
    ASSOCIATION_LEAF_V1,
    context,
    providerField,
    nullifier,
  ])
  await assertMerkleWitness(merkle, leaf)
  const witness = {
    context,
    provider: providerField,
    associationRoot: merkle.root,
    nullifier,
    siblings: [...merkle.siblings],
    pathIndices: [...merkle.pathIndices],
  }
  return {
    witness,
    publicSignals: [context, providerField, merkle.root, nullifier] as const,
  }
}
