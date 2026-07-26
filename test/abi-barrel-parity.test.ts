import { describe, expect, it } from 'vitest'

import * as abiBarrel from '../src/abi/index.js'
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
})
