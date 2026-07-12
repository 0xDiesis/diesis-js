import { buildPoseidon } from 'circomlibjs'
import { describe, expect, it } from 'vitest'

import {
  NOTE_TREE_DEPTH_V1,
  NOTE_ZERO_LEAF_V1,
  PrivacyTreeV1,
  type CanonicalPrivacyEventV1,
} from '../../src/privacy/tree.js'

const poseidon = await buildPoseidon()
const hash = (left: bigint, right: bigint): bigint =>
  poseidon.F.toObject(poseidon([left, right]))

function rootOf(leaves: readonly bigint[]): bigint {
  let level = [...leaves]
  let zero = NOTE_ZERO_LEAF_V1
  for (let depth = 0; depth < NOTE_TREE_DEPTH_V1; depth += 1) {
    const next: bigint[] = []
    for (
      let index = 0;
      index < Math.max(1, Math.ceil(level.length / 2));
      index += 1
    ) {
      next.push(hash(level[index * 2] ?? zero, level[index * 2 + 1] ?? zero))
    }
    level = next
    zero = hash(zero, zero)
  }
  return level[0]!
}

const deposit = (
  commitment: bigint,
  leafIndex: bigint,
  resultingRoot: bigint,
  blockNumber = 1n,
  blockHash = '0xaaa',
): CanonicalPrivacyEventV1 => ({
  kind: 'deposit',
  blockNumber,
  blockHash,
  transactionIndex: 0,
  logIndex: 0,
  commitment,
  leafIndex,
  resultingRoot,
})

describe('canonical privacy event tree reconstruction', () => {
  it('starts at the genesis-locked empty root', async () => {
    const tree = await PrivacyTreeV1.fromCanonicalEvents([])
    expect(tree.root).toBe(
      0x013cba6354bced6bd299dcbabc38193f51f72f84e55b83f3fad480bdfa1b57d3n,
    )
    expect(tree.nextIndex).toBe(0n)
  })

  it('sorts canonical events and reconstructs fixed transfer outputs', async () => {
    const firstRoot = rootOf([11n])
    const finalRoot = rootOf([11n, 12n, 13n])
    const events: CanonicalPrivacyEventV1[] = [
      {
        kind: 'transfer',
        blockNumber: 2n,
        blockHash: '0xbbb',
        transactionIndex: 0,
        logIndex: 0,
        commitments: [12n, 13n],
        activeCount: 2,
        firstOutputLeafIndex: 1n,
        resultingRoot: finalRoot,
      },
      deposit(11n, 0n, firstRoot),
    ]

    const tree = await PrivacyTreeV1.fromCanonicalEvents(events)
    expect(tree.root).toBe(finalRoot)
    expect(tree.nextIndex).toBe(3n)
    expect(tree.leaf(1n)).toBe(12n)

    const witness = tree.witness(1n)
    let computed = 12n
    for (let level = 0; level < NOTE_TREE_DEPTH_V1; level += 1) {
      computed =
        witness.pathIndices[level] === 0n
          ? hash(computed, witness.siblings[level]!)
          : hash(witness.siblings[level]!, computed)
    }
    expect(computed).toBe(finalRoot)
  })

  it('rejects gaps, forged roots, and mixed-fork block hashes', async () => {
    const firstRoot = rootOf([11n])
    await expect(
      PrivacyTreeV1.fromCanonicalEvents([deposit(11n, 1n, firstRoot)]),
    ).rejects.toThrow(/non-contiguous leaf index/)
    await expect(
      PrivacyTreeV1.fromCanonicalEvents([deposit(11n, 0n, firstRoot + 1n)]),
    ).rejects.toThrow(/resulting root mismatch/)
    await expect(
      PrivacyTreeV1.fromCanonicalEvents([
        deposit(11n, 0n, firstRoot, 1n, '0xaaa'),
        {
          ...deposit(12n, 1n, rootOf([11n, 12n]), 1n, '0xbbb'),
          transactionIndex: 1,
        },
      ]),
    ).rejects.toThrow(/mixed canonical block hashes/)
  })

  it('rebuilds a reorged branch without retaining orphan leaves', async () => {
    const common = deposit(11n, 0n, rootOf([11n]))
    const oldTree = await PrivacyTreeV1.fromCanonicalEvents([
      common,
      deposit(12n, 1n, rootOf([11n, 12n]), 2n, '0xold'),
    ])
    const survivingTree = await PrivacyTreeV1.fromCanonicalEvents([
      common,
      deposit(13n, 1n, rootOf([11n, 13n]), 2n, '0xnew'),
    ])

    expect(oldTree.root).not.toBe(survivingTree.root)
    expect(survivingTree.leaf(1n)).toBe(13n)
  })
})
