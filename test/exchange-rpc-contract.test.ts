import { describe, expect, it } from 'vitest'
import { createPublicClient, custom, type Hex } from 'viem'
import { exchangePublicActions } from '../src/exchange/actions.js'

const marketId = `0x${'11'.repeat(32)}` as Hex
const user = `0x${'22'.repeat(20)}` as const
const token = `0x${'33'.repeat(20)}` as const
const blockHash = `0x${'42'.repeat(32)}` as Hex
const indexDigest = `0x${'99'.repeat(32)}` as Hex
const anchor = { blockNumber: 42, blockHash, indexDigest }
// Native crates/rpc/src/exchange.rs DTOs at 44bed910. U256 is a JSON hex
// quantity; Rust u64/u32 fields are JSON numbers, not automatically bigints.
const market = {
  market_id: marketId,
  base_token: user,
  quote_token: token,
  market_type: 1,
  state: 1,
  tick_size: 5,
  lot_size: 10,
}
const book = {
  market_id: marketId,
  bids: [{ price: 100, quantity: 20, order_count: 2 }],
  asks: [{ price: 101, quantity: 30, order_count: 3 }],
}
const account = {
  user,
  balances: [
    {
      token,
      available: '0xffffffffffffffff',
      locked: '0x1',
      total: '0x10000000000000000',
    },
  ],
  open_order_count: 2,
  open_position_count: 1,
}
function rpc(response: unknown) {
  const requests: Array<{ method: string; params?: unknown }> = []
  const client = createPublicClient({
    transport: custom({
      request: async (request) => {
        requests.push(request)
        // Exercise the JSON boundary rather than returning synthetic bigints.
        return JSON.parse(JSON.stringify(response))
      },
    }),
  }).extend(exchangePublicActions)
  return { exchange: client.exchange, requests }
}

