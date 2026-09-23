import { describe, expect, it } from 'vitest'

import * as abiBarrel from '../src/abi/index.js'
import * as ethersBindings from '../src/abi/bindings/ethers/index.js'
import * as viemEntry from '../src/abi/bindings/viem/index.js'
import * as wagmiBindings from '../src/abi/bindings/wagmi/index.js'
import * as web3Bindings from '../src/abi/bindings/web3js/index.js'
import * as viemBindings from '../src/abi/generated/viem/index.js'
import * as packageRoot from '../src/index.js'

/**
 * The ABI barrel is generated from the contract artifacts; the package root is
 * hand-written. If the root ever restates the ABI list instead of forwarding
 * the barrel, adding a contract silently leaves it unexported from the public
 * entry point — the failure is invisible at both ends. These tests fail when
 * that drift reappears.
 *
 * Both sides are read from the modules themselves rather than from a checked-in
 * list, because a literal list is the defect being removed.
 */
describe('ABI barrel re-export', () => {
  const barrelExports = Object.keys(abiBarrel).sort()
  const rootExports = new Set(Object.keys(packageRoot))

  it('exposes every generated ABI from the package root', () => {
    const missing = barrelExports.filter((name) => !rootExports.has(name))
    expect(missing).toEqual([])
  })

  it('re-exports the identical binding, not a copy', () => {
    // A stale hand-written list can still satisfy a name check while pointing at
    // a different artifact, so compare identity rather than presence.
    const divergent = barrelExports.filter(
      (name) =>
        (packageRoot as Record<string, unknown>)[name] !==
        (abiBarrel as Record<string, unknown>)[name],
    )
    expect(divergent).toEqual([])
  })

  it('has a non-trivial barrel, so an empty import cannot vacuously pass', () => {
    expect(barrelExports.length).toBeGreaterThan(0)
  })

  it('does not broaden the package root with uncurated generated ABIs', () => {
    const generatedExports = new Set(Object.keys(viemBindings))
    const rootAbiExports = Object.keys(packageRoot)
      .filter((name) => generatedExports.has(name))
      .sort()

    expect(rootAbiExports).toEqual(barrelExports)
  })
})

// The ethers v5 entry point imports `ethers` v5 at runtime, so it is covered by
// `tsc -p tsconfig.ethers5.json` rather than imported here next to ethers v6.
describe('ABI provider entry-point parity', () => {
  const providers = {
    viem: viemEntry,
    ethers: ethersBindings,
    wagmi: wagmiBindings,
    web3js: web3Bindings,
  }
  const viemExports = Object.keys(viemBindings).sort()

  it.each(Object.entries(providers))(
    '%s re-exports the identical canonical ABI objects',
    (_provider, bindings) => {
      const divergent = viemExports.filter(
        (name) =>
          (bindings as Record<string, unknown>)[name] !==
          (viemBindings as Record<string, unknown>)[name],
      )
      expect(divergent).toEqual([])
    },
  )

  it.each(Object.entries(providers))(
    '%s re-exports the package root contract table',
    (_provider, bindings) => {
      expect(bindings.diesisContracts).toBe(packageRoot.diesisContracts)
    },
  )

  it.each([
    ['viem', viemEntry, 'getDiesisStakingContract'],
    ['ethers', ethersBindings, 'connectDiesisStaking'],
    ['wagmi', wagmiBindings, 'useDiesisStakingStake'],
    ['web3js', web3Bindings, 'createDiesisStaking'],
  ] as const)(
    '%s exports its generated wrappers',
    (_provider, bindings, name) => {
      expect(typeof (bindings as Record<string, unknown>)[name]).toBe(
        'function',
      )
    },
  )
})
