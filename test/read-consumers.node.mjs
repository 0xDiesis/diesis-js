import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkReadConsumers } from '../scripts/check-read-consumers.mjs'

const declarations = `export interface LegacyRead { id: number }
export interface ControlRead { value: bigint }
export interface CustodyRead { balance: bigint }
export interface BoundSessionRead { authorizationGeneration: bigint }
`

async function withPackageFixture(check) {
  const root = await mkdtemp(path.join(tmpdir(), 'sdk-read-consumer-test-'))
  const manifest = {
    name: '@diesis/sdk',
    type: 'module',
    exports: {
      '.': { import: './dist/index.js', types: './dist/index.d.ts' },
      './exchange': {
        import: './dist/exchange/index.js',
        types: './dist/exchange/index.d.ts',
      },
    },
  }
  const files = {
    'package.json': JSON.stringify(manifest),
    'src/index.ts': declarations,
    'src/exchange/index.ts': declarations,
    'dist/index.d.ts': declarations,
    'dist/exchange/index.d.ts': declarations,
    'dist/index.js': 'export {}\n',
    'dist/exchange/index.js': 'export {}\n',
    'test/types/exchange-consumer.ts': `import type { LegacyRead } from '@diesis/sdk'
import type { LegacyRead as ExchangeLegacyRead } from '@diesis/sdk/exchange'
const legacy: LegacyRead = { id: 1 }
const exchangeLegacy: ExchangeLegacyRead = legacy
void exchangeLegacy
`,
    'test/types/control-reads-consumer.ts': `import type { ControlRead } from '../../src/index.js'
import type { ControlRead as ExchangeControlRead } from '../../src/exchange/index.js'
const rootRead: ControlRead = { value: 1n }
const exchangeRead: ExchangeControlRead = { value: 2n }
const rootValue: bigint = rootRead.value
const exchangeValue: bigint = exchangeRead.value
void [rootValue, exchangeValue]
`,
    'test/types/custody-read-consumer.ts': `import type { CustodyRead } from '../../src/exchange/index.js'
const custody: CustodyRead = { balance: 3n }
const balance: bigint = custody.balance
void balance
`,
    'test/types/bound-session-consumer.ts': `import type { BoundSessionRead } from '../../src/exchange/index.js'
const bound: BoundSessionRead = { authorizationGeneration: 3n }
const generation: bigint = bound.authorizationGeneration
void generation
`,
    // A similarly named directory belongs to another task and must survive.
    '.read-consumers-retained/evidence.txt':
      'retain this unrelated directory\n',
  }
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(root, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents)
    }
    await check(root, manifest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function fileInventory(root, relative = '') {
  const files = {}
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = path.join(relative, entry.name)
    if (entry.isDirectory())
      Object.assign(files, await fileInventory(root, name))
    else files[name] = await readFile(path.join(root, name), 'utf8')
  }
  return files
}

async function preservingFixture(root, check) {
  const directories = (await readdir(root)).sort()
  const files = await fileInventory(root)
  try {
    await check()
  } finally {
    assert.deepEqual(
      (await readdir(root)).sort(),
      directories,
      'runner must remove its temporary directory and retain existing entries',
    )
    assert.deepEqual(
      await fileInventory(root),
      files,
      'runner must preserve fixture source, declarations, exports and evidence',
    )
  }
}

async function rejectsCompilerError(root, targetedDiagnostic) {
  await preservingFixture(root, async () => {
    await assert.rejects(checkReadConsumers(root), (error) => {
      const diagnostics = [error.message, error.stdout, error.stderr]
        .filter((value) => typeof value === 'string')
        .join('\n')
        .replaceAll('\\', '/')
      assert.match(diagnostics, /error TS\d+:/)
      assert.match(diagnostics, targetedDiagnostic)
      return true
    })
  })
}

test('accepts valid source and both built package entries and removes only its temporary files', async () => {
  await withPackageFixture(async (root) => {
    await preservingFixture(root, () => checkReadConsumers(root))
  })
})

test('rejects incompatible read declarations exposed only by the built root', async () => {
  await withPackageFixture(async (root) => {
    await writeFile(
      path.join(root, 'dist/index.d.ts'),
      declarations.replace('value: bigint', 'value: string'),
    )
    await rejectsCompilerError(
      root,
      /\.read-consumers-[^/\s]+\/control-root\.ts\(\d+,\d+\): error TS2322:.*(?:bigint.*string|string.*bigint)/,
    )
  })
})

test('rejects a read interface missing only from the built exchange barrel', async () => {
  await withPackageFixture(async (root) => {
    await writeFile(
      path.join(root, 'dist/exchange/index.d.ts'),
      declarations.replace(
        'export interface CustodyRead { balance: bigint }\n',
        '',
      ),
    )
    await rejectsCompilerError(
      root,
      /\.read-consumers-[^/\s]+\/custody-exchange\.ts\(\d+,\d+\): error TS2305:.*CustodyRead/,
    )
  })
})

test('uses NodeNext package exports even when the exchange declaration still exists', async () => {
  await withPackageFixture(async (root, manifest) => {
    delete manifest.exports['./exchange']
    await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest))
    await rejectsCompilerError(
      root,
      /error TS2307: Cannot find module '@diesis\/sdk\/exchange'/,
    )
  })
})

test('rejects an incompatible original source consumer while built declarations remain valid', async () => {
  await withPackageFixture(async (root) => {
    await writeFile(
      path.join(root, 'src/exchange/index.ts'),
      declarations.replace('balance: bigint', 'balance: string'),
    )
    await rejectsCompilerError(
      root,
      /test\/types\/custody-read-consumer\.ts\(\d+,\d+\): error TS2322:.*(?:bigint.*string|string.*bigint)/,
    )
  })
})

for (const entry of ['root', 'exchange']) {
  test(`rejects bound-session drift exposed only by built ${entry}`, async () => {
    await withPackageFixture(async (root) => {
      await writeFile(
        path.join(
          root,
          entry === 'root' ? 'dist/index.d.ts' : 'dist/exchange/index.d.ts',
        ),
        declarations.replace(
          'authorizationGeneration: bigint',
          'authorizationGeneration: string',
        ),
      )
      await rejectsCompilerError(
        root,
        /bound-session-(?:root|exchange)\.ts\(\d+,\d+\): error TS2322:/,
      )
    })
  })
}
