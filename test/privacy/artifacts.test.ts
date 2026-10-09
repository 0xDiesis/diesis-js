import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'

import {
  loadPrivacyArtifactsV1,
  type ArtifactFetcher,
  type CircuitArtifactManifestV1,
} from '../../src/privacy/artifacts.js'

const encoder = new TextEncoder()
const digest = (value: Uint8Array): `0x${string}` =>
  `0x${bytesToHex(sha256(value))}`

const wasm = Uint8Array.of(1, 2, 3)
const zkey = Uint8Array.of(4, 5, 6)
const verificationKey = encoder.encode('{"protocol":"groth16"}')
const publicLayout = encoder.encode(
  JSON.stringify({
    schemaVersion: 'diesis.circuit-layout.v1',
    circuit: 'TransferV1',
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
  }),
)

const manifest: CircuitArtifactManifestV1 = {
  schemaVersion: 'diesis.circuit-artifact-manifest.v1',
  artifactClass: 'test',
  circuit: { id: 'transfer-v1', version: 1 },
  wasm: { path: 'transfer/TransferV1.wasm', sha256: digest(wasm) },
  zkey: { path: 'transfer/TransferV1.zkey', sha256: digest(zkey) },
  verificationKey: {
    path: 'transfer/TransferV1.vk.json',
    sha256: digest(verificationKey),
  },
  publicLayout: {
    path: 'transfer/TransferV1.public-layout.json',
    sha256: digest(publicLayout),
  },
}
const manifestBytes = encoder.encode(JSON.stringify(manifest))

function fetcher(
  overrides: Readonly<Record<string, Uint8Array>> = {},
): ArtifactFetcher {
  const values: Record<string, Uint8Array> = {
    [manifest.wasm.path]: wasm,
    [manifest.zkey.path]: zkey,
    [manifest.verificationKey.path]: verificationKey,
    [manifest.publicLayout.path]: publicLayout,
    ...overrides,
  }
  return async (path) => {
    const value = values[path]
    if (value === undefined) throw new Error('not found')
    return value.slice()
  }
}

describe('content-addressed privacy artifacts', () => {
  it('loads the fixed public layout only after every hash matches', async () => {
    const artifacts = await loadPrivacyArtifactsV1({
      manifestBytes,
      expectedManifestSha256: digest(manifestBytes),
      expectedArtifactClass: 'test',
      expectedCircuitId: 'transfer-v1',
      fetch: fetcher(),
    })

    expect(artifacts.manifest.circuit.id).toBe('transfer-v1')
    expect(artifacts.publicSignals).toEqual([
      'context',
      'root',
      'nullifier[0]',
      'nullifier[1]',
      'commitment[0]',
      'commitment[1]',
      'activeCount',
      'extDataField',
      'transactionBinding',
    ])
    expect(artifacts.wasm).toEqual(wasm)
    expect(artifacts.zkey).toEqual(zkey)
  })

  it('rejects manifest class and circuit confusion before fetching artifacts', async () => {
    let fetches = 0
    const fetch: ArtifactFetcher = async () => {
      fetches += 1
      return new Uint8Array()
    }
    await expect(
      loadPrivacyArtifactsV1({
        manifestBytes,
        expectedManifestSha256: digest(manifestBytes),
        expectedArtifactClass: 'production',
        expectedCircuitId: 'transfer-v1',
        fetch,
      }),
    ).rejects.toThrow('artifact class mismatch')
    await expect(
      loadPrivacyArtifactsV1({
        manifestBytes,
        expectedManifestSha256: digest(manifestBytes),
        expectedArtifactClass: 'test',
        expectedCircuitId: 'withdraw-v1',
        fetch,
      }),
    ).rejects.toThrow('circuit identity mismatch')
    expect(fetches).toBe(0)
  })

  it.each([
    ['manifest', undefined],
    ['WASM', { [manifest.wasm.path]: Uint8Array.of(9) }],
    ['zkey', { [manifest.zkey.path]: Uint8Array.of(9) }],
  ] as const)('rejects corrupted %s bytes', async (name, overrides) => {
    await expect(
      loadPrivacyArtifactsV1({
        manifestBytes,
        expectedManifestSha256:
          name === 'manifest'
            ? digest(Uint8Array.of(9))
            : digest(manifestBytes),
        expectedArtifactClass: 'test',
        expectedCircuitId: 'transfer-v1',
        fetch: fetcher(overrides),
      }),
    ).rejects.toThrow(/artifact hash mismatch/)
  })

  it('rejects a public layout with reordered signals', async () => {
    const reordered = encoder.encode(
      JSON.stringify({
        schemaVersion: 'diesis.circuit-layout.v1',
        circuit: 'TransferV1',
        publicSignals: ['root', 'context'],
      }),
    )
    const changedManifest = {
      ...manifest,
      publicLayout: {
        ...manifest.publicLayout,
        sha256: digest(reordered),
      },
    }
    const changedManifestBytes = encoder.encode(JSON.stringify(changedManifest))

    await expect(
      loadPrivacyArtifactsV1({
        manifestBytes: changedManifestBytes,
        expectedManifestSha256: digest(changedManifestBytes),
        expectedArtifactClass: 'test',
        expectedCircuitId: 'transfer-v1',
        fetch: fetcher({ [manifest.publicLayout.path]: reordered }),
      }),
    ).rejects.toThrow('public signal layout mismatch')
  })
})
