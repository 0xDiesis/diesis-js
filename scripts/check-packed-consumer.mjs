#!/usr/bin/env node
import process from 'node:process'
import console from 'node:console'
import { execFile } from 'node:child_process'
import {
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  rm,
  realpath,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
const exec = promisify(execFile)
const sdk = fileURLToPath(new URL('../', import.meta.url))
if (process.argv.length !== 3)
  throw new Error(
    'Usage: node scripts/check-packed-consumer.mjs /absolute/path/to/sdk.tgz',
  )
const tarball = await realpath(process.argv[2])
if (!tarball.endsWith('.tgz')) throw new Error('Expected prebuilt tarball')
const consumer = await mkdtemp(path.join(tmpdir(), 'diesis-sdk-packed-'))
try {
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      packageManager: 'pnpm@12.6.0',
      dependencies: {
        '@diesis/sdk': `file:${tarball}`,
        viem: '2.55.10',
        typescript: '6.0.3',
        '@types/node': '24.12.3',
      },
    }),
  )
  const install = await exec('pnpm', ['install', '--ignore-scripts'], {
    cwd: consumer,
    env: { ...process.env, TMPDIR: tmpdir() },
    maxBuffer: 4 * 1024 * 1024,
  })
  console.log(install.stdout)
  const fixture = path.join(consumer, 'consumer.mjs')
  await copyFile(path.join(sdk, 'test/fixtures/packed-consumer.mjs'), fixture)
  await writeFile(
    path.join(consumer, 'consumer.ts'),
    `import {readNativeName,decodeSignedActionError,type NativeNamesRpc,type NativeNameObservationV1} from '@diesis/sdk';\nimport {diesis} from '@diesis/sdk/chains';\nimport {readNativeName as subpath} from '@diesis/sdk/names';\nimport {DiesisPublicResolverAbi} from '@diesis/sdk/abi';\nimport {decodeSignedActionError as decoder} from '@diesis/sdk/rpc-errors';\nconst rpc: NativeNamesRpc={identity:()=> 'fixture',request:async()=>undefined};\nconst read:Promise<NativeNameObservationV1>=readNativeName(rpc,{chainId:1980},'alice.ds');\nvoid read;void subpath;void decoder;void decodeSignedActionError;void diesis;void DiesisPublicResolverAbi;\n`,
  )
  await exec(
    'pnpm',
    [
      'exec',
      'tsc',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'consumer.ts',
    ],
    { cwd: consumer, maxBuffer: 4 * 1024 * 1024 },
  )
  const runtime = await exec(process.execPath, [fixture], {
    cwd: consumer,
    maxBuffer: 4 * 1024 * 1024,
  })
  console.log(runtime.stdout.trim())
  console.log(
    JSON.stringify({
      tarballSha256: createHash('sha256')
        .update(await readFile(tarball))
        .digest('hex'),
      declarations: 'pass',
      sourceImports: false,
      consumerRemoved: consumer,
    }),
  )
} finally {
  await rm(consumer, { recursive: true, force: true })
}
