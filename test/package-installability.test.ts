import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown>
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest

describe('third-party package installability', () => {
  it('does not depend on the contracts source package', () => {
    expect(manifest.dependencies).not.toHaveProperty('@diesis/contracts')
    expect(manifest.devDependencies).not.toHaveProperty('@diesis/contracts')
  })

  it('does not depend on local or exotic package sources', () => {
    const exoticDependencies = Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).filter(([, specifier]) =>
      /^(?:bitbucket:|file:|git(?:\+[^:]+)?:|git@|github:|gitlab:|https?:|link:|ssh:|workspace:)/u.test(
        specifier,
      ),
    )

    expect(exoticDependencies).toEqual([])
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
})
