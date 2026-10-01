import process from 'node:process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  chmod,
  rm,
  copyFile,
  realpath,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
const exec = promisify(execFile)
test('requires explicit artifact paths before invoking any generator', async () => {
  await assert.rejects(
    exec(process.execPath, ['scripts/sync-contract-abis.mjs', '--check'], {
      env: {
        ...process.env,
        DIESIS_ARTIFACT_MANIFEST: '',
        DIESIS_ARTIFACTS_DIR: '',
      },
    }),
    /DIESIS_ARTIFACT_MANIFEST/,
  )
})
test('requires an explicit absolute raw generator before verification', async () => {
  for (const generator of ['', 'relative/typegen']) {
    await assert.rejects(
      exec(process.execPath, ['scripts/sync-contract-abis.mjs', '--check'], {
        env: {
          ...process.env,
          DIESIS_ARTIFACT_MANIFEST: '/fixture/manifest',
          DIESIS_ARTIFACTS_DIR: '/fixture/artifacts',
          DIESIS_ARTIFACT_PREFLIGHT: '/fixture/preflight',
          ABI_TYPEGEN: generator,
        },
      }),
      /ABI_TYPEGEN must be an explicit absolute path/,
    )
  }
})
test('missing verifier fails closed before generator execution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sdk-codegen-test-'))
  try {
    await mkdir(path.join(root, 'scripts'))
    await copyFile(
      'scripts/codegen-inputs.mjs',
      path.join(root, 'scripts/codegen-inputs.mjs'),
    )
    await copyFile(
      'scripts/abi-contracts.json',
      path.join(root, 'scripts/abi-contracts.json'),
    )
    await writeFile(path.join(root, 'manifest.json'), '{}')
    await assert.rejects(
      exec(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {codegenInputs} from ${JSON.stringify(path.join(root, 'scripts/codegen-inputs.mjs'))}; await codegenInputs()`,
        ],
        {
          env: {
            ...process.env,
            DIESIS_ARTIFACT_MANIFEST: path.join(root, 'manifest.json'),
            DIESIS_ARTIFACTS_DIR: root,
            DIESIS_ARTIFACT_PREFLIGHT: path.join(root, 'manifest.json'),
            ABI_TYPEGEN: '/must/not/execute',
          },
        },
      ),
      /verify-contract-artifacts/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('rejects wrong generator digest before running executable after fake verifier fixture', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sdk-codegen-test-'))
  try {
    await mkdir(path.join(root, 'scripts'))
    await copyFile(
      'scripts/codegen-inputs.mjs',
      path.join(root, 'scripts/codegen-inputs.mjs'),
    )
    // Fake verifier is confined to this test fixture; production requires the real verifier.
    await writeFile(
      path.join(root, 'scripts/verify-contract-artifacts.py'),
      'import sys\nsys.exit(0)\n',
    )
    const binary = path.join(root, 'fake-typegen')
    await writeFile(binary, '#!/bin/sh\nprintf "abi-typegen 0.7.0\\n"\n')
    await chmod(binary, 0o700)
    await copyFile(
      'scripts/abi-contracts.json',
      path.join(root, 'scripts/abi-contracts.json'),
    )
    const proof = {
      selectedArtifacts: JSON.parse(
        await readFile('scripts/abi-contracts.json', 'utf8'),
      ).map((contract) => ({ contract })),
      artifactRoot: root,
      contractsRevision: 'e905d65c6a52df39f1d73906e9f5e91bd69011e9',
      generator: {
        version: 'abi-typegen 0.7.0',
        sourceCommit: 'e7e56176a4be4dd104ec3a05020fbacee414f88e',
        binarySha256: '0'.repeat(64),
      },
    }
    const manifest = path.join(root, 'manifest.json')
    await writeFile(manifest, JSON.stringify(proof))
    const args = [
      '--input-type=module',
      '-e',
      `import {codegenInputs} from ${JSON.stringify(path.join(root, 'scripts/codegen-inputs.mjs'))}; await codegenInputs()`,
    ]
    const options = {
      env: {
        ...process.env,
        DIESIS_ARTIFACT_MANIFEST: manifest,
        DIESIS_ARTIFACTS_DIR: root,
        DIESIS_ARTIFACT_PREFLIGHT: path.join(root, 'manifest.json'),
        ABI_TYPEGEN: binary,
      },
    }
    await assert.rejects(
      exec(process.execPath, args, options),
      /Generator provenance mismatch/,
    )
    proof.generator.binarySha256 = createHash('sha256')
      .update(await readFile(binary))
      .digest('hex')
    await writeFile(manifest, JSON.stringify(proof))
    await exec(process.execPath, args, options)
    await writeFile(binary, '#!/bin/sh\nprintf "abi-typegen 0.8.0\\n"\n')
    proof.generator.binarySha256 = createHash('sha256')
      .update(await readFile(binary))
      .digest('hex')
    await writeFile(manifest, JSON.stringify(proof))
    await assert.rejects(
      exec(process.execPath, args, options),
      /Exact abi-typegen/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('helpers have no contracts-owned build or stale ABI source fallback', async () => {
  for (const name of [
    'sync-contract-abis.mjs',
    'generate-contract-bindings.mjs',
    'codegen-inputs.mjs',
  ]) {
    const source = await readFile(`scripts/${name}`, 'utf8')
    assert.doesNotMatch(
      source,
      /contractsRoot|DIESIS_CONTRACTS_DIR|abi:generate|contracts\/out|minimumTypegen/,
    )
  }
  const names = JSON.parse(await readFile('scripts/abi-contracts.json', 'utf8'))
  assert.equal(names.length, 45)
  assert.equal(new Set(names).size, 45)
})
test('whole sync --check uses direct single-target viem output and ABI-only inventory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sdk-sync-layout-test-'))
  try {
    await mkdir(path.join(root, 'scripts'))
    for (const file of [
      'sync-contract-abis.mjs',
      'codegen-inputs.mjs',
      'abi-contracts.json',
    ])
      await copyFile(`scripts/${file}`, path.join(root, 'scripts', file))
    // No production verifier or artifact proof is bypassed outside this isolated fixture.
    await writeFile(
      path.join(root, 'scripts/verify-contract-artifacts.py'),
      'import sys\nsys.exit(0)\n',
    )
    const contracts = JSON.parse(
      await readFile('scripts/abi-contracts.json', 'utf8'),
    )
    const binary = path.join(root, 'fake-typegen')
    await writeFile(
      binary,
      `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('abi-typegen 0.7.0');process.exit(0)};fs.writeFileSync(${JSON.stringify(path.join(root, 'argv.json'))},JSON.stringify(args));const out=args[args.indexOf('--out')+1];fs.mkdirSync(out,{recursive:true});const names=args[args.indexOf('--contracts')+1].split(',');for(const name of names)fs.writeFileSync(path.join(out,name+'.abi.ts'),'export const '+name+'Abi = [] as const\\n');fs.writeFileSync(path.join(out,'index.ts'),'// fixture ABI index\\n');if(!args.includes('--no-wrappers'))fs.writeFileSync(path.join(out,'wrapper.ts'),'// wrapper\\n');\n`,
    )
    await chmod(binary, 0o700)
    const destination = path.join(root, 'src/abi/generated/viem')
    await mkdir(destination, { recursive: true })
    for (const name of contracts)
      await writeFile(
        path.join(destination, `${name}.abi.ts`),
        `export const ${name}Abi = [] as const\n`,
      )
    await writeFile(
      path.join(destination, 'index.ts'),
      '// fixture ABI index\n',
    )
    await writeFile(
      path.join(root, 'src/abi/index.ts'),
      "export * from './generated/viem/index.js'\n",
    )
    const manifest = path.join(root, 'manifest.json')
    await writeFile(
      manifest,
      JSON.stringify({
        selectedArtifacts: contracts.map((contract) => ({ contract })),
        artifactRoot: root,
        contractsRevision: 'e905d65c6a52df39f1d73906e9f5e91bd69011e9',
        generator: {
          version: 'abi-typegen 0.7.0',
          sourceCommit: 'e7e56176a4be4dd104ec3a05020fbacee414f88e',
          binarySha256: createHash('sha256')
            .update(await readFile(binary))
            .digest('hex'),
        },
      }),
    )
    const options = {
      env: {
        ...process.env,
        DIESIS_ARTIFACT_MANIFEST: manifest,
        DIESIS_ARTIFACTS_DIR: root,
        DIESIS_ARTIFACT_PREFLIGHT: manifest,
        ABI_TYPEGEN: binary,
      },
    }
    await exec(
      process.execPath,
      [path.join(root, 'scripts/sync-contract-abis.mjs'), '--check'],
      options,
    )
    const argv = JSON.parse(
      await readFile(path.join(root, 'argv.json'), 'utf8'),
    )
    assert.equal(argv[0], 'generate')
    assert.equal(argv[argv.indexOf('--target') + 1], 'viem')
    assert.equal(argv[argv.indexOf('--artifacts') + 1], await realpath(root))
    assert.equal(path.basename(argv[argv.indexOf('--out') + 1]), 'viem')
    assert.ok(argv.includes('--no-wrappers'))
    assert.deepEqual(
      argv[argv.indexOf('--contracts') + 1].split(','),
      contracts,
    )
    // Check mode must still catch byte drift and stale unexpected inventory.
    await writeFile(
      path.join(destination, `${contracts[0]}.abi.ts`),
      '// stale bytes\n',
    )
    await assert.rejects(
      exec(
        process.execPath,
        [path.join(root, 'scripts/sync-contract-abis.mjs'), '--check'],
        options,
      ),
      /ABI vendor is stale/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid sync arguments create no ABI temporary directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sdk-sync-invalid-args-'))
  try {
    await mkdir(path.join(root, 'scripts'))
    await mkdir(path.join(root, 'tmp'))
    await copyFile(
      'scripts/sync-contract-abis.mjs',
      path.join(root, 'scripts/sync-contract-abis.mjs'),
    )
    // Isolate argument handling; no real verifier, artifact or generator execution.
    await writeFile(
      path.join(root, 'scripts/codegen-inputs.mjs'),
      "export async function codegenInputs() { return { artifacts: 'fixture', typegen: 'fixture' } }\n",
    )
    for (const args of [['--invalid'], ['--check', 'extra']]) {
      await assert.rejects(
        exec(
          process.execPath,
          [path.join(root, 'scripts/sync-contract-abis.mjs'), ...args],
          { env: { ...process.env, TMPDIR: path.join(root, 'tmp') } },
        ),
        /usage: sync-contract-abis/,
      )
      assert.deepEqual(await readdir(path.join(root, 'tmp')), [])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
