import { readFile } from 'node:fs/promises'

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { buildPoseidon } from 'circomlibjs'
import { describe, expect, it } from 'vitest'

import { loadPrivacyArtifactsV1 } from '../../src/privacy/artifacts.js'
import { proveTransferV1 } from '../../src/privacy/prover.js'
import { runSnarkjsProofRequest } from '../../src/privacy/worker-runtime.js'
import { buildTransferWitnessV1 } from '../../src/privacy/witness.js'
import { resolveContractsCircuitsRoot } from '../helpers/contracts-circuits.js'

const circuitsRoot = await resolveContractsCircuitsRoot(import.meta.url)
const poseidon = await buildPoseidon()
const hash = (inputs: readonly bigint[]): bigint =>
  poseidon.F.toObject(poseidon(inputs))

describe('real local privacy proofs', () => {
  it('generates and locally verifies the canonical Transfer V1 proof', async () => {
    const manifestBytes = new Uint8Array(
      await readFile(new URL('manifests/test/transfer-v1.json', circuitsRoot)),
    )
    const artifacts = await loadPrivacyArtifactsV1({
      manifestBytes,
      expectedManifestSha256: `0x${bytesToHex(sha256(manifestBytes))}`,
      expectedArtifactClass: 'test',
      expectedCircuitId: 'transfer-v1',
      fetch: async (path) =>
        new Uint8Array(await readFile(new URL(path, circuitsRoot))),
    })
    const owner = hash([
      0x256971d4f36f29fd116ea590b04fdc7dabbe3712c26e56357292b45f9c4e24f6n,
      11n,
    ])
    const leaf = hash([
      0x0feb85500be436d10018971d7fa7ffdea6bf0936d475c96c1068f72fc052aba8n,
      owner,
      12n,
      13n,
    ])
    const siblings = Array.from({ length: 32 }, (_, level) => BigInt(level))
    let root = leaf
    for (const sibling of siblings) root = hash([root, sibling])
    const statement = await buildTransferWitnessV1({
      network: {
        chainId: 19_803n,
        shieldedPoolAddress: '0xd1e515000000000000000000000000000000fade',
        privacyPoolsAddress: '0xd1e5150000000000000000000000000000deface',
      },
      inputs: [
        {
          spendSecret: 11n,
          rho: 12n,
          rseed: 13n,
          merkle: {
            root,
            leaf,
            leafIndex: 0n,
            siblings,
            pathIndices: Array(32).fill(0n),
          },
        },
      ],
      outputs: [{ ownerPublic: 31n, rho: 32n, rseed: 33n }],
      encryptedOutputs: Uint8Array.from({ length: 169 }, (_, index) => index),
    })

    const result = await proveTransferV1({
      artifacts,
      statement,
      engine: { proveAndVerify: runSnarkjsProofRequest },
    })
    expect(result.proofBytes).toHaveLength(256)
    expect(result.publicSignals).toEqual(statement.publicSignals)
  }, 60_000)
})
