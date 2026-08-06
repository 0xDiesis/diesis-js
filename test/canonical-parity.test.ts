import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import * as addresses from '../src/addresses.js'
import { diesis, diesisTestnet } from '../src/chains.js'

type CanonicalChain = {
  id: number
  name: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  rpcUrl: string
  explorerUrl: string
  testnet: boolean
}

type CanonicalData = {
  schemaVersion: number
  chains: { mainnet: CanonicalChain; testnet: CanonicalChain }
  addresses: Record<string, string>
}

const canonical = JSON.parse(
  readFileSync(new URL('../canonical.json', import.meta.url), 'utf8'),
) as CanonicalData

function chainShape(chain: typeof diesis): CanonicalChain {
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrl: chain.rpcUrls.default.http[0],
    explorerUrl: chain.blockExplorers.default.url,
    testnet: chain.testnet ?? false,
  }
}

describe('canonical chain data contract', () => {
  it('matches the exported chain definitions', () => {
    expect(canonical.schemaVersion).toBe(1)
    expect(canonical.chains).toEqual({
      mainnet: chainShape(diesis),
      testnet: chainShape(diesisTestnet),
    })
  })

  it('matches every exported address', () => {
    const exportedAddresses = Object.fromEntries(
      Object.entries(addresses).filter(
        ([, value]) => typeof value === 'string' && value.startsWith('0x'),
      ),
    )

    expect(canonical.addresses).toEqual(exportedAddresses)
    expect(Object.keys(canonical.addresses)).toHaveLength(41)
  })
})