describe('native exchange RPC contracts', () => {
  it('retains exact anchors and maps native book levels to SDK amounts', async () => {
    const { exchange, requests } = rpc({ ...anchor, data: book })
    expect(await exchange.getOrderBook({ marketId, depth: 20 })).toEqual({
      ...anchor,
      blockNumber: 42n,
      data: {
        marketId,
        bids: [{ price: 100n, amount: 20n, orders: 2 }],
        asks: [{ price: 101n, amount: 30n, orders: 3 }],
      },
    })
    expect(requests).toEqual([
      { method: 'exchange_getOrderBook', params: [{ marketId, depth: 20 }] },
    ])
  })
  it('maps market lists and allows a missing single market', async () => {
    const expected = {
      marketId,
      baseToken: user,
      quoteToken: token,
      marketType: 1,
      status: 1,
      tickSize: 5n,
      lotSize: 10n,
    }
    expect(
      (await rpc({ ...anchor, data: [market] }).exchange.getMarkets()).data,
    ).toEqual([expected])
    expect(await rpc(market).exchange.getMarket({ marketId })).toEqual(expected)
    expect(await rpc(null).exchange.getMarket({ marketId })).toBeNull()
  })
  it('decodes balances without losing uint256 precision', async () => {
    expect(
      (
        await rpc({ ...anchor, data: account }).exchange.getAccount({
          address: user,
        })
      ).data,
    ).toEqual({
      user,
      balances: [
        {
          token,
          available: 18446744073709551615n,
          locked: 1n,
          total: 18446744073709551616n,
        },
      ],
      open_order_count: 2,
      open_position_count: 1,
    })
  })
  it('returns native trade fields without inventing order or trader IDs', async () => {
    expect(
      (
        await rpc({
          ...anchor,
          data: [
            {
              market_id: marketId,
              price: 101,
              quantity: 3,
              side: 0,
              block_number: 41,
            },
          ],
        }).exchange.getTrades({ marketId })
      ).data,
    ).toEqual([
      { marketId, price: 101n, quantity: 3n, side: 0, blockNumber: 41n },
    ])
  })
  it('sends estimate amounts and optional price as JSON uint256 quantities', async () => {
    const { exchange, requests } = rpc({
      ...anchor,
      data: { avgPrice: '0x65', totalCost: '0x12f', fills: 1, slippageBps: 0 },
    })
    expect(
      await exchange.estimateFill({
        marketId,
        side: 0,
        amount: 3n,
        price: 102n,
      }),
    ).toEqual({
      ...anchor,
      blockNumber: 42n,
      data: { avgPrice: 101n, totalCost: 303n, fills: 1, slippageBps: 0 },
    })
    expect(requests).toEqual([
      {
        method: 'exchange_estimateFill',
        params: [{ marketId, side: 0, amount: '0x3', price: '0x66' }],
      },
    ])
    expect(() => JSON.stringify(requests)).not.toThrow()
  })
  it('decodes remaining scalar read results exactly', async () => {
    expect(
      await rpc([[marketId, 101]]).exchange.getMarkPrices({
        marketIds: [marketId],
      }),
    ).toEqual([[marketId, 101n]])
    expect(
      await rpc({
        market_id: marketId,
        current_rate_bps: -2,
        cumulative_index: '-170141183460469231731687303715884105728',
      }).exchange.getFundingRates({ marketId }),
    ).toEqual({
      market_id: marketId,
      current_rate_bps: -2n,
      cumulative_index: -(1n << 127n),
    })
    expect(
      await rpc({
        market_id: marketId,
        market_balance: '0x1',
        global_balance: '0x2',
      }).exchange.getInsuranceFund({ marketId }),
    ).toEqual({ market_id: marketId, market_balance: 1n, global_balance: 2n })
  })
  it('decodes exact string u64 boundaries while rejecting unsafe number fields', async () => {
    const exact = {
      ...anchor,
      blockNumber: '18446744073709551615',
      data: {
        ...book,
        bids: [
          {
            price: '18446744073709551615',
            quantity: '0x20000000000001',
            order_count: 4294967295,
          },
        ],
      },
    }
    const response = await rpc(exact).exchange.getOrderBook({ marketId })
    expect(response.blockNumber).toBe((1n << 64n) - 1n)
    expect(response.data.bids[0]).toEqual({
      price: (1n << 64n) - 1n,
      amount: 9007199254740993n,
      orders: 4294967295,
    })
    await expect(
      rpc({
        ...anchor,
        data: {
          ...book,
          bids: [
            { price: Number.MAX_SAFE_INTEGER + 1, quantity: 1, order_count: 1 },
          ],
        },
      }).exchange.getOrderBook({ marketId }),
    ).rejects.toThrow(/unsafe JSON/)
  })
  it('uses native deployment state fields and exact operator balances', async () => {
    expect(
      await rpc(null).exchange.getMarketDeploymentState({ marketId }),
    ).toBeNull()
    expect(
      await rpc({
        marketId,
        stateTag: 1,
        state: 'cooling',
        deadlineOrLiveBlock: 123,
        windowCloseBlock: 0,
        slashReason: 0,
        operator: user,
      }).exchange.getMarketDeploymentState({ marketId }),
    ).toEqual({
      marketId,
      stateTag: 1,
      state: 'cooling',
      deadlineOrLiveBlock: 123n,
      windowCloseBlock: 0n,
      slashReason: 0,
      operator: user,
    })
    expect(
      await rpc('0xffffffffffffffff').exchange.getOperatorBalance({
        operator: user,
      }),
    ).toBe(18446744073709551615n)
  })
  it('preserves native depth clamping and omits absent optional estimate prices', async () => {
    const { exchange, requests } = rpc({ ...anchor, data: book })
    await exchange.getOrderBook({ marketId, depth: 0 })
    await exchange.getOrderBook({ marketId, depth: 101 })
    expect(requests.map((request) => request.params)).toEqual([
      [{ marketId, depth: 1 }],
      [{ marketId, depth: 100 }],
    ])
    const estimate = rpc({
      ...anchor,
      data: { avgPrice: '0x0', totalCost: '0x0', fills: 0, slippageBps: 0 },
    })
    await estimate.exchange.estimateFill({ marketId, side: 1, amount: 0n })
    expect(estimate.requests[0]?.params).toEqual([
      { marketId, side: 1, amount: '0x0' },
    ])
  })
  it('validates the raw decimal-string position collateral capability', async () => {
    const capability = {
      capabilityVersion: 1,
      active: true,
      eligible: true,
      user,
      marketId,
      quoteToken: token,
      side: 0,
      size: '2',
      currentClaim: '9007199254740993',
      addableCollateral: '100',
      withdrawableCollateral: '10',
      unavailableReason: null,
    }
    expect(
      await rpc(capability).exchange.getPositionCollateral({ user, marketId }),
    ).toEqual(capability)
    for (const malformed of [
      { ...capability, capabilityVersion: 2 },
      { ...capability, active: 'true' },
      { ...capability, currentClaim: 9007199254740993 },
      { ...capability, side: 3 },
      { ...capability, size: '-1' },
    ]) {
      await expect(
        rpc(malformed).exchange.getPositionCollateral({ user, marketId }),
      ).rejects.toThrow()
    }
  })
  it('rejects malformed envelopes, unsafe JSON integers, and overflowing widths', async () => {
    for (const value of [
      book,
      { ...anchor, blockHash: '0x42', data: book },
      { ...anchor, indexDigest: null, data: book },
      { ...anchor, blockNumber: Number.MAX_SAFE_INTEGER + 1, data: book },
      { ...anchor, blockNumber: '18446744073709551616', data: book },
      {
        ...anchor,
        data: { ...book, bids: [{ price: -1, quantity: 1, order_count: 1 }] },
      },
    ]) {
      await expect(
        rpc(value).exchange.getOrderBook({ marketId }),
      ).rejects.toThrow()
    }
    await expect(
      rpc({
        ...anchor,
        data: {
          ...account,
          balances: [
            {
              token,
              available: `0x1${'0'.repeat(64)}`,
              locked: '0x0',
              total: '0x0',
            },
          ],
        },
      }).exchange.getAccount({ address: user }),
    ).rejects.toThrow()
  })
  it('rejects invalid parameters before issuing an RPC', async () => {
    const { exchange, requests } = rpc(null)
    for (const amount of [-1n, 1n << 64n])
      await expect(
        exchange.estimateFill({ marketId, side: 0, amount }),
      ).rejects.toThrow()
    await expect(
      exchange.estimateFill({ marketId, side: 2, amount: 1n }),
    ).rejects.toThrow()
    await expect(
      exchange.estimateFill({
        marketId,
        side: 1,
        amount: 1n,
        price: 1n << 64n,
      }),
    ).rejects.toThrow()
    await expect(
      exchange.getOrderBook({ marketId: '0x11', depth: 2 }),
    ).rejects.toThrow()
    await expect(exchange.getTrades({ marketId, limit: 1.5 })).rejects.toThrow()
    await expect(
      exchange.getMarkPrices({ marketIds: Array(257).fill(marketId) }),
    ).rejects.toThrow()
    expect(requests).toEqual([])
  })
  it('does not expose unregistered metadata or obsolete deployment RPC helpers', () => {
    const { exchange } = rpc(null)
    expect('deployPerp' in exchange).toBe(false)
    expect('proposeMetadataUpdate' in exchange).toBe(false)
  })
})

