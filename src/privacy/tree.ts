import { assertFieldElement } from './field.js'
import { poseidonHash } from './poseidon.js'

export const NOTE_TREE_DEPTH_V1 = 32
export const NOTE_ZERO_LEAF_V1 =
  0x044d4e19053273e4b6b8c853ff45263cbddf4f22dff18ff432e0c26c4041ef79n

interface CanonicalEventPositionV1 {
  blockNumber: bigint
  blockHash: string
  transactionIndex: number
  logIndex: number
  resultingRoot: bigint
}

export interface DepositEventV1 extends CanonicalEventPositionV1 {
  kind: 'deposit'
  commitment: bigint
  leafIndex: bigint
}

export interface TransferEventV1 extends CanonicalEventPositionV1 {
  kind: 'transfer'
  commitments: readonly [bigint, bigint]
  activeCount: 1 | 2
  firstOutputLeafIndex: bigint
}

export type CanonicalPrivacyEventV1 = DepositEventV1 | TransferEventV1

export interface MerkleWitnessV1 {
  root: bigint
  leaf: bigint
  leafIndex: bigint
  siblings: readonly bigint[]
  pathIndices: readonly bigint[]
}

function compareEvents(
  left: CanonicalPrivacyEventV1,
  right: CanonicalPrivacyEventV1,
): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1
  }
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex
  }
  return left.logIndex - right.logIndex
}

function assertPosition(event: CanonicalPrivacyEventV1): void {
  if (event.blockNumber < 0n || event.blockHash.length === 0) {
    throw new Error('invalid canonical event position')
  }
  for (const value of [event.transactionIndex, event.logIndex]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('invalid canonical event position')
    }
  }
}

export class PrivacyTreeV1 {
  readonly root: bigint
  readonly nextIndex: bigint
  readonly #zeroes: readonly bigint[]
  readonly #nodes: readonly ReadonlyMap<bigint, bigint>[]

  private constructor(
    root: bigint,
    nextIndex: bigint,
    zeroes: readonly bigint[],
    nodes: readonly ReadonlyMap<bigint, bigint>[],
  ) {
    this.root = root
    this.nextIndex = nextIndex
    this.#zeroes = zeroes
    this.#nodes = nodes
  }

  static async fromCanonicalEvents(
    sourceEvents: readonly CanonicalPrivacyEventV1[],
  ): Promise<PrivacyTreeV1> {
    const zeroes = [NOTE_ZERO_LEAF_V1]
    for (let level = 0; level < NOTE_TREE_DEPTH_V1; level += 1) {
      zeroes.push(await poseidonHash([zeroes[level]!, zeroes[level]!]))
    }
    const nodes = Array.from(
      { length: NOTE_TREE_DEPTH_V1 + 1 },
      () => new Map<bigint, bigint>(),
    )
    const events = [...sourceEvents].sort(compareEvents)
    const blockHashes = new Map<bigint, string>()
    let previousPosition: string | undefined
    let nextIndex = 0n
    let root = zeroes[NOTE_TREE_DEPTH_V1]!

    const insert = async (
      leaf: bigint,
      expectedIndex: bigint,
    ): Promise<void> => {
      assertFieldElement(leaf)
      if (leaf === 0n) throw new Error('tree leaf must be nonzero')
      if (expectedIndex !== nextIndex) {
        throw new Error('non-contiguous leaf index')
      }
      if (nextIndex >= 1n << BigInt(NOTE_TREE_DEPTH_V1)) {
        throw new Error('privacy tree is full')
      }

      let cursor = nextIndex
      let current = leaf
      nodes[0]!.set(cursor, current)
      for (let level = 0; level < NOTE_TREE_DEPTH_V1; level += 1) {
        const sibling = nodes[level]!.get(cursor ^ 1n) ?? zeroes[level]!
        current =
          (cursor & 1n) === 0n
            ? await poseidonHash([current, sibling])
            : await poseidonHash([sibling, current])
        cursor >>= 1n
        nodes[level + 1]!.set(cursor, current)
      }
      nextIndex += 1n
      root = current
    }

    for (const event of events) {
      assertPosition(event)
      assertFieldElement(event.resultingRoot)
      const position = `${event.blockNumber}:${event.transactionIndex}:${event.logIndex}`
      if (position === previousPosition)
        throw new Error('duplicate canonical log position')
      previousPosition = position
      const knownBlockHash = blockHashes.get(event.blockNumber)
      if (knownBlockHash !== undefined && knownBlockHash !== event.blockHash) {
        throw new Error('mixed canonical block hashes')
      }
      blockHashes.set(event.blockNumber, event.blockHash)

      if (event.kind === 'deposit') {
        await insert(event.commitment, event.leafIndex)
      } else {
        if (event.activeCount !== 1 && event.activeCount !== 2) {
          throw new Error('invalid active output count')
        }
        if (event.firstOutputLeafIndex !== nextIndex) {
          throw new Error('non-contiguous leaf index')
        }
        await insert(event.commitments[0], nextIndex)
        if (event.activeCount === 2) {
          await insert(event.commitments[1], nextIndex)
        } else if (event.commitments[1] !== 0n) {
          throw new Error('inactive commitment must be zero')
        }
      }
      if (root !== event.resultingRoot) {
        throw new Error('resulting root mismatch')
      }
    }

    return new PrivacyTreeV1(root, nextIndex, zeroes, nodes)
  }

  leaf(index: bigint): bigint {
    if (index < 0n || index >= this.nextIndex) {
      throw new RangeError('leaf index is outside the reconstructed tree')
    }
    return this.#nodes[0]!.get(index)!
  }

  witness(index: bigint): MerkleWitnessV1 {
    const leaf = this.leaf(index)
    const siblings: bigint[] = []
    const pathIndices: bigint[] = []
    let cursor = index
    for (let level = 0; level < NOTE_TREE_DEPTH_V1; level += 1) {
      siblings.push(
        this.#nodes[level]!.get(cursor ^ 1n) ?? this.#zeroes[level]!,
      )
      pathIndices.push(cursor & 1n)
      cursor >>= 1n
    }
    return {
      root: this.root,
      leaf,
      leafIndex: index,
      siblings,
      pathIndices,
    }
  }
}
