import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown>
  scripts?: Record<string, string>
}

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest

function isRegistrySafeSpecifier(specifier: string): boolean {
  if (
    path.isAbsolute(specifier) ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  ) {
    return false
  }
  if (specifier.startsWith('npm:')) {
    return /^npm:(?:@[^/]+\/)?[^@/]+@[^:/\\]+$/u.test(specifier)
  }
  return (
    /[A-Za-z0-9*]/u.test(specifier) &&
    /^[A-Za-z0-9*<>=~^| ._-]+$/u.test(specifier)
  )
}

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return productionFiles(resolved)
    }
    return entry.isFile() ? [resolved] : []
  })
}

describe('third-party package installability', () => {
  it('does not depend on the contracts source package', () => {
    expect(manifest.dependencies).not.toHaveProperty('@diesis/contracts')
    expect(manifest.devDependencies).not.toHaveProperty('@diesis/contracts')
  })

  it('uses only registry-safe package sources', () => {
    const unsafeDependencies = Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).filter(([, specifier]) => !isRegistrySafeSpecifier(specifier))

    expect(unsafeDependencies).toEqual([])
  })

  it.each([
    'portal:../contracts',
    'tarball:https://example.test/contracts.tgz',
    'patch:@diesis/contracts@1.0.0#patches/contracts.patch',
    'catalog:contracts',
    './contracts',
    '../contracts',
    '/tmp/contracts',
    'file:../contracts',
    'link:../contracts',
    'workspace:*',
    'github:0xDiesis/diesis-contracts',
    'git+https://github.com/0xDiesis/diesis-contracts.git',
    'git@github.com:0xDiesis/diesis-contracts.git',
    'https://example.test/contracts.tgz',
  ])('rejects non-registry dependency source %s', (specifier) => {
    expect(isRegistrySafeSpecifier(specifier)).toBe(false)
  })

  it('contains no production import of the contracts source package', () => {
    const offenders = productionFiles(path.join(packageRoot, 'src'))
      .filter((file) =>
        readFileSync(file, 'utf8').includes('@diesis/contracts'),
      )
      .map((file) => path.relative(packageRoot, file))

    expect(offenders).toEqual([])
  })

  it('publishes all five self-contained ABI entry points', () => {
    const abiExports = Object.keys(manifest.exports ?? {})
      .filter((entry) => entry.startsWith('./abi'))
      .sort()

    expect(abiExports).toEqual([
      './abi',
      './abi/ethers',
      './abi/viem',
      './abi/wagmi',
      './abi/web3js',
    ])
  })

  it('generates contracts before syncing and checks vendoring in quality', () => {
    expect(manifest.scripts?.codegen).toBe(
      'node scripts/sync-contract-abis.mjs --generate',
    )
    expect(manifest.scripts?.['codegen:check']).toBe(
      'node scripts/sync-contract-abis.mjs --check',
    )
    expect(manifest.scripts?.quality).toContain('pnpm run codegen:check')
  })
})