const feeEpoch = {
  marketId,
  epoch: 11,
  policyRevision: 2,
  backstopTopupBps: 500,
  burn: user,
  treasury: token,
  validators: user,
  residualSplitBps: [1000, 2000, 7000],
  snapshotHash: blockHash,
  accruedTotal: '0x20000000000001',
  distributionId: indexDigest,
  finalized: true,
}
const feeCursor = {
  marketId,
  fromEpoch: 11,
  toEpoch: 22,
  nextEpoch: 17,
  anchorBlockNumber: 42,
  anchorBlockHash: blockHash,
}
const perpCursor = {
  marketId,
  kind: 'funding',
  fromBlock: 1,
  toBlock: 50,
  nextBlockNumber: 43,
  nextLogIndex: 0,
  anchorBlockNumber: 42,
  anchorBlockHash: blockHash,
  generation: 3,
}
// record_decode.rs FundingApplied registry tag 4 and logs_v2.rs frozen ABI.
const historyRow = {
  kind: 'funding',
  eventTag: 4,
  blockNumber: 41,
  blockHash,
  transactionHash: indexDigest,
  transactionIndex: 0,
  logIndex: 3,
  emitter: '0xd1e5150000000000000000000000000000009e29',
  topics: [
    '0x77be8f3805853edbd2a786b03af898ccb6ae641d5b7d9df0f30e26d596741bba',
    marketId,
  ],
  data: [...Array(63).fill(0), 255],
}

