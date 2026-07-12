import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export type PrivacyArtifactClass = 'test' | 'production'
export type PrivacyCircuitIdV1 =
  | 'transfer-v1'
  | 'withdraw-v1'
  | 'association-v1'

export interface ContentAddressedArtifactV1 {
  path: string
  sha256: `0x${string}`
}

export interface CircuitArtifactManifestV1 {
  schemaVersion: 'diesis.circuit-artifact-manifest.v1'
  artifactClass: PrivacyArtifactClass
  circuit: { id: PrivacyCircuitIdV1; version: 1 }
  wasm: ContentAddressedArtifactV1
  zkey: ContentAddressedArtifactV1
  verificationKey: ContentAddressedArtifactV1
  publicLayout: ContentAddressedArtifactV1
  readonly [key: string]: unknown
}

export type ArtifactFetcher = (path: string) => Promise<Uint8Array>

export interface LoadedPrivacyArtifactsV1 {
  manifest: CircuitArtifactManifestV1
  wasm: Uint8Array
  zkey: Uint8Array
  verificationKey: unknown
  publicSignals: readonly string[]
}

const PUBLIC_SIGNALS: Readonly<Record<PrivacyCircuitIdV1, readonly string[]>> =
  {
    'transfer-v1': [
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
    'withdraw-v1': [
      'context',
      'root',
      'nullifier',
      'recipient',
      'relayer',
      'fee',
      'withdrawalBinding',
    ],
    'association-v1': ['context', 'provider', 'associationRoot', 'nullifier'],
  }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error(`invalid ${label}`)
  }
}

function assertArtifact(value: unknown): ContentAddressedArtifactV1 {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    value.path.startsWith('/') ||
    value.path.split('/').includes('..') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value.path) ||
    typeof value.sha256 !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(value.sha256)
  ) {
    throw new Error('invalid artifact manifest')
  }
  return value as unknown as ContentAddressedArtifactV1
}

function parseManifest(bytes: Uint8Array): CircuitArtifactManifestV1 {
  const value = parseJson(bytes, 'artifact manifest')
  if (
    !isRecord(value) ||
    value.schemaVersion !== 'diesis.circuit-artifact-manifest.v1' ||
    (value.artifactClass !== 'test' && value.artifactClass !== 'production') ||
    !isRecord(value.circuit) ||
    !['transfer-v1', 'withdraw-v1', 'association-v1'].includes(
      value.circuit.id as string,
    ) ||
    value.circuit.version !== 1
  ) {
    throw new Error('invalid artifact manifest')
  }
  assertArtifact(value.wasm)
  assertArtifact(value.zkey)
  assertArtifact(value.verificationKey)
  assertArtifact(value.publicLayout)
  return value as unknown as CircuitArtifactManifestV1
}

async function sha256Digest(bytes: Uint8Array): Promise<`0x${string}`> {
  if (globalThis.crypto?.subtle !== undefined) {
    const input = Uint8Array.from(bytes)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', input)
    return `0x${bytesToHex(new Uint8Array(digest))}`
  }
  return `0x${bytesToHex(sha256(bytes))}`
}

async function assertHash(
  bytes: Uint8Array,
  expected: `0x${string}`,
  label: string,
): Promise<void> {
  if (!/^0x[0-9a-f]{64}$/.test(expected)) {
    throw new Error('invalid expected artifact hash')
  }
  if ((await sha256Digest(bytes)) !== expected) {
    throw new Error(`artifact hash mismatch: ${label}`)
  }
}

function assertPublicLayout(
  bytes: Uint8Array,
  circuitId: PrivacyCircuitIdV1,
): readonly string[] {
  const value = parseJson(bytes, 'public signal layout')
  const expected = PUBLIC_SIGNALS[circuitId]
  if (
    !isRecord(value) ||
    value.schemaVersion !== 'diesis.circuit-layout.v1' ||
    !Array.isArray(value.publicSignals) ||
    value.publicSignals.length !== expected.length ||
    value.publicSignals.some((signal, index) => signal !== expected[index])
  ) {
    throw new Error('public signal layout mismatch')
  }
  return expected
}

export async function loadPrivacyArtifactsV1({
  manifestBytes,
  expectedManifestSha256,
  expectedArtifactClass,
  expectedCircuitId,
  fetch,
}: {
  manifestBytes: Uint8Array
  expectedManifestSha256: `0x${string}`
  expectedArtifactClass: PrivacyArtifactClass
  expectedCircuitId: PrivacyCircuitIdV1
  fetch: ArtifactFetcher
}): Promise<LoadedPrivacyArtifactsV1> {
  await assertHash(manifestBytes, expectedManifestSha256, 'manifest')
  const manifest = parseManifest(manifestBytes)
  if (manifest.artifactClass !== expectedArtifactClass) {
    throw new Error('artifact class mismatch')
  }
  if (manifest.circuit.id !== expectedCircuitId) {
    throw new Error('circuit identity mismatch')
  }

  const [wasm, zkey, verificationKeyBytes, publicLayoutBytes] =
    await Promise.all([
      fetch(manifest.wasm.path),
      fetch(manifest.zkey.path),
      fetch(manifest.verificationKey.path),
      fetch(manifest.publicLayout.path),
    ])
  for (const [bytes, artifact, label] of [
    [wasm, manifest.wasm, 'WASM'],
    [zkey, manifest.zkey, 'zkey'],
    [verificationKeyBytes, manifest.verificationKey, 'verification key'],
    [publicLayoutBytes, manifest.publicLayout, 'public layout'],
  ] as const) {
    if (!(bytes instanceof Uint8Array))
      throw new Error('invalid artifact bytes')
    await assertHash(bytes, artifact.sha256, label)
  }

  return {
    manifest,
    wasm: wasm.slice(),
    zkey: zkey.slice(),
    verificationKey: parseJson(verificationKeyBytes, 'verification key'),
    publicSignals: assertPublicLayout(publicLayoutBytes, expectedCircuitId),
  }
}
