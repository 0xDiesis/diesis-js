import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown>
  files?: string[]
  publishConfig?: { access?: string }
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

  it('publishes all six self-contained ABI entry points', () => {
    const abiExports = Object.keys(manifest.exports ?? {})
      .filter((entry) => entry.startsWith('./abi'))
      .sort()

    expect(abiExports).toEqual([
      './abi',
      './abi/ethers',
      './abi/ethers5',
      './abi/viem',
      './abi/wagmi',
      './abi/web3js',
    ])
  })

  it('publishes the canonical chain data contract', () => {
    expect(manifest.exports?.['./canonical.json']).toBe('./canonical.json')
    expect(manifest.files).toContain('canonical.json')
    expect(manifest.publishConfig?.access).toBe('public')
  })

  it('denies the one transitive native build needed for Git installs', () => {
    const workspaceConfig = new URL('../pnpm-workspace.yaml', import.meta.url)

    expect(existsSync(workspaceConfig)).toBe(true)
    const config = readFileSync(workspaceConfig, 'utf8')
    expect(config).toContain('allowBuilds:\n  blake-hash: false\n')
    expect(config.match(/^  [^\n]+:/gmu)).toEqual(['  blake-hash:'])
  })

  it('documents the pinned authenticated Git install', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

    expect(readme).not.toContain('npm install @diesis/sdk')
    expect(readme).toContain(
      "pnpm add 'git+https://github.com/0xDiesis/diesis-sdk.git#<commit>'",
    )
  })

  it('generates contracts before syncing and checks vendoring in quality', () => {
    expect(manifest.scripts?.codegen).toBe(
      'node scripts/sync-contract-abis.mjs --generate && node scripts/generate-contract-bindings.mjs',
    )
    expect(manifest.scripts?.['codegen:check']).toBe(
      'node scripts/sync-contract-abis.mjs --check && node scripts/generate-contract-bindings.mjs --check',
    )
    expect(manifest.scripts?.quality).toContain('pnpm run codegen:check')
  })
})
