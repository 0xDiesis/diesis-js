import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const sdkRoot = fileURLToPath(new URL('../', import.meta.url))
async function testInventory(directory, prefix = 'test') {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`
    if (entry.isDirectory())
      paths.push(
        ...(await testInventory(path.join(directory, entry.name), relative)),
      )
    else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
      paths.push(relative)
  }
  return paths.sort()
}

test('SDK Vitest discovery retains its suites and excludes nested downstream checkouts', async () => {
  const inventory = await testInventory(path.join(sdkRoot, 'test'))
  const expected = inventory.filter((name) => !name.startsWith('test/browser/'))
  assert(expected.includes('test/privacy/real-proof.test.ts'))
  assert(expected.includes('test/privacy/contracts-circuits-root.test.ts'))
  const fixture = await mkdtemp(path.join(tmpdir(), 'diesis-sdk-discovery-'))
  console.log(`Discovery fixture: ${fixture}`)
  try {
    const decoys = [
      'contracts-checkout/circuits/test/downstream.test.ts',
      'other-project/test/downstream.spec.ts',
      'root.test.ts',
      'node_modules/foreign/test/dependency.test.ts',
    ]
    for (const relative of [...inventory, ...decoys]) {
      const target = path.join(fixture, relative)
      await mkdir(path.dirname(target), { recursive: true })
      // Listing must not import any suite, including legitimate proof fixtures.
      await writeFile(
        target,
        "throw new Error('Discovery must not execute test bodies')\n",
      )
    }
    let result
    try {
      result = await exec(
        process.execPath,
        [
          path.join(sdkRoot, 'node_modules/vitest/vitest.mjs'),
          'list',
          '--filesOnly',
          '--json',
          '--root',
          fixture,
          '--config',
          path.join(sdkRoot, 'vite.config.ts'),
          '--exclude',
          'test/browser/**',
        ],
        { cwd: sdkRoot, timeout: 15000, maxBuffer: 1024 * 1024 },
      )
    } catch (error) {
      throw new Error(
        `Vitest listing failed: ${error.message}\n${String(error.stdout ?? '').slice(0, 4096)}\n${String(error.stderr ?? '').slice(0, 4096)}`,
        { cause: error },
      )
    }
    let listed
    try {
      listed = JSON.parse(result.stdout)
    } catch (error) {
      throw new Error(
        `Invalid Vitest list JSON: ${result.stdout.slice(0, 4096)}\n${result.stderr.slice(0, 4096)}`,
        { cause: error },
      )
    }
    assert(Array.isArray(listed), 'Vitest file listing must be an array')
    const actual = listed
      .map((entry) => {
        const file = typeof entry === 'string' ? entry : entry.file
        assert.equal(typeof file, 'string', 'Listed test requires a file path')
        return path.relative(fixture, file).split(path.sep).join('/')
      })
      .sort()
    assert.deepEqual(actual, expected)
  } finally {
    await rm(fixture, { recursive: true, force: true })
    console.log(`Removed discovery fixture: ${fixture}`)
  }
})
