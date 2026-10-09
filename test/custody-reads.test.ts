import { describe, expect, it } from 'vitest'
import { createPublicClient, custom } from 'viem'
import { exchangePublicActions } from '../src/exchange/actions.js'

// Literal serde wire data: U256 is a hex quantity, generation is decimal u64.
const user = '0x1111111111111111111111111111111111111111' as const
const token = '0x2222222222222222222222222222222222222222' as const
const absentToken = '0x3333333333333333333333333333333333333333' as const
const zeroAddress = '0x0000000000000000000000000000000000000000' as const
const market1 = `0x${'01'.repeat(32)}` as const
const market2 = `0x${'02'.repeat(32)}` as const
const market3 = `0x${'03'.repeat(32)}` as const
const zeroHash = `0x${'00'.repeat(32)}` as const
const blockHash = `0x${'a1'.repeat(32)}` as const
const indexDigest = `0x${'b2'.repeat(32)}` as const
const genesisHash = `0x${'c3'.repeat(32)}` as const
const maxU64 = '18446744073709551615'
const maxU256 = `0x${'f'.repeat(64)}`
function custody() {
  return {
    readVersion: 1,
    indexGeneration: maxU64,
    value: {
      user,
      assets: [
        {
          token,
          totalBalance: '0x64',
          lockedBalance: '0x1e',
          spendableBalance: '0x46',
          reservedUserMargin: '0xa',
          evaluatedPositionClaims: '0x5',
          accountValueRaw: '0x73',
        },
      ],
      margins: [
        {
          marketId: market1,
          token,
          reservedUserMargin: '0x6',
          evaluatedPositionClaim: '0x2',
        },
        {
          marketId: market2,
          token,
          reservedUserMargin: '0x4',
          evaluatedPositionClaim: '0x3',
        },
        {
          marketId: market3,
          token: absentToken,
          reservedUserMargin: '0x0',
          evaluatedPositionClaim: '0x0',
        },
      ],
      coverage: {
        complete: true,
        genesisCustodyProvenEmpty: true,
        genesisPrestateHash: genesisHash,
        gaps: [] as { fromBlock: number | string; toBlock: number | string }[],
        gapRangesTruncated: false,
        inventoryTruncated: false,
      },
    },
  }
}
function envelope(data: unknown, blockNumber: number | string = 42) {
  return { blockNumber, blockHash, indexDigest, data }
}
function setup(wire: unknown, failure?: Error) {
  const requests: unknown[] = []
  const client = createPublicClient({
    transport: custom(
      {
        request: async (request) => {
          requests.push(request)
          if (failure) throw failure
          return wire
        },
      },
      { retryCount: 0 },
    ),
  }).extend(exchangePublicActions)
  return { exchange: client.exchange, requests }
}
async function rejects(
  edit: (data: ReturnType<typeof custody>) => void,
  anchor: number | string = 42,
) {
  const data = custody()
  edit(data)
  await expect(
    setup(envelope(data, anchor)).exchange.getAccountCustody({
      address: user,
    }),
  ).rejects.toThrow()
}
describe('native anchored custody read', () => {
  it('exposes an additive account custody helper', () => {
    expect(typeof setup(null).exchange.getAccountCustody).toBe('function')
  })
  it('preserves anchor, quantities, duplicate aggregate meaning and zero registered margins', async () => {
    const { exchange, requests } = setup(envelope(custody()))
    const response = await exchange.getAccountCustody({ address: user })
    expect(response).toEqual({
      blockNumber: 42n,
      blockHash,
      indexDigest,
      data: {
        readVersion: 1,
        indexGeneration: BigInt(maxU64),
        value: {
          user,
          assets: [
            {
              token,
              totalBalance: 100n,
              lockedBalance: 30n,
              spendableBalance: 70n,
              reservedUserMargin: 10n,
              evaluatedPositionClaims: 5n,
              accountValueRaw: 115n,
            },
          ],
          margins: [
            {
              marketId: market1,
              token,
              reservedUserMargin: 6n,
              evaluatedPositionClaim: 2n,
            },
            {
              marketId: market2,
              token,
              reservedUserMargin: 4n,
              evaluatedPositionClaim: 3n,
            },
            {
              marketId: market3,
              token: absentToken,
              reservedUserMargin: 0n,
              evaluatedPositionClaim: 0n,
            },
          ],
          coverage: {
            complete: true,
            genesisCustodyProvenEmpty: true,
            genesisPrestateHash: genesisHash,
            gaps: [],
            gapRangesTruncated: false,
            inventoryTruncated: false,
          },
        },
      },
    })
    expect(requests).toEqual([
      { method: 'exchange_getAccountCustody', params: [user] },
    ])
    // Account value already includes these market totals; locks are a subset.
    expect(response.data.value.assets[0].accountValueRaw).toBe(115n)
  })
  it('keeps full U256 and exact decimal generation/outer anchor widths', async () => {
    const data = custody()
    data.value.assets[0] = {
      token,
      totalBalance: maxU256,
      lockedBalance: '0x0',
      spendableBalance: maxU256,
      reservedUserMargin: '0x0',
      evaluatedPositionClaims: '0x0',
      accountValueRaw: maxU256,
    }
    data.value.margins = []
    const result = await setup(
      envelope(data, maxU64),
    ).exchange.getAccountCustody({ address: user })
    expect(result.blockNumber).toBe((1n << 64n) - 1n)
    expect(result.data.value.assets[0].totalBalance).toBe((1n << 256n) - 1n)
  })
  it('preserves a successful empty inventory with all zero registered margins', async () => {
    const data = custody()
    data.value.assets = []
    data.value.margins = [data.value.margins[2]]
    expect(
      (
        await setup(envelope(data)).exchange.getAccountCustody({
          address: user,
        })
      ).data.value.assets,
    ).toEqual([])
  })
  it.each([zeroAddress, '0x1', user.slice(2), 1, null])(
    'rejects invalid query %s before RPC',
    async (address) => {
      const { exchange, requests } = setup(null)
      await expect(
        exchange.getAccountCustody({ address } as never),
      ).rejects.toThrow()
      expect(requests).toEqual([])
    },
  )
  it('rejects extra query controls before RPC', async () => {
    const { exchange, requests } = setup(null)
    await expect(
      exchange.getAccountCustody({ address: user, complete: true } as never),
    ).rejects.toThrow()
    expect(requests).toEqual([])
  })
  it.each([0, 2, '1', null])('rejects read version %s', async (value) => {
    await rejects((data) => {
      data.readVersion = value as never
    })
  })
  it.each([0, '-1', '01', '18446744073709551616', '0x1', null])(
    'rejects generation %s',
    async (value) => {
      await rejects((data) => {
        data.indexGeneration = value as never
      })
    },
  )
  it('rejects a response for another account', async () => {
    await rejects((data) => {
      data.value.user = token as never
    })
  })
  it.each([
    'totalBalance',
    'lockedBalance',
    'spendableBalance',
    'reservedUserMargin',
    'evaluatedPositionClaims',
    'accountValueRaw',
  ] as const)('requires a lossless hex U256 for asset %s', async (field) => {
    await rejects((data) => {
      data.value.assets[0][field] = 100 as never
    })
  })
  it.each([
    '0x',
    '0x00',
    '0x01',
    '-0x1',
    '0xg',
    `0x1${'0'.repeat(64)}`,
    '100',
    null,
  ])('rejects malformed amount %s', async (value) => {
    await rejects((data) => {
      data.value.assets[0].totalBalance = value as never
    })
  })
  it('rejects a lock exceeding total and incorrect spendable or account value', async () => {
    await rejects((data) => {
      data.value.assets[0].lockedBalance = '0x65'
    })
    await rejects((data) => {
      data.value.assets[0].spendableBalance = '0x45'
    })
    await rejects((data) => {
      data.value.assets[0].accountValueRaw = '0x91'
    })
  })
  it('rejects duplicated aggregate reserve/claim amounts that differ from market rows', async () => {
    await rejects((data) => {
      data.value.assets[0].reservedUserMargin = '0xb'
      data.value.assets[0].accountValueRaw = '0x74'
    })
    await rejects((data) => {
      data.value.assets[0].evaluatedPositionClaims = '0x6'
      data.value.assets[0].accountValueRaw = '0x74'
    })
  })
  it('rejects positive market amounts without the corresponding asset aggregate', async () => {
    await rejects((data) => {
      data.value.margins[2].reservedUserMargin = '0x1'
    })
  })
  it('rejects asset/market sum overflow rather than truncating to 256 bits', async () => {
    await rejects((data) => {
      data.value.assets[0].totalBalance = maxU256
      data.value.assets[0].spendableBalance = maxU256
      data.value.assets[0].lockedBalance = '0x0'
    })
    await rejects((data) => {
      data.value.margins[0].reservedUserMargin = maxU256
    })
  })
  it('rejects all-zero asset rows omitted by the native runtime', async () => {
    await rejects((data) => {
      data.value.assets.push({
        token: absentToken,
        totalBalance: '0x0',
        lockedBalance: '0x0',
        spendableBalance: '0x0',
        reservedUserMargin: '0x0',
        evaluatedPositionClaims: '0x0',
        accountValueRaw: '0x0',
      })
    })
  })
  it('rejects zero or case-insensitive duplicate token/market identities', async () => {
    await rejects((data) => {
      data.value.assets[0].token = zeroAddress as never
    })
    await rejects((data) => {
      data.value.assets.push({
        ...data.value.assets[0],
        token: token.toUpperCase().replace('0X', '0x') as never,
      })
    })
    await rejects((data) => {
      data.value.margins[0].marketId = zeroHash as never
    })
    await rejects((data) => {
      data.value.margins.push({ ...data.value.margins[0] })
    })
  })
  it('rejects more than 256 assets or margins before mapping them', async () => {
    await rejects((data) => {
      data.value.assets = Array.from(
        { length: 257 },
        () => data.value.assets[0],
      )
    })
    await rejects((data) => {
      data.value.margins = Array.from(
        { length: 257 },
        () => data.value.margins[0],
      )
    })
  })
  it.each([true, false])(
    'derives completeness with inventory truncation %s',
    async (inventoryTruncated) => {
      const data = custody()
      data.value.coverage.inventoryTruncated = inventoryTruncated
      data.value.coverage.complete = !inventoryTruncated
      const read = await setup(envelope(data)).exchange.getAccountCustody({
        address: user,
      })
      expect(read.data.value.coverage.complete).toBe(!inventoryTruncated)
    },
  )
  it('accepts unknown and known nonempty genesis as incomplete, preserving evidence hash', async () => {
    for (const genesisPrestateHash of [null, genesisHash]) {
      const data = custody()
      data.value.coverage.complete = false
      data.value.coverage.genesisCustodyProvenEmpty = false
      data.value.coverage.genesisPrestateHash = genesisPrestateHash as never
      expect(
        (
          await setup(envelope(data)).exchange.getAccountCustody({
            address: user,
          })
        ).data.value.coverage.genesisPrestateHash,
      ).toBe(genesisPrestateHash)
    }
  })
  it('never accepts empty-genesis proof without a nonzero commitment', async () => {
    await rejects((data) => {
      data.value.coverage.genesisPrestateHash = null as never
    })
    await rejects((data) => {
      data.value.coverage.genesisPrestateHash = zeroHash as never
    })
  })
  it('rejects false or fabricated completeness inconsistent with producer evidence', async () => {
    await rejects((data) => {
      data.value.coverage.complete = false
    })
    await rejects((data) => {
      data.value.coverage.genesisCustodyProvenEmpty = false
    })
    await rejects((data) => {
      data.value.coverage.inventoryTruncated = true
    })
    await rejects((data) => {
      data.value.coverage.gaps = [{ fromBlock: 10, toBlock: 12 }]
    })
  })
  it('preserves inclusive gaps as bigint and checks every gap against the outer anchor', async () => {
    const data = custody()
    data.value.coverage.complete = false
    data.value.coverage.gaps = [
      { fromBlock: 1, toBlock: 2 },
      { fromBlock: '40', toBlock: '42' },
    ]
    expect(
      (
        await setup(envelope(data)).exchange.getAccountCustody({
          address: user,
        })
      ).data.value.coverage.gaps,
    ).toEqual([
      { fromBlock: 1n, toBlock: 2n },
      { fromBlock: 40n, toBlock: 42n },
    ])
    await rejects((wire) => {
      wire.value.coverage.complete = false
      wire.value.coverage.gaps = [{ fromBlock: 40, toBlock: 43 }]
    })
  })
  it.each([
    [{ fromBlock: 4, toBlock: 3 }],
    [{ fromBlock: 0, toBlock: 0 }],
    [
      { fromBlock: 2, toBlock: 5 },
      { fromBlock: 4, toBlock: 7 },
    ],
    [
      { fromBlock: 4, toBlock: 7 },
      { fromBlock: 1, toBlock: 2 },
    ],
    [{ fromBlock: Number.MAX_SAFE_INTEGER + 1, toBlock: maxU64 }],
    [{ fromBlock: '18446744073709551616', toBlock: maxU64 }],
  ])('rejects malformed, noncanonical or unsafe gaps %j', async (gaps) => {
    await rejects((data) => {
      data.value.coverage.complete = false
      data.value.coverage.gaps = gaps
    }, maxU64)
  })
  it('retains full-width lossless gap strings at a full-width outer anchor', async () => {
    const data = custody()
    data.value.coverage.complete = false
    data.value.coverage.gaps = [{ fromBlock: maxU64, toBlock: maxU64 }]
    expect(
      (
        await setup(envelope(data, maxU64)).exchange.getAccountCustody({
          address: user,
        })
      ).data.value.coverage.gaps[0].toBlock,
    ).toBe((1n << 64n) - 1n)
  })
  it('requires exactly 128 listed gaps when the native gap list is truncated', async () => {
    const data = custody()
    data.value.coverage.complete = false
    data.value.coverage.gapRangesTruncated = true
    data.value.coverage.gaps = Array.from({ length: 128 }, (_, i) => ({
      fromBlock: i * 2 + 1,
      toBlock: i * 2 + 1,
    }))
    expect(
      (
        await setup(envelope(data, 300)).exchange.getAccountCustody({
          address: user,
        })
      ).data.value.coverage.gaps,
    ).toHaveLength(128)
    await rejects((wire) => {
      wire.value.coverage.complete = false
      wire.value.coverage.gapRangesTruncated = true
    })
  })
  it('propagates producer failure and never substitutes an empty or legacy account', async () => {
    const { exchange, requests } = setup(
      null,
      new Error('custody producer unavailable'),
    )
    await expect(exchange.getAccountCustody({ address: user })).rejects.toThrow(
      'custody producer unavailable',
    )
    expect(requests).toHaveLength(1)
  })
  it.each([{}, null, { blockNumber: 42, blockHash, data: custody() }])(
    'preserves indexed-envelope rejection %j',
    async (wire) => {
      await expect(
        setup(wire).exchange.getAccountCustody({ address: user }),
      ).rejects.toThrow()
    },
  )
  it('keeps a full U256 current claim and its aggregate without truncation', async () => {
    const data = custody()
    data.value.assets[0] = {
      token,
      totalBalance: '0x0',
      lockedBalance: '0x0',
      spendableBalance: '0x0',
      reservedUserMargin: '0x0',
      evaluatedPositionClaims: maxU256,
      accountValueRaw: maxU256,
    }
    data.value.margins = [
      {
        marketId: market1,
        token,
        reservedUserMargin: '0x0',
        evaluatedPositionClaim: maxU256,
      },
    ]
    const value = (
      await setup(envelope(data)).exchange.getAccountCustody({
        address: user,
      })
    ).data.value
    expect(value.margins[0].evaluatedPositionClaim).toBe((1n << 256n) - 1n)
    expect(value.assets[0].accountValueRaw).toBe((1n << 256n) - 1n)
  })
  it('accepts exactly 256 distinct assets and every zero registered margin', async () => {
    const data = custody()
    data.value.assets = Array.from({ length: 256 }, (_, index) => ({
      token: `0x${(index + 1).toString(16).padStart(40, '0')}` as never,
      totalBalance: '0x1',
      lockedBalance: '0x0',
      spendableBalance: '0x1',
      reservedUserMargin: '0x0',
      evaluatedPositionClaims: '0x0',
      accountValueRaw: '0x1',
    }))
    data.value.margins = Array.from({ length: 256 }, (_, index) => ({
      marketId: `0x${(index + 1).toString(16).padStart(64, '0')}` as never,
      token,
      reservedUserMargin: '0x0',
      evaluatedPositionClaim: '0x0',
    }))
    const value = (
      await setup(envelope(data)).exchange.getAccountCustody({
        address: user,
      })
    ).data.value
    expect(value.assets).toHaveLength(256)
    expect(value.margins).toHaveLength(256)
  })
  it('rejects duplicate token identity when letter case differs', async () => {
    await rejects((data) => {
      const lower = `0x${'ab'.repeat(20)}`
      data.value.assets[0].token = lower as never
      data.value.margins[0].token = lower as never
      data.value.margins[1].token = lower as never
      data.value.assets.push({
        ...data.value.assets[0],
        token: `0x${'AB'.repeat(20)}` as never,
      })
    })
  })
  it('rejects malformed coverage booleans and bounded collections', async () => {
    for (const field of [
      'complete',
      'genesisCustodyProvenEmpty',
      'gapRangesTruncated',
      'inventoryTruncated',
    ] as const)
      await rejects((data) => {
        data.value.coverage[field] = 'false' as never
      })
    await rejects((data) => {
      data.value.assets = null as never
    })
    await rejects((data) => {
      data.value.margins = {} as never
    })
    await rejects((data) => {
      data.value.coverage.complete = false
      data.value.coverage.gaps = Array.from({ length: 129 }, (_, index) => ({
        fromBlock: index * 2 + 1,
        toBlock: index * 2 + 1,
      }))
    }, 300)
    await rejects((data) => {
      data.value.margins[0].reservedUserMargin = 6 as never
    })
    await rejects((data) => {
      data.value.margins[0].evaluatedPositionClaim = 2 as never
    })
  })
  it('rejects unknown fields on the fixed custody read contract', async () => {
    await rejects((data) => {
      ;(data.value as unknown as Record<string, unknown>).overrideComplete =
        true
    })
  })
  it('preserves adjacent unknown and explicit native gap ranges', async () => {
    const data = custody()
    data.value.coverage.complete = false
    data.value.coverage.gaps = [
      { fromBlock: 3, toBlock: 3 },
      { fromBlock: 4, toBlock: 5 },
      { fromBlock: 6, toBlock: 6 },
    ]
    const gaps = (
      await setup(envelope(data, 9)).exchange.getAccountCustody({
        address: user,
      })
    ).data.value.coverage.gaps
    expect(gaps).toEqual([
      { fromBlock: 3n, toBlock: 3n },
      { fromBlock: 4n, toBlock: 5n },
      { fromBlock: 6n, toBlock: 6n },
    ])
  })
  it('requires room through the anchor for hidden truncated gap ranges', async () => {
    const data = custody()
    data.value.coverage.complete = false
    data.value.coverage.gapRangesTruncated = true
    data.value.coverage.gaps = Array.from({ length: 128 }, (_, index) => ({
      fromBlock: index * 2 + 1,
      toBlock: index * 2 + 1,
    }))
    await expect(
      setup(envelope(data, 255)).exchange.getAccountCustody({
        address: user,
      }),
    ).rejects.toThrow()
    expect(
      (
        await setup(envelope(data, 256)).exchange.getAccountCustody({
          address: user,
        })
      ).data.value.coverage.gapRangesTruncated,
    ).toBe(true)
  })
})
