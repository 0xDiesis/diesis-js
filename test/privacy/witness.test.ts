import { buildPoseidon } from 'circomlibjs'
import { describe, expect, it } from 'vitest'

import {
  buildAssociationWitnessV1,
  buildTransferWitnessV1,
  buildWithdrawalWitnessV1,
  type PrivacyNetworkContextV1,
} from '../../src/privacy/witness.js'

const poseidon = await buildPoseidon()
const hash = (inputs: readonly bigint[]): bigint =>
  poseidon.F.toObject(poseidon(inputs))
const network: PrivacyNetworkContextV1 = {
  chainId: 19_803n,
  shieldedPoolAddress: '0xd1e515000000000000000000000000000000fade',
  privacyPoolsAddress: '0xd1e5150000000000000000000000000000deface',
}

function path(leaf: bigint, index: bigint, siblingBase: bigint) {
  const siblings: bigint[] = []
  const pathIndices: bigint[] = []
  let root = leaf
  for (let level = 0; level < 32; level += 1) {
    const sibling = siblingBase + BigInt(level)
    const bit = (index >> BigInt(level)) & 1n
    siblings.push(sibling)
    pathIndices.push(bit)
    root = bit === 0n ? hash([root, sibling]) : hash([sibling, root])
  }
  return { root, leaf, leafIndex: index, siblings, pathIndices }
}

describe('fixed privacy circuit witnesses', () => {
  it('matches the canonical one-input transfer public layout', async () => {
    const inputCommitment = hash([
      0x0feb85500be436d10018971d7fa7ffdea6bf0936d475c96c1068f72fc052aba8n,
      hash([
        0x256971d4f36f29fd116ea590b04fdc7dabbe3712c26e56357292b45f9c4e24f6n,
        11n,
      ]),
      12n,
      13n,
    ])
    const result = await buildTransferWitnessV1({
      network,
      inputs: [
        {
          spendSecret: 11n,
          rho: 12n,
          rseed: 13n,
          merkle: path(inputCommitment, 0n, 0n),
        },
      ],
      outputs: [{ ownerPublic: 31n, rho: 32n, rseed: 33n }],
      encryptedOutputs: Uint8Array.from({ length: 169 }, (_, index) => index),
    })

    expect(result.publicSignals.map(String)).toEqual([
      '15210605070611810355730982024081693421895968065559661590579185744742350401027',
      '19329108510546413311033947997366977563166775012610221967320962152171247302745',
      '17965649685970956755743201899446695789488645262050624465027358605595625114286',
      '0',
      '21676085382534560898178173012049457960731592538676406178623237901895546524693',
      '0',
      '1',
      '1125278886324999578076166392560294341787847137310948635681272797099265913586',
      '15701690292212640169462030987284113820879119444907851900029406242494162908906',
    ])
    expect(result.witness.inputSpendSecret[1]).toBe(0n)
    expect(result.witness.inputSiblings[1]).toEqual(Array(32).fill(0n))
  })

  it('rejects mismatched membership, arity, and ciphertext length', async () => {
    const merkle = path(123n, 0n, 0n)
    const base = {
      network,
      inputs: [{ spendSecret: 11n, rho: 12n, rseed: 13n, merkle }],
      outputs: [{ ownerPublic: 31n, rho: 32n, rseed: 33n }],
      encryptedOutputs: new Uint8Array(169),
    } as const
    await expect(buildTransferWitnessV1(base)).rejects.toThrow(
      /input commitment does not match tree leaf/,
    )
    await expect(
      buildTransferWitnessV1({ ...base, outputs: [] }),
    ).rejects.toThrow(/equal one-or-two input and output counts/)
    await expect(
      buildTransferWitnessV1({
        ...base,
        encryptedOutputs: new Uint8Array(168),
      }),
    ).rejects.toThrow(/encrypted output length/)
  })

  it('matches the canonical withdrawal public layout', async () => {
    const owner = hash([
      0x256971d4f36f29fd116ea590b04fdc7dabbe3712c26e56357292b45f9c4e24f6n,
      61n,
    ])
    const commitment = hash([
      0x0feb85500be436d10018971d7fa7ffdea6bf0936d475c96c1068f72fc052aba8n,
      owner,
      62n,
      63n,
    ])
    const result = await buildWithdrawalWitnessV1({
      network,
      note: {
        spendSecret: 61n,
        rho: 62n,
        rseed: 63n,
        merkle: path(commitment, 17n, 101n),
      },
      recipient: '0x0000000000000000000000000000000000001234',
      relayer: '0x0000000000000000000000000000000000005678',
      fee: 1n,
    })

    expect(result.publicSignals).toHaveLength(7)
    expect(result.publicSignals[1]).toBe(result.witness.root)
    expect(result.publicSignals.slice(3, 6)).toEqual([0x1234n, 0x5678n, 1n])
  })

  it('binds association membership to context, provider, and nullifier', async () => {
    const context =
      0x0c337e686cd11067dbf7c22e036c89535a8a4ee28f71009d7f7f032b4bec203bn
    const provider = 0x1234n
    const nullifier = 0x5678n
    const leaf = hash([
      0x02a1f48f99b58d7aa9e2a13f9da0a6636b122c051e2469e5d743022503b14e9en,
      context,
      provider,
      nullifier,
    ])
    const result = await buildAssociationWitnessV1({
      network,
      provider: '0x0000000000000000000000000000000000001234',
      nullifier,
      merkle: path(leaf, 5n, 201n),
    })

    expect(result.publicSignals).toEqual([
      context,
      provider,
      result.witness.associationRoot,
      nullifier,
    ])
  })
})
