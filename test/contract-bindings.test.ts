import { JsonRpcProvider } from 'ethers'
import { getContract, createPublicClient, http } from 'viem'
import { describe, expect, it } from 'vitest'
import { Web3 } from 'web3'

import * as addresses from '../src/addresses.js'
import {
  connectDiesisStaking,
  connectIWrappedDS,
} from '../src/abi/bindings/ethers/index.js'
import { getDiesisStakingContract } from '../src/abi/bindings/viem/index.js'
import { createDiesisStaking } from '../src/abi/bindings/web3js/index.js'
import { DiesisStakingAbi, IWrappedDSAbi } from '../src/abi/index.js'
import { diesis } from '../src/chains.js'
import { diesisContracts } from '../src/index.js'

describe('diesisContracts', () => {
  const addressValues = new Set<string>(Object.values(addresses))

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
    expect(typeof staking.stake).toBe('function')
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

describe('viem wrappers', () => {
  it('bind the fixed address with the shared ABI', () => {
    const client = createPublicClient({ chain: diesis, transport: http() })
    const staking = getDiesisStakingContract(
      diesisContracts.staking.address,
      client,
    )

    expect(staking.address).toBe(addresses.DIESIS_STAKING)
    expect(staking.abi).toBe(DiesisStakingAbi)
  })
})

describe('web3.js wrappers', () => {
  it('return a web3 Contract bound to the fixed address', () => {
    const staking = createDiesisStaking(
      new Web3('http://127.0.0.1:1'),
      diesisContracts.staking.address,
    )

    expect(staking.options.address?.toLowerCase()).toBe(
      addresses.DIESIS_STAKING.toLowerCase(),
    )
    expect(staking.methods.unclaimedRewards(42n).encodeABI()).toMatch(/^0x/u)
  })
})