describe('registered canonical exchange reads', () => {
  it('reads optional fee epochs with exact quantities and positional native params', async () => {
    const { exchange, requests } = rpc({ ...anchor, data: feeEpoch })
    const response = await exchange.getFeeEpoch({ marketId, epoch: 11n })
    expect(response).toEqual({
      ...anchor,
      blockNumber: 42n,
      data: {
        ...feeEpoch,
        epoch: 11n,
        policyRevision: 2n,
        accruedTotal: 9007199254740993n,
      },
    })
    expect(requests).toEqual([
      { method: 'exchange_getFeeEpoch', params: [marketId, 11] },
    ])
    expect(
      (
        await rpc({ ...anchor, data: null }).exchange.getFeeEpoch({
          marketId,
          epoch: 11n,
        })
      ).data,
    ).toBeNull()
  })
  it('returns bounded fee history with resumable exact cursors', async () => {
    const { exchange, requests } = rpc({
      ...anchor,
      data: { rows: [feeEpoch], next: feeCursor },
    })
    const first = await exchange.getFeeEpochHistory({
      marketId,
      fromEpoch: 11n,
      toEpoch: 22n,
      limit: 9,
      scanBudget: 19,
    })
    expect(first.data.next).toEqual({
      ...feeCursor,
      fromEpoch: 11n,
      toEpoch: 22n,
      nextEpoch: 17n,
      anchorBlockNumber: 42n,
    })
    const resumed = rpc({ ...anchor, data: { rows: [], next: null } })
    await resumed.exchange.getFeeEpochHistory({
      marketId,
      fromEpoch: 11n,
      toEpoch: 22n,
      cursor: first.data.next,
    })
    expect(resumed.requests[0]?.params).toEqual([
      { marketId, fromEpoch: 11, toEpoch: 22, cursor: feeCursor },
    ])
  })
  it('returns durable perpetual receipt evidence and cursor generation', async () => {
    const { exchange, requests } = rpc({
      ...anchor,
      data: { rows: [historyRow], next: perpCursor },
    })
    const result = await exchange.getPerpHistory({
      marketId,
      kind: 'funding',
      fromBlock: 1n,
      toBlock: 50n,
    })
    expect(result.data.rows).toEqual([
      { ...historyRow, blockNumber: 41n, logIndex: 3n },
    ])
    expect(result.data.next).toEqual({
      ...perpCursor,
      fromBlock: 1n,
      toBlock: 50n,
      nextBlockNumber: 43n,
      nextLogIndex: 0n,
      anchorBlockNumber: 42n,
      generation: 3n,
    })
    const resumed = rpc({ ...anchor, data: { rows: [], next: null } })
    await resumed.exchange.getPerpHistory({
      marketId,
      kind: 'funding',
      fromBlock: 1n,
      toBlock: 50n,
      cursor: result.data.next,
    })
    expect(resumed.requests[0]?.params).toEqual([
      {
        marketId,
        kind: 'funding',
        fromBlock: 1,
        toBlock: 50,
        cursor: perpCursor,
      },
    ])
  })
  it('decodes fee balances and projected or absent fee distributions', async () => {
    const balances = {
      marketId,
      quoteToken: token,
      protocolFee: '0x1',
      marketInsurance: '0x2',
      globalInsuranceReserve: '0x3',
      backstopCollateral: '0x4',
    }
    expect(
      (
        await rpc({ ...anchor, data: balances }).exchange.getPerpFeeBalances({
          marketId,
        })
      ).data,
    ).toEqual({
      marketId,
      quoteToken: token,
      protocolFee: 1n,
      marketInsurance: 2n,
      globalInsuranceReserve: 3n,
      backstopCollateral: 4n,
    })
    const allocation = {
      quoteToken: token,
      policyRevision: 2,
      backstopTopupBps: 500,
      residualSplitBps: [1000, 2000, 7000],
      snapshotHash: blockHash,
      accruedTotal: '0x64',
      distributionId: null,
      marketInsuranceTopup: '0x5',
      burn: { recipient: user, amount: '0xa' },
      treasury: { recipient: token, amount: '0x14' },
      validators: { recipient: user, amount: '0x41' },
    }
    const projected = await rpc({
      ...anchor,
      data: { marketId, epoch: 11, state: 'projected', allocation },
    }).exchange.getPerpFeeDistribution({ marketId, epoch: 11n })
    expect(projected.data.allocation?.validators.amount).toBe(65n)
    expect(projected.data.allocation?.distributionId).toBeNull()
    expect(
      (
        await rpc({
          ...anchor,
          data: { marketId, epoch: 11, state: 'absent', allocation: null },
        }).exchange.getPerpFeeDistribution({ marketId, epoch: 11n })
      ).data.allocation,
    ).toBeNull()
  })
  it('reads oracle status, protection continuation, and nullable canonical positions', async () => {
    const oracle = {
      marketId,
      accepted: true,
      round: 2,
      observedAt: 100,
      indexPrice: 200,
      markPrice: 201,
      sourceSetHash: blockHash,
      evidenceHash: indexDigest,
      status: 1,
      divergenceCount: 3,
      recoveryCount: 4,
    }
    expect(await rpc(oracle).exchange.getOracleStatus({ marketId })).toEqual({
      ...oracle,
      round: 2n,
      observedAt: 100n,
      indexPrice: 200n,
      markPrice: 201n,
      divergenceCount: 3n,
      recoveryCount: 4n,
    })
    expect(
      await rpc({
        marketId,
        continuationKind: 1,
        side: 0,
        boundary: '0x1',
        target: '0x2',
        backstopCollateral: '0x3',
      }).exchange.getPerpProtection({ marketId }),
    ).toEqual({
      marketId,
      continuationKind: 1,
      side: 0,
      boundary: 1n,
      target: 2n,
      backstopCollateral: 3n,
    })
    const position = rpc({
      user,
      marketId,
      side: 1,
      size: '0x2',
      storedClaim: '0x3',
      currentClaim: '0x4',
      priceIndex: '0x5',
      fundingIndex: '0x6',
    })
    expect(await position.exchange.getPerpPosition({ user, marketId })).toEqual(
      {
        user,
        marketId,
        side: 1,
        size: 2n,
        storedClaim: 3n,
        currentClaim: 4n,
        priceIndex: 5n,
        fundingIndex: 6n,
      },
    )
    expect(position.requests[0]?.params).toEqual([user, marketId])
    expect(
      await rpc(null).exchange.getPerpPosition({ user, marketId }),
    ).toBeNull()
  })
  it('reads opening auctions and read-only seed templates using native JSON numbers', async () => {
    const auction = {
      marketId,
      startBlock: 4,
      endBlock: 8,
      referencePrice: '0x64',
      finalized: false,
      clearingPrice: '0x0',
      totalVolume: '0x0',
    }
    expect(await rpc(auction).exchange.getOpeningAuction({ marketId })).toEqual(
      {
        ...auction,
        startBlock: 4n,
        endBlock: 8n,
        referencePrice: 100n,
        clearingPrice: 0n,
        totalVolume: 0n,
      },
    )
    const plan = rpc({
      marketId,
      referencePrice: 100,
      orders: [
        { marketId, side: 0, price: 98, quantity: 3 },
        { marketId, side: 1, price: 102, quantity: 3 },
      ],
    })
    expect(
      await plan.exchange.generateSeedLiquidityPlan({
        marketId,
        referencePrice: 100n,
        levels: 1,
        baseQuantity: 3n,
        tickSpacing: 2n,
      }),
    ).toEqual({
      marketId,
      referencePrice: 100n,
      orders: [
        { marketId, side: 0, price: 98n, quantity: 3n },
        { marketId, side: 1, price: 102n, quantity: 3n },
      ],
    })
    expect(plan.requests).toEqual([
      {
        method: 'exchange_generateSeedLiquidityPlan',
        params: [
          {
            marketId,
            referencePrice: 100,
            levels: 1,
            baseQuantity: 3,
            tickSpacing: 2,
          },
        ],
      },
    ])
  })
  it('rejects invalid bounded scans, replayed cursors, and inexact u64 JSON requests before RPC', async () => {
    const { exchange, requests } = rpc(null)
    await expect(
      exchange.getFeeEpoch({ marketId, epoch: 0n }),
    ).rejects.toThrow()
    await expect(
      exchange.getFeeEpoch({ marketId, epoch: 9007199254740993n }),
    ).rejects.toThrow(/exact|safe/i)
    for (const extra of [
      { limit: 0 },
      { limit: 257 },
      { scanBudget: 4097 },
      { fromEpoch: 0n },
      { fromEpoch: 23n },
    ])
      await expect(
        exchange.getFeeEpochHistory({
          marketId,
          fromEpoch: 11n,
          toEpoch: 22n,
          ...extra,
        }),
      ).rejects.toThrow()
    await expect(
      exchange.getPerpHistory({
        marketId,
        kind: 'other' as never,
        fromBlock: 1n,
        toBlock: 50n,
      }),
    ).rejects.toThrow()
    await expect(
      exchange.getPerpHistory({
        marketId,
        kind: 'funding',
        fromBlock: 51n,
        toBlock: 50n,
      }),
    ).rejects.toThrow()
    await expect(
      exchange.getFeeEpochHistory({
        marketId,
        fromEpoch: 11n,
        toEpoch: 22n,
        cursor: {
          ...feeCursor,
          fromEpoch: 10n,
          toEpoch: 22n,
          nextEpoch: 17n,
          anchorBlockNumber: 42n,
        },
      }),
    ).rejects.toThrow()
    await expect(
      exchange.generateSeedLiquidityPlan({
        marketId,
        referencePrice: 1n,
        levels: 2,
        baseQuantity: 1n,
        tickSpacing: 1n,
      }),
    ).rejects.toThrow()
    await expect(
      exchange.generateSeedLiquidityPlan({
        marketId,
        referencePrice: 10n,
        levels: 101,
        baseQuantity: 1n,
        tickSpacing: 1n,
      }),
    ).rejects.toThrow()
    expect(requests).toEqual([])
  })
  it('rejects empty history pages whose continuation makes no progress', async () => {
    const feeStart = { ...feeCursor, nextEpoch: 11 }
    await expect(
      rpc({
        ...anchor,
        data: { rows: [], next: feeStart },
      }).exchange.getFeeEpochHistory({
        marketId,
        fromEpoch: 11n,
        toEpoch: 22n,
      }),
    ).rejects.toThrow(/advance/)
    const perpStart = { ...perpCursor, nextBlockNumber: 1 }
    await expect(
      rpc({
        ...anchor,
        data: { rows: [], next: perpStart },
      }).exchange.getPerpHistory({
        marketId,
        kind: 'funding',
        fromBlock: 1n,
        toBlock: 50n,
      }),
    ).rejects.toThrow(/advance/)
    const cursor = {
      ...perpCursor,
      fromBlock: 1n,
      toBlock: 50n,
      nextBlockNumber: 43n,
      nextLogIndex: 0n,
      anchorBlockNumber: 42n,
      generation: 3n,
    }
    await expect(
      rpc({
        ...anchor,
        data: { rows: [], next: perpCursor },
      }).exchange.getPerpHistory({
        marketId,
        kind: 'funding',
        fromBlock: 1n,
        toBlock: 50n,
        cursor: cursor as never,
      }),
    ).rejects.toThrow(/advance/)
  })
  it('bounds returned history rows by the native scan budget as well as page limit', async () => {
    await expect(
      rpc({
        ...anchor,
        data: { rows: [feeEpoch, { ...feeEpoch, epoch: 12 }], next: null },
      }).exchange.getFeeEpochHistory({
        marketId,
        fromEpoch: 11n,
        toEpoch: 22n,
        scanBudget: 1,
      }),
    ).rejects.toThrow()
    await expect(
      rpc({
        ...anchor,
        data: {
          rows: [historyRow, { ...historyRow, logIndex: 4 }],
          next: null,
        },
      }).exchange.getPerpHistory({
        marketId,
        kind: 'funding',
        fromBlock: 1n,
        toBlock: 50n,
        scanBudget: 1,
      }),
    ).rejects.toThrow()
  })
  it('rejects malformed nested fields, excessive pages, and cursor anchor mismatches', async () => {
    await expect(
      rpc({
        ...anchor,
        data: { ...feeEpoch, residualSplitBps: [1, 2] },
      }).exchange.getFeeEpoch({ marketId, epoch: 11n }),
    ).rejects.toThrow()
    await expect(
      rpc({
        ...anchor,
        data: { rows: Array(257).fill(feeEpoch), next: null },
      }).exchange.getFeeEpochHistory({
        marketId,
        fromEpoch: 11n,
        toEpoch: 300n,
      }),
    ).rejects.toThrow()
    await expect(
      rpc({
        ...anchor,
        data: {
          rows: [feeEpoch],
          next: { ...feeCursor, anchorBlockHash: indexDigest },
        },
      }).exchange.getFeeEpochHistory({
        marketId,
        fromEpoch: 11n,
        toEpoch: 22n,
      }),
    ).rejects.toThrow()
    await expect(
      rpc({
        ...anchor,
        data: { rows: [{ ...historyRow, data: [256] }], next: null },
      }).exchange.getPerpHistory({
        marketId,
        kind: 'funding',
        fromBlock: 1n,
        toBlock: 50n,
      }),
    ).rejects.toThrow()
    await expect(
      rpc({
        ...anchor,
        data: { marketId, epoch: 11, state: 'absent', allocation: {} },
      }).exchange.getPerpFeeDistribution({ marketId, epoch: 11n }),
    ).rejects.toThrow()
    await expect(
      rpc({ marketId, accepted: true }).exchange.getOracleStatus({ marketId }),
    ).rejects.toThrow()
  })
})
