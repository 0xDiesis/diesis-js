import { JsonRpcProvider } from 'ethers'
import { getContract, createPublicClient, http } from 'viem'
import { describe, expect, it } from 'vitest'

import * as addresses from '../src/addresses.js'
import {
  connectDiesisStaking,
  connectIWrappedDS,
} from '../src/abi/bindings/ethers/index.js'
import { DiesisStakingAbi, IWrappedDSAbi } from '../src/abi/index.js'
import { diesis } from '../src/chains.js'
import { diesisContracts } from '../src/index.js'

describe('diesisContracts', () => {
  const addressValues = new Set<string>(
    Object.values(addresses).filter(
      (value): value is string => typeof value === 'string',
    ),
  )

  it('points every entry at a canonical system address', () => {
    const unknown = Object.entries(diesisContracts)
      .filter(([, entry]) => !addressValues.has(entry.address))
      .map(([key]) => key)

    expect(unknown).toEqual([])
  })

  it('pairs each address with the shared ABI object', () => {
    expect(diesisContracts.staking.address).toBe(addresses.DIESIS_STAKING)
    expect(diesisContracts.staking.abi).toBe(DiesisStakingAbi)
    expect(diesisContracts.wrappedDS.abi).toBe(IWrappedDSAbi)
  })

  it('spreads into viem getContract', () => {
    const client = createPublicClient({ chain: diesis, transport: http() })
    const staking = getContract({ ...diesisContracts.staking, client })

    expect(staking.address).toBe(addresses.DIESIS_STAKING)
    expect(typeof staking.read.nodeLedger).toBe('function')
  })
})

describe('ethers v6 wrappers', () => {
  const provider = new JsonRpcProvider('http://127.0.0.1:1', diesis.id, {
    staticNetwork: true,
  })

  it('connect to the fixed address with the shared ABI', async () => {
    const staking = connectDiesisStaking(
      diesisContracts.staking.address,
      provider,
    )

    expect(await staking.getAddress()).toBe(addresses.DIESIS_STAKING)
    expect(staking.interface.getFunction('stake')?.payable).toBe(true)
  })

  it('encode calls from the typed interface', () => {
    const wrappedDS = connectIWrappedDS(
      diesisContracts.wrappedDS.address,
      provider,
    )

    expect(
      wrappedDS.interface.encodeFunctionData('withdraw', [1n]).slice(0, 10),
    ).toBe('0x2e1a7d4d')
  })
})
