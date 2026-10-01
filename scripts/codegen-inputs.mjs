import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const exec = promisify(execFile)
export const sdkRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
export async function codegenInputs() {
  for (const name of [
    'DIESIS_ARTIFACT_MANIFEST',
    'DIESIS_ARTIFACTS_DIR',
    'DIESIS_ARTIFACT_PREFLIGHT',
    'ABI_TYPEGEN',
  ]) {
    if (!process.env[name] || !path.isAbsolute(process.env[name]))
      throw new Error(`${name} must be an explicit absolute path`)
  }
  const artifacts = await realpath(process.env.DIESIS_ARTIFACTS_DIR)
  const manifest = await realpath(process.env.DIESIS_ARTIFACT_MANIFEST)
  // Missing or failing verifier blocks generation. It must independently recompute provenance.
  await exec('python3', [
    path.join(sdkRoot, 'scripts/verify-contract-artifacts.py'),
    '--preflight',
    process.env.DIESIS_ARTIFACT_PREFLIGHT,
    '--check',
    manifest,
  ])
  const proof = JSON.parse(await readFile(manifest, 'utf8'))
  if (proof.contractsRevision !== 'e905d65c6a52df39f1d73906e9f5e91bd69011e9')
    throw new Error('Wrong contracts revision')
  if ((await realpath(proof.artifactRoot)) !== artifacts)
    throw new Error('Artifact root mismatch')
  const inventory = JSON.parse(
    await readFile(path.join(sdkRoot, 'scripts/abi-contracts.json'), 'utf8'),
  ).sort()
  const selected = proof.selectedArtifacts
    ?.map((entry) => entry.contract)
    .sort()
  if (JSON.stringify(selected) !== JSON.stringify(inventory))
    throw new Error('Manifest ABI inventory mismatch')
  const typegen = await realpath(process.env.ABI_TYPEGEN)
  const binarySha256 = createHash('sha256')
    .update(await readFile(typegen))
    .digest('hex')
  if (
    proof.generator?.binarySha256 !== binarySha256 ||
    proof.generator?.version !== 'abi-typegen 0.7.0' ||
    proof.generator?.sourceCommit !== 'e7e56176a4be4dd104ec3a05020fbacee414f88e'
  )
    throw new Error('Generator provenance mismatch')
  const { stdout } = await exec(typegen, ['--version'])
  if (!/^abi-typegen 0\.7\.0\s*$/.test(stdout))
    throw new Error(`Exact abi-typegen 0.7.0 required: ${stdout.trim()}`)
  return { artifacts, typegen }
}
