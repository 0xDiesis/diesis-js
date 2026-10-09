import {
  decodeFunctionData,
  getAddress,
  keccak256,
  type Address,
  type Chain,
  type Hex,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'

import {
  IDiesisIssuanceAuctionAbi,
  IDiesisOperatorBondAbi,
  IDiesisPerpDeployAbi,
} from '../src/abi/index.js'
import * as addresses from '../src/addresses.js'
import {
  computeUnpricedPerpDeploymentEvidence,
  computeUnpricedPerpRegistrationDigest,
  createPerpLifecycle,
  createUnpricedPerpRegistration,
  currentPerpListingPrice,
  getPerpDeploymentState,
  getPerpListingSlot,
  PERP_CANONICAL_USDC,
  PERP_OPERATOR_BOND_VALUE,
  perpMarketId,
  type InitializeBasicPerpMarketParams,
  type InitializePolicyPerpMarketParams,
  type PerpLifecycleAttempt,
  type PerpLifecycleReader,
  type PerpLifecycleWallet,
} from '../src/exchange/perp-lifecycle.js'

const owner = '0x1111111111111111111111111111111111111111' as Address
const base = '0x2222222222222222222222222222222222222222' as Address
const hash = `0x${'ab'.repeat(32)}` as Hex
const slotId = `0x${'31'.repeat(32)}` as Hex
const payload = {
  sourceList: '0x0102',
  metadata: '0x0304',
  signatures: '0x0506',
} as const
const { registration, registrationDigest } = createUnpricedPerpRegistration({
  baseAsset: base,
  quoteAsset: PERP_CANONICAL_USDC,
  ...payload,
})
const initialV1: InitializeBasicPerpMarketParams = {
  baseToken: base,
  quoteToken: PERP_CANONICAL_USDC,
  tickSize: 5n,
  lotSize: 1n,
  maxOpenInterest: 1_000n,
  initialMark: 100n,
  maxLeverage: 10,
}
const initialV2: InitializePolicyPerpMarketParams = {
  baseToken: base,
  quoteToken: PERP_CANONICAL_USDC,
  tickSize: 5n,
  lotSize: 1n,
  maxOpenInterest: 1_000n,
  initialMark: 100n,
  policy: {
    revision: 1n,
    backstopTopupBps: 200,
    tiers: [
      { maxNotional: 1_000n, maxLeverage: 10, maintenanceMarginBps: 500 },
    ],
  },
  keyset: { epoch: 1n, threshold: 1, signers: [owner] },
}

function clients() {
  const chain: Chain = {
    id: 1980,
    name: 'Diesis',
    nativeCurrency: { name: 'Diesis', symbol: 'DS', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  }
  const events: string[] = []
  const reader = {
    getChainId: vi.fn(async () => chain.id),
    readContract: vi.fn(async (_request: unknown) => 123n),
    estimateGas: vi.fn(async (_request: unknown) => {
      events.push('estimate')
      return 101n
    }),
    getTransactionCount: vi.fn(async (_request: unknown) => {
      events.push('nonce')
      return 7
    }),
  }
  const wallet = {
    account: { type: 'json-rpc', address: owner },
    chain,
    getChainId: vi.fn(async () => chain.id),
    getAddresses: vi.fn(async () => [owner]),
    sendTransaction: vi.fn(async (_request: unknown) => {
      events.push('send')
      return hash
    }),
  }
  const context = {
    publicClient: reader as unknown as PerpLifecycleReader,
    walletClient: wallet as unknown as PerpLifecycleWallet,
    chain,
  }
  return { reader, wallet, chain, context, events }
}

// Explicit byte concatenation follows the native deployment_record.rs preimages.
function digest(parts: readonly (Hex | Uint8Array)[]): Hex {
  return keccak256(
    Buffer.concat(
      parts.map((part) =>
        typeof part === 'string' ? Buffer.from(part.slice(2), 'hex') : part,
      ),
    ),
  )
}

describe('perpetual lifecycle commitments', () => {
  it('matches native packed identity and domain-separated evidence/registration bytes', () => {
    const marketId = digest([base, PERP_CANONICAL_USDC, new Uint8Array([1])])
    expect(perpMarketId(base, PERP_CANONICAL_USDC)).toBe(marketId)
    const evidenceHash = digest([
      Buffer.from('DiesisPerpDeploy.V1.DeploymentEvidence'),
      marketId,
      keccak256(payload.sourceList),
      keccak256(payload.metadata),
      keccak256(payload.signatures),
    ])
    expect(
      computeUnpricedPerpDeploymentEvidence({ marketId, ...payload }),
    ).toBe(evidenceHash)
    expect(registration).toEqual({
      marketId,
      baseAsset: base,
      quoteAsset: PERP_CANONICAL_USDC,
      evidenceHash,
    })
    expect(registrationDigest).toBe(
      digest([
        Buffer.from('DiesisIssuanceAuction.PerpRegistrationV1'),
        marketId,
        base,
        PERP_CANONICAL_USDC,
        evidenceHash,
      ]),
    )
    expect(computeUnpricedPerpRegistrationDigest(registration)).toBe(
      registrationDigest,
    )
  })

  it('rejects noncanonical custody, forged identity and malformed/oversized opaque evidence', () => {
    expect(() => perpMarketId(base, owner)).toThrow('canonical USDC')
    expect(() =>
      computeUnpricedPerpRegistrationDigest({
        ...registration,
        marketId: hash,
      }),
    ).toThrow('identity')
    expect(() =>
      computeUnpricedPerpDeploymentEvidence({
        marketId: registration.marketId,
        ...payload,
        sourceList: '0x1',
      }),
    ).toThrow('whole hex bytes')
    expect(() =>
      computeUnpricedPerpDeploymentEvidence({
        marketId: registration.marketId,
        ...payload,
        metadata: `0x${'00'.repeat(32 * 1024 + 1)}`,
      }),
    ).toThrow('32 KiB')
    expect(() =>
      computeUnpricedPerpDeploymentEvidence({
        marketId: registration.marketId,
        sourceList: `0x${'00'.repeat(32 * 1024)}`,
        metadata: `0x${'00'.repeat(32 * 1024)}`,
        signatures: '0x00',
      }),
    ).toThrow('64 KiB')
  })
})

describe('ordinary operator lifecycle transactions', () => {
  it('sends all six ABI selectors with exact values and generated nested V2 parameters', async () => {
    const { context, wallet, reader } = clients()
    const lifecycle = createPerpLifecycle(context)
    const calls = [
      {
        send: () => lifecycle.bidUnpricedPerpListing({ registration }),
        to: addresses.DIESIS_ISSUANCE_AUCTION,
        abi: IDiesisIssuanceAuctionAbi,
        name: 'bidUnpricedPerpListing',
        args: [
          { ...registration, quoteAsset: getAddress(PERP_CANONICAL_USDC) },
        ],
        value: 0n,
      },
      {
        send: () => lifecycle.postBond({ marketId: registration.marketId }),
        to: addresses.DIESIS_OPERATOR_BOND,
        abi: IDiesisOperatorBondAbi,
        name: 'postBond',
        args: [registration.marketId],
        value: PERP_OPERATOR_BOND_VALUE,
      },
      {
        send: () =>
          lifecycle.deployPerp({
            slotId,
            marketId: registration.marketId,
            ...payload,
          }),
        to: addresses.DIESIS_PERP_DEPLOY,
        abi: IDiesisPerpDeployAbi,
        name: 'deployPerp',
        args: [
          slotId,
          registration.marketId,
          payload.sourceList,
          payload.metadata,
          payload.signatures,
        ],
        value: 0n,
      },
      {
        send: () =>
          lifecycle.promoteToLive({ marketId: registration.marketId }),
        to: addresses.DIESIS_PERP_DEPLOY,
        abi: IDiesisPerpDeployAbi,
        name: 'promoteToLive',
        args: [registration.marketId],
        value: 0n,
      },
      {
        send: () => lifecycle.initializeBasicPerpMarket(initialV1),
        to: addresses.DIESIS_PERP_DEPLOY,
        abi: IDiesisPerpDeployAbi,
        name: 'initializeBasicPerpMarket',
        args: [base, getAddress(PERP_CANONICAL_USDC), 5n, 1n, 1_000n, 100n, 10],
        value: 0n,
      },
      {
        send: () => lifecycle.initializePolicyPerpMarket(initialV2),
        to: addresses.DIESIS_PERP_DEPLOY,
        abi: IDiesisPerpDeployAbi,
        name: 'initializePolicyPerpMarket',
        args: [
          base,
          getAddress(PERP_CANONICAL_USDC),
          5n,
          1n,
          1_000n,
          100n,
          initialV2.policy,
          initialV2.keyset,
        ],
        value: 0n,
      },
    ]
    for (const call of calls) {
      await expect(call.send()).resolves.toBe(hash)
      const request = wallet.sendTransaction.mock
        .lastCall![0] as PerpLifecycleAttempt
      expect(request).toMatchObject({
        to: call.to,
        value: call.value,
        gas: 112n,
        nonce: 7,
        account: context.walletClient.account,
        chain: context.chain,
      })
      expect(decodeFunctionData({ abi: call.abi, data: request.data })).toEqual(
        { functionName: call.name, args: call.args },
      )
      expect(reader.estimateGas.mock.lastCall![0]).toEqual({
        account: owner,
        to: call.to,
        data: request.data,
        value: call.value,
      })
      expect(reader.getTransactionCount.mock.lastCall![0]).toEqual({
        address: owner,
        blockTag: 'pending',
      })
    }
    expect(reader.estimateGas).toHaveBeenCalledTimes(6)
  })

  it('serializes concurrent dispatches before fetching the next pending nonce', async () => {
    const { context, reader, wallet } = clients()
    let release!: () => void
    const firstSent = new Promise<void>((resolve) => {
      release = resolve
    })
    reader.getTransactionCount.mockResolvedValueOnce(7).mockResolvedValueOnce(8)
    wallet.sendTransaction.mockImplementationOnce(async () => {
      await firstSent
      return hash
    })
    const lifecycle = createPerpLifecycle(context)
    const first = lifecycle.postBond({ marketId: registration.marketId })
    const second = lifecycle.postBond({ marketId: hash })
    await vi.waitFor(() => expect(wallet.sendTransaction).toHaveBeenCalled())
    expect(reader.getTransactionCount).toHaveBeenCalledOnce()
    expect(wallet.sendTransaction).toHaveBeenCalledOnce()
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([hash, hash])
    expect(
      wallet.sendTransaction.mock.calls.map(
        ([request]) => (request as PerpLifecycleAttempt).nonce,
      ),
    ).toEqual([7, 8])
  })

  it('keeps the dispatch queue usable after a rejected attempt', async () => {
    const { context, reader, wallet } = clients()
    reader.estimateGas.mockRejectedValueOnce(new Error('estimation failed'))
    const lifecycle = createPerpLifecycle(context)
    const first = lifecycle.postBond({ marketId: registration.marketId })
    const rejected = expect(first).rejects.toThrow('estimation failed')
    const second = lifecycle.postBond({ marketId: hash })
    await rejected
    await expect(second).resolves.toBe(hash)
    expect(wallet.sendTransaction).toHaveBeenCalledOnce()
    expect(reader.estimateGas).toHaveBeenCalledTimes(2)
  })

  it('awaits durable pending nonce persistence before dispatch and passes exactly that nonce', async () => {
    const { context, wallet, events } = clients()
    let release!: () => void
    const persisted = new Promise<void>((resolve) => {
      release = resolve
    })
    let attempt: PerpLifecycleAttempt | undefined
    const beforeDispatch = vi.fn(async (value: PerpLifecycleAttempt) => {
      attempt = value
      events.push('persist')
      await persisted
    })
    const submission = createPerpLifecycle({
      ...context,
      beforeDispatch,
    }).postBond({ marketId: registration.marketId })
    await vi.waitFor(() => expect(beforeDispatch).toHaveBeenCalledOnce())
    expect(wallet.sendTransaction).not.toHaveBeenCalled()
    expect(attempt).toMatchObject({
      owner,
      chainId: 1980,
      nonce: 7,
      gas: 112n,
      value: PERP_OPERATOR_BOND_VALUE,
    })
    release()
    await expect(submission).resolves.toBe(hash)
    expect(events).toEqual(['estimate', 'nonce', 'persist', 'send'])
  })

  it('prevents dispatch when persistence fails', async () => {
    const { context, wallet } = clients()
    await expect(
      createPerpLifecycle({
        ...context,
        beforeDispatch: async () => {
          throw new Error('storage unavailable')
        },
      }).postBond({ marketId: registration.marketId }),
    ).rejects.toThrow('storage unavailable')
    expect(wallet.sendTransaction).not.toHaveBeenCalled()
  })

  it.each([0n, -1n, undefined])(
    'prevents dispatch for invalid gas estimate %s',
    async (estimate) => {
      const { context, reader, wallet } = clients()
      reader.estimateGas.mockResolvedValue(estimate as bigint)
      await expect(
        createPerpLifecycle(context).postBond({
          marketId: registration.marketId,
        }),
      ).rejects.toThrow('positive gas estimate')
      expect(reader.getTransactionCount).not.toHaveBeenCalled()
      expect(wallet.sendTransaction).not.toHaveBeenCalled()
    },
  )

  it('does not dispatch after estimation failure and never retries ambiguous send failure', async () => {
    const first = clients()
    first.reader.estimateGas.mockRejectedValue(new Error('estimation failed'))
    await expect(
      createPerpLifecycle(first.context).postBond({
        marketId: registration.marketId,
      }),
    ).rejects.toThrow('estimation failed')
    expect(first.wallet.sendTransaction).not.toHaveBeenCalled()
    const second = clients()
    second.wallet.sendTransaction.mockRejectedValue(new Error('wallet timeout'))
    await expect(
      createPerpLifecycle(second.context).postBond({
        marketId: registration.marketId,
      }),
    ).rejects.toThrow('wallet timeout')
    expect(second.wallet.sendTransaction).toHaveBeenCalledOnce()
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unavailable pending nonce %s',
    async (nonce) => {
      const { context, reader, wallet } = clients()
      reader.getTransactionCount.mockResolvedValue(nonce)
      await expect(
        createPerpLifecycle(context).postBond({
          marketId: registration.marketId,
        }),
      ).rejects.toThrow('nonce unavailable')
      expect(wallet.sendTransaction).not.toHaveBeenCalled()
    },
  )

  it.each(['account', 'readChain', 'walletChain', 'connectedAccount'] as const)(
    'rechecks %s after persistence',
    async (change) => {
      const { context, reader, wallet } = clients()
      const beforeDispatch = async () => {
        if (change === 'account')
          wallet.account = { type: 'json-rpc', address: base }
        if (change === 'readChain') reader.getChainId.mockResolvedValue(1)
        if (change === 'walletChain') wallet.getChainId.mockResolvedValue(1)
        if (change === 'connectedAccount')
          wallet.getAddresses.mockResolvedValue([base])
      }
      await expect(
        createPerpLifecycle({ ...context, beforeDispatch }).postBond({
          marketId: registration.marketId,
        }),
      ).rejects.toThrow(/changed|mismatch/)
      expect(wallet.sendTransaction).not.toHaveBeenCalled()
    },
  )

  it('rechecks the connected operator after gas estimation', async () => {
    const { context, reader, wallet } = clients()
    reader.estimateGas.mockImplementation(async () => {
      wallet.getAddresses.mockResolvedValue([base])
      return 100n
    })
    await expect(
      createPerpLifecycle(context).postBond({
        marketId: registration.marketId,
      }),
    ).rejects.toThrow('operator account changed')
    expect(wallet.sendTransaction).not.toHaveBeenCalled()
  })

  it.each(['json-rpc', 'local'] as const)(
    'refuses %s account changes during the final provider check',
    async (accountType) => {
      const { context, reader, wallet } = clients()
      wallet.account = { type: accountType, address: owner }
      let release!: () => void
      const finalRead = new Promise<void>((resolve) => {
        release = resolve
      })
      reader.getChainId
        .mockResolvedValueOnce(1980)
        .mockImplementationOnce(async () => {
          await finalRead
          return 1980
        })
      const submitted = createPerpLifecycle(context).postBond({
        marketId: registration.marketId,
      })
      const refused = expect(submitted).rejects.toThrow('configuration changed')
      await vi.waitFor(() => expect(reader.getChainId).toHaveBeenCalledTimes(2))
      wallet.account = { type: accountType, address: base }
      release()
      await refused
      expect(wallet.sendTransaction).not.toHaveBeenCalled()
    },
  )

  it('refuses a chain change during the final connected-account check', async () => {
    const { context, wallet, chain } = clients()
    let release!: () => void
    const finalRead = new Promise<void>((resolve) => {
      release = resolve
    })
    wallet.getAddresses
      .mockResolvedValueOnce([owner])
      .mockImplementationOnce(async () => {
        await finalRead
        return [owner]
      })
    const submitted = createPerpLifecycle(context).postBond({
      marketId: registration.marketId,
    })
    const refused = expect(submitted).rejects.toThrow('configuration changed')
    await vi.waitFor(() => expect(wallet.getAddresses).toHaveBeenCalledTimes(2))
    chain.id = 1
    release()
    await refused
    expect(wallet.sendTransaction).not.toHaveBeenCalled()
  })

  it('dispatches a captured chain configuration instead of the mutable caller object', async () => {
    const { context, wallet, chain } = clients()
    const lifecycle = createPerpLifecycle(context)
    await lifecycle.postBond({ marketId: registration.marketId })
    const request = wallet.sendTransaction.mock.lastCall![0] as { chain: Chain }
    chain.name = 'Changed after dispatch'
    expect(request.chain).not.toBe(chain)
    expect(request.chain.name).toBe('Diesis')
    expect(Object.isFrozen(request.chain)).toBe(true)
  })

  it('supports ordinary local accounts without querying connected browser addresses', async () => {
    const { context, wallet } = clients()
    wallet.account = { type: 'local', address: owner }
    wallet.getAddresses.mockRejectedValue(
      new Error('browser wallet unavailable'),
    )
    await expect(
      createPerpLifecycle(context).postBond({
        marketId: registration.marketId,
      }),
    ).resolves.toBe(hash)
    expect(wallet.getAddresses).not.toHaveBeenCalled()
    expect(wallet.sendTransaction).toHaveBeenCalledOnce()
  })

  it('requires an ordinary configured wallet and the configured chain', () => {
    const { context } = clients()
    expect(() =>
      createPerpLifecycle({
        ...context,
        walletClient: { ...context.walletClient, account: undefined },
      }),
    ).toThrow('ordinary configured operator')
    expect(() =>
      createPerpLifecycle({
        ...context,
        walletClient: {
          ...context.walletClient,
          account: { address: owner, type: 'smart' } as never,
        },
      }),
    ).toThrow('ordinary configured operator')
    expect(() =>
      createPerpLifecycle({
        ...context,
        walletClient: { ...context.walletClient, chain: undefined },
      }),
    ).toThrow('wallet chain mismatch')
  })

  it('rejects invalid native u64 bounds, tick grids, and legacy leverage before estimation', async () => {
    const { context, reader } = clients()
    const lifecycle = createPerpLifecycle(context)
    for (const params of [
      { ...initialV1, tickSize: 0n },
      { ...initialV1, maxOpenInterest: 1n << 64n },
      { ...initialV1, initialMark: 101n },
      { ...initialV1, maxLeverage: 51 },
    ]) {
      await expect(
        lifecycle.initializeBasicPerpMarket(params),
      ).rejects.toThrow()
    }
    expect(reader.estimateGas).not.toHaveBeenCalled()
  })
})

describe('perpetual lifecycle reads', () => {
  it('checks the reader chain and preserves optional block numbers', async () => {
    const { context, reader } = clients()
    await getPerpListingSlot(context.publicClient, context.chain, 55n)
    expect(reader.readContract.mock.lastCall![0]).toMatchObject({
      address: addresses.DIESIS_ISSUANCE_AUCTION,
      functionName: 'getPerpListingSlot',
      blockNumber: 55n,
    })
    await currentPerpListingPrice(context.publicClient, context.chain)
    expect(reader.readContract.mock.lastCall![0]).not.toHaveProperty(
      'blockNumber',
    )
    await getPerpDeploymentState(
      context.publicClient,
      context.chain,
      registration.marketId,
      55n,
    )
    expect(reader.readContract.mock.lastCall![0]).toMatchObject({
      address: addresses.DIESIS_PERP_DEPLOY,
      functionName: 'getDeploymentState',
      args: [registration.marketId],
      blockNumber: 55n,
    })
    reader.getChainId.mockResolvedValue(1)
    await expect(
      getPerpListingSlot(context.publicClient, context.chain),
    ).rejects.toThrow('read provider chain mismatch')
    expect(reader.readContract).toHaveBeenCalledTimes(3)
  })
})
