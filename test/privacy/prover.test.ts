import { describe, expect, it } from 'vitest'

import type { LoadedPrivacyArtifactsV1 } from '../../src/privacy/artifacts.js'
import {
  encodeGroth16Proof,
  proveTransferV1,
  type Groth16Proof,
  type PrivacyProofEngine,
} from '../../src/privacy/prover.js'

const proof: Groth16Proof = {
  protocol: 'groth16',
  curve: 'bn128',
  pi_a: ['1', '2', '1'],
  pi_b: [
    ['3', '4'],
    ['5', '6'],
    ['1', '0'],
  ],
  pi_c: ['7', '8', '1'],
}

const artifacts: LoadedPrivacyArtifactsV1 = {
  manifest: {
    schemaVersion: 'diesis.circuit-artifact-manifest.v1',
    artifactClass: 'test',
    circuit: { id: 'transfer-v1', version: 1 },
    wasm: { path: 'TransferV1.wasm', sha256: `0x${'01'.repeat(32)}` },
    zkey: { path: 'TransferV1.zkey', sha256: `0x${'02'.repeat(32)}` },
    verificationKey: {
      path: 'TransferV1.vk.json',
      sha256: `0x${'03'.repeat(32)}`,
    },
    publicLayout: {
      path: 'TransferV1.public-layout.json',
      sha256: `0x${'04'.repeat(32)}`,
    },
  },
  wasm: Uint8Array.of(1),
  zkey: Uint8Array.of(2),
  verificationKey: { protocol: 'groth16' },
  publicSignals: [
    'context',
    'root',
    'nullifier[0]',
    'nullifier[1]',
    'commitment[0]',
    'commitment[1]',
    'activeCount',
    'extDataField',
    'transactionBinding',
  ],
}
const statement = {
  witness: { secret: 99n },
  publicSignals: [1n, 2n, 3n, 4n, 5n, 6n, 1n, 7n, 8n] as const,
}

describe('privacy proof orchestration', () => {
  it('locally verifies and emits fixed 256-byte Solidity proof encoding', async () => {
    const engine: PrivacyProofEngine = {
      proveAndVerify: async (request) => {
        expect(request.wasm).toEqual(Uint8Array.of(1))
        expect(request.witness).toEqual(statement.witness)
        return {
          proof,
          publicSignals: statement.publicSignals.map(String),
          verified: true,
        }
      },
    }

    const result = await proveTransferV1({ artifacts, statement, engine })
    expect(result.proofBytes).toHaveLength(256)
    expect(
      Array.from(
        { length: 8 },
        (_, index) => result.proofBytes[(index + 1) * 32 - 1],
      ),
    ).toEqual([1, 2, 4, 3, 6, 5, 7, 8])
    expect(result.publicSignals).toEqual(statement.publicSignals)
  })

  it('rejects engine signal substitution and failed local verification', async () => {
    const engine: PrivacyProofEngine = {
      proveAndVerify: async () => ({
        proof,
        publicSignals: ['9', ...statement.publicSignals.slice(1).map(String)],
        verified: true,
      }),
    }
    await expect(
      proveTransferV1({ artifacts, statement, engine }),
    ).rejects.toThrow('prover public signals mismatch')
    engine.proveAndVerify = async () => ({
      proof,
      publicSignals: statement.publicSignals.map(String),
      verified: false,
    })
    await expect(
      proveTransferV1({ artifacts, statement, engine }),
    ).rejects.toThrow('local proof verification failed')
  })

  it('rejects proof coordinate overflow and circuit confusion', async () => {
    expect(() =>
      encodeGroth16Proof({
        ...proof,
        pi_a: [(1n << 256n).toString(), '2', '1'],
      }),
    ).toThrow(/proof coordinate/)
    const engine: PrivacyProofEngine = {
      proveAndVerify: async () => ({
        proof,
        publicSignals: statement.publicSignals.map(String),
        verified: true,
      }),
    }
    await expect(
      proveTransferV1({
        artifacts: {
          ...artifacts,
          manifest: {
            ...artifacts.manifest,
            circuit: { id: 'withdraw-v1', version: 1 },
          },
        },
        statement,
        engine,
      }),
    ).rejects.toThrow('proof artifact circuit mismatch')
  })
})
