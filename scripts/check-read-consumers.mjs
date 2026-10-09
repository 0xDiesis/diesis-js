import process from 'node:process'
import console from 'node:console'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const require = createRequire(import.meta.url)
const sdkRoot = fileURLToPath(new URL('../', import.meta.url))
const readFixtures = [
  { name: 'control', file: 'test/types/control-reads-consumer.ts' },
  { name: 'custody', file: 'test/types/custody-read-consumer.ts' },
  { name: 'bound-session', file: 'test/types/bound-session-consumer.ts' },
]
const entries = [
  { name: 'root', specifier: '@diesis/sdk' },
  { name: 'exchange', specifier: '@diesis/sdk/exchange' },
]

function builtConsumer(source, specifier, file) {
  let replacements = 0
  const rewritten = source.replace(
    /(['"])\.\.\/\.\.\/src\/(?:exchange\/)?index\.js\1/g,
    (_, quote) => {
      replacements += 1
      return `${quote}${specifier}${quote}`
    },
  )
  const consumer = rewritten.replace(
    /(['"])\.\.\/\.\.\/src\/abi\/bindings\/viem\/index\.js\1/g,
    (_, quote) => `${quote}@diesis/sdk/abi/viem${quote}`,
  )
  if (replacements === 0)
    throw new Error(`${file} has no supported SDK source import`)
  if (/(['"])(?:\.{1,2}\/)+src\/[^'"]+\1/.test(consumer))
    throw new Error(`${file} retains an SDK source import after rewriting`)
  return consumer
}

export async function checkReadConsumers(packageRoot = sdkRoot) {
  const root = path.resolve(packageRoot)
  const compiler = require.resolve('typescript/bin/tsc')
  const variants = []
  for (const fixture of readFixtures) {
    const source = await readFile(path.join(root, fixture.file), 'utf8')
    for (const entry of entries)
      variants.push({
        name: `${fixture.name}-${entry.name}.ts`,
        source: builtConsumer(source, entry.specifier, fixture.file),
      })
  }

  const temporary = await mkdtemp(path.join(root, '.read-consumers-'))
  try {
    const inputs = [
      path.join(root, 'test/types/exchange-consumer.ts'),
      ...readFixtures.map((fixture) => path.join(root, fixture.file)),
    ]
    for (const variant of variants) {
      const target = path.join(temporary, variant.name)
      await writeFile(target, variant.source)
      inputs.push(target)
    }
    try {
      return await exec(
        process.execPath,
        [
          compiler,
          '--ignoreConfig',
          '--noEmit',
          '--strict',
          '--target',
          'ES2022',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--skipLibCheck',
          ...inputs,
        ],
        { cwd: root, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      )
    } catch (error) {
      throw new Error(
        `Read consumer TypeScript check failed: ${error.message}\n${error.stdout ?? ''}${error.stderr ?? ''}`,
        { cause: error },
      )
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { stdout, stderr } = await checkReadConsumers()
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    console.log(
      'Read consumers passed for source and built root/exchange entries.',
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
