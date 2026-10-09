import { describe, expect, it } from 'vitest'
import { createPublicClient, custom } from 'viem'
import { exchangePublicActions } from '../src/exchange/actions.js'

// Literal expected RPC data follows native serde DTOs, not a production encoder.
const owner = '0x1111111111111111111111111111111111111111' as const
const key = '0x2222222222222222222222222222222222222222' as const
const marketId = `0x${'01'.repeat(32)}` as const
const secondMarketId = `0x${'02'.repeat(32)}` as const
const book = '0xd1e515000000000000000000000000000000590d' as const
const perpsBook = '0xd1e5150000000000000000000000000000009e29' as const
const orderId = `0x${'0'.repeat(48)}ffffffffffffffff` as const
const zeroAddress = `0x${'00'.repeat(20)}` as const
const zeroHash = `0x${'00'.repeat(32)}` as const
const blockHash = `0x${'a1'.repeat(32)}` as const
const indexDigest = `0x${'b2'.repeat(32)}` as const
const restrictedMask = `0x80${'00'.repeat(31)}` as const
const allMask = `0x${'ff'.repeat(32)}` as const
const maxU64 = '18446744073709551615'
const maxU256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const orderQuery = { owner, marketId, book, orderId }
const sessionQuery = { principal: owner, sessionKey: key }
const expiry = () => ({
  readVersion: 1,
  indexGeneration: maxU64,
  value: { identity: { ...orderQuery }, timeInForce: 1, expirySeconds: maxU64 },
})
const session = () => ({
  readVersion: 2,
  indexGeneration: maxU64,
  value: {
    principal: owner,
    sessionKey: key,
    authorizationGeneration: '9',
    blockTimestampSeconds: '100',
    status: 'authorized',
    actionScope: '2046',
    validUntilSeconds: '100',
    maxNotionalOrSpend: maxU256,
    allowedMarketsMask: restrictedMask,
    marketCount: 2,
    marketOrdinals: [
      { marketId, ordinal: 0, allowed: true },
      { marketId: secondMarketId, ordinal: 1, allowed: false },
    ],
    allAssignedAndFutureMarkets: false,
  },
})
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
describe('native control reads', () => {
  it('retains original order identity while caller params mutate during transport', async () => {
    const params = { ...orderQuery }
    const requests: unknown[] = []
    let signalRequest!: () => void
    let resolveReply!: (wire: unknown) => void
    const requested = new Promise<void>((resolve) => {
      signalRequest = resolve
    })
    const reply = new Promise<unknown>((resolve) => {
      resolveReply = resolve
    })
    const client = createPublicClient({
      transport: custom(
        {
          request: async (request) => {
            requests.push(request)
            signalRequest()
            return reply
          },
        },
        { retryCount: 0 },
      ),
    }).extend(exchangePublicActions)
    const pending = client.exchange.getOrderExpiry(params)
    await requested
    Object.assign(params, {
      owner: key,
      marketId: secondMarketId,
      book: perpsBook,
      orderId: marketId,
    })
    resolveReply(envelope(expiry()))
    const result = await pending
    expect(requests).toEqual([
      { method: 'exchange_getOrderExpiry', params: [orderQuery] },
    ])
    expect(result.blockNumber).toBe(42n)
    expect(result.blockHash).toBe(blockHash)
    expect(result.indexDigest).toBe(indexDigest)
    expect(result.data.value?.identity).toEqual(orderQuery)
  })
  it('retains original session identity while caller params mutate during transport', async () => {
    const params = { ...sessionQuery }
    const requests: unknown[] = []
    let signalRequest!: () => void
    let resolveReply!: (wire: unknown) => void
    const requested = new Promise<void>((resolve) => {
      signalRequest = resolve
    })
    const reply = new Promise<unknown>((resolve) => {
      resolveReply = resolve
    })
    const client = createPublicClient({
      transport: custom(
        {
          request: async (request) => {
            requests.push(request)
            signalRequest()
            return reply
          },
        },
        { retryCount: 0 },
      ),
    }).extend(exchangePublicActions)
    const pending = client.exchange.getSessionAuthorization(params)
    await requested
    Object.assign(params, { principal: key, sessionKey: owner })
    resolveReply(envelope(session()))
    const result = await pending
    expect(requests).toEqual([
      { method: 'exchange_getSessionAuthorization', params: [sessionQuery] },
    ])
    expect(result.blockNumber).toBe(42n)
    expect(result.blockHash).toBe(blockHash)
    expect(result.indexDigest).toBe(indexDigest)
    expect(result.data.value.principal).toBe(owner)
    expect(result.data.value.sessionKey).toBe(key)
  })
  it('exposes additive exchange helpers on the accepted public action extension', () => {
    const { exchange } = setup(null)
    expect(typeof exchange.getOrderExpiry).toBe('function')
    expect(typeof exchange.getSessionAuthorization).toBe('function')
  })
  it('preserves exact anchor, decimal u64s and order query shape', async () => {
    const { exchange, requests } = setup(envelope(expiry(), maxU64))
    expect(await exchange.getOrderExpiry(orderQuery)).toEqual({
      blockNumber: BigInt(maxU64),
      blockHash,
      indexDigest,
      data: {
        readVersion: 1,
        indexGeneration: BigInt(maxU64),
        value: {
          identity: orderQuery,
          timeInForce: 1,
          expirySeconds: BigInt(maxU64),
        },
      },
    })
    expect(requests).toEqual([
      { method: 'exchange_getOrderExpiry', params: [orderQuery] },
    ])
  })
  it.each([0, 2, 3])(
    'keeps null expiry for native TIF %i',
    async (timeInForce) => {
      const data = expiry()
      data.value.timeInForce = timeInForce
      data.value.expirySeconds = null as never
      expect(
        (await setup(envelope(data)).exchange.getOrderExpiry(orderQuery)).data
          .value,
      ).toEqual({ identity: orderQuery, timeInForce, expirySeconds: null })
    },
  )
  it('preserves explicit absent order with its indexed generation', async () => {
    const data = { readVersion: 1, indexGeneration: '0', value: null }
    expect(
      (await setup(envelope(data)).exchange.getOrderExpiry(orderQuery)).data,
    ).toEqual({ ...data, indexGeneration: 0n })
  })
  it('accepts native perps book and case-insensitive returned identity', async () => {
    const query = { ...orderQuery, book: perpsBook }
    const data = expiry()
    data.value.identity = {
      ...query,
      book: perpsBook.toUpperCase().replace('0X', '0x'),
    } as never
    expect(
      (
        await setup(envelope(data)).exchange.getOrderExpiry(query)
      ).data.value?.identity.book.toLowerCase(),
    ).toBe(perpsBook)
  })
  it.each([
    [
      'wrong identity owner',
      (d: any) => {
        d.value.identity.owner = key
      },
    ],
    [
      'wrong identity market',
      (d: any) => {
        d.value.identity.marketId = secondMarketId
      },
    ],
    [
      'wrong identity book',
      (d: any) => {
        d.value.identity.book = perpsBook
      },
    ],
    [
      'wrong identity order',
      (d: any) => {
        d.value.identity.orderId = marketId
      },
    ],
    [
      'unknown TIF',
      (d: any) => {
        d.value.timeInForce = 4
      },
    ],
    [
      'string TIF',
      (d: any) => {
        d.value.timeInForce = '1'
      },
    ],
    [
      'GTD null expiry',
      (d: any) => {
        d.value.expirySeconds = null
      },
    ],
    [
      'GTD zero expiry',
      (d: any) => {
        d.value.expirySeconds = '0'
      },
    ],
    [
      'GTC non-null expiry',
      (d: any) => {
        d.value.timeInForce = 0
      },
    ],
    [
      'numeric expiry',
      (d: any) => {
        d.value.expirySeconds = 10
      },
    ],
    [
      'hex expiry',
      (d: any) => {
        d.value.expirySeconds = '0xff'
      },
    ],
    [
      'u64 overflow',
      (d: any) => {
        d.value.expirySeconds = '18446744073709551616'
      },
    ],
    [
      'wrong read version',
      (d: any) => {
        d.readVersion = 2
      },
    ],
    [
      'numeric index generation',
      (d: any) => {
        d.indexGeneration = 1
      },
    ],
    [
      'noncanonical decimal',
      (d: any) => {
        d.indexGeneration = '01'
      },
    ],
    [
      'missing value',
      (d: any) => {
        delete d.value
      },
    ],
  ])('rejects malformed order data: %s', async (_, mutate) => {
    const data = expiry()
    mutate(data)
    await expect(
      setup(envelope(data)).exchange.getOrderExpiry(orderQuery),
    ).rejects.toThrow()
  })
  it.each([
    { ...orderQuery, owner: zeroAddress },
    { ...orderQuery, marketId: zeroHash },
    { ...orderQuery, orderId: zeroHash },
    { ...orderQuery, orderId: marketId },
    { ...orderQuery, book: owner },
    { ...orderQuery, orderId: '0x01' },
  ])('rejects invalid order query before request %#', async (query) => {
    const { exchange, requests } = setup(envelope(expiry()))
    await expect(exchange.getOrderExpiry(query as never)).rejects.toThrow()
    expect(requests).toEqual([])
  })
  it('decodes independent session and index generations, inclusive time, U256 ceiling and MSB-first ordinals', async () => {
    const { exchange, requests } = setup(envelope(session()))
    const result = await exchange.getSessionAuthorization(sessionQuery)
    expect(result).toEqual({
      blockNumber: 42n,
      blockHash,
      indexDigest,
      data: {
        readVersion: 2,
        indexGeneration: BigInt(maxU64),
        value: {
          ...session().value,
          authorizationGeneration: 9n,
          blockTimestampSeconds: 100n,
          actionScope: 2046n,
          validUntilSeconds: 100n,
          maxNotionalOrSpend: BigInt(maxU256),
        },
      },
    })
    expect(requests).toEqual([
      { method: 'exchange_getSessionAuthorization', params: [sessionQuery] },
    ])
  })
  it('returns expired facts at strictly later canonical timestamp and zero uncapped ceiling', async () => {
    const data = session()
    data.value.blockTimestampSeconds = '101'
    data.value.status = 'expired'
    data.value.maxNotionalOrSpend = '0'
    expect(
      (
        await setup(envelope(data)).exchange.getSessionAuthorization(
          sessionQuery,
        )
      ).data.value.maxNotionalOrSpend,
    ).toBe(0n)
  })
  it.each([
    ['unbound', '0'],
    ['revoked', '9'],
  ])(
    'keeps explicit %s absence with registry ordinals',
    async (status, generation) => {
      const data: any = session()
      Object.assign(data.value, {
        status,
        authorizationGeneration: generation,
        actionScope: null,
        validUntilSeconds: null,
        maxNotionalOrSpend: null,
        allowedMarketsMask: null,
      })
      data.value.marketOrdinals[0].allowed = false
      expect(
        (
          await setup(envelope(data)).exchange.getSessionAuthorization(
            sessionQuery,
          )
        ).data.value.status,
      ).toBe(status)
    },
  )
  it('accepts all-ff future-market sentinel including an empty registry', async () => {
    const data = session()
    Object.assign(data.value, {
      allowedMarketsMask: allMask,
      marketCount: 0,
      marketOrdinals: [],
      allAssignedAndFutureMarkets: true,
    })
    expect(
      (
        await setup(envelope(data)).exchange.getSessionAuthorization(
          sessionQuery,
        )
      ).data.value.allAssignedAndFutureMarkets,
    ).toBe(true)
  })
  it('handles all 256 ordinals, including the last low bit', async () => {
    const data = session()
    data.value.allowedMarketsMask = `0x${'00'.repeat(31)}01` as never
    data.value.marketCount = 256
    data.value.marketOrdinals = Array.from({ length: 256 }, (_, ordinal) => ({
      marketId: `0x${(ordinal + 1).toString(16).padStart(64, '0')}` as never,
      ordinal,
      allowed: ordinal === 255,
    }))
    const rows = (
      await setup(envelope(data)).exchange.getSessionAuthorization(sessionQuery)
    ).data.value.marketOrdinals
    expect(rows[0].allowed).toBe(false)
    expect(rows[255].allowed).toBe(true)
  })
  it.each([
    [
      'identity principal',
      (d: any) => {
        d.value.principal = key
      },
    ],
    [
      'identity key',
      (d: any) => {
        d.value.sessionKey = owner
      },
    ],
    [
      'wrong version',
      (d: any) => {
        d.readVersion = 1
      },
    ],
    [
      'numeric auth generation',
      (d: any) => {
        d.value.authorizationGeneration = 9
      },
    ],
    [
      'u64 auth overflow',
      (d: any) => {
        d.value.authorizationGeneration = '18446744073709551616'
      },
    ],
    [
      'zero bound generation',
      (d: any) => {
        d.value.authorizationGeneration = '0'
      },
    ],
    [
      'unsafe timestamp number',
      (d: any) => {
        d.value.blockTimestampSeconds = Number(maxU64)
      },
    ],
    [
      'unknown scope bit',
      (d: any) => {
        d.value.actionScope = '2048'
      },
    ],
    [
      'scope bit zero',
      (d: any) => {
        d.value.actionScope = '1'
      },
    ],
    [
      'zero scope',
      (d: any) => {
        d.value.actionScope = '0'
      },
    ],
    [
      'null bound scope',
      (d: any) => {
        d.value.actionScope = null
      },
    ],
    [
      'zero valid until',
      (d: any) => {
        d.value.validUntilSeconds = '0'
      },
    ],
    [
      'authorized past expiry',
      (d: any) => {
        d.value.blockTimestampSeconds = '101'
      },
    ],
    [
      'expired at inclusive equality',
      (d: any) => {
        d.value.status = 'expired'
      },
    ],
    [
      'unknown status',
      (d: any) => {
        d.value.status = 'valid'
      },
    ],
    [
      'null bound ceiling',
      (d: any) => {
        d.value.maxNotionalOrSpend = null
      },
    ],
    [
      'U256 ceiling overflow',
      (d: any) => {
        d.value.maxNotionalOrSpend = (BigInt(maxU256) + 1n).toString()
      },
    ],
    [
      'future ordinal mask bit',
      (d: any) => {
        d.value.allowedMarketsMask = `0x20${'00'.repeat(31)}`
      },
    ],
    [
      'inverted ordinal bit',
      (d: any) => {
        d.value.marketOrdinals[0].allowed = false
      },
    ],
    [
      'string allowed',
      (d: any) => {
        d.value.marketOrdinals[1].allowed = 'false'
      },
    ],
    [
      'missing ordinal',
      (d: any) => {
        d.value.marketOrdinals.pop()
      },
    ],
    [
      'wrong ordinal order',
      (d: any) => {
        d.value.marketOrdinals[0].ordinal = 1
      },
    ],
    [
      'duplicate market',
      (d: any) => {
        d.value.marketOrdinals[1].marketId = marketId
      },
    ],
    [
      'zero registry market',
      (d: any) => {
        d.value.marketOrdinals[1].marketId = zeroHash
      },
    ],
    [
      'too many markets',
      (d: any) => {
        d.value.marketCount = 257
      },
    ],
    [
      'string market count',
      (d: any) => {
        d.value.marketCount = '2'
      },
    ],
    [
      'inconsistent sentinel',
      (d: any) => {
        d.value.allAssignedAndFutureMarkets = true
      },
    ],
    [
      'revoked retains words',
      (d: any) => {
        d.value.status = 'revoked'
      },
    ],
    [
      'unbound positive generation',
      (d: any) => {
        Object.assign(d.value, {
          status: 'unbound',
          actionScope: null,
          validUntilSeconds: null,
          maxNotionalOrSpend: null,
          allowedMarketsMask: null,
        })
        d.value.marketOrdinals[0].allowed = false
      },
    ],
    [
      'revoked zero generation',
      (d: any) => {
        Object.assign(d.value, {
          status: 'revoked',
          authorizationGeneration: '0',
          actionScope: null,
          validUntilSeconds: null,
          maxNotionalOrSpend: null,
          allowedMarketsMask: null,
        })
        d.value.marketOrdinals[0].allowed = false
      },
    ],
  ])('rejects malformed session data: %s', async (_, mutate) => {
    const data = session()
    mutate(data)
    await expect(
      setup(envelope(data)).exchange.getSessionAuthorization(sessionQuery),
    ).rejects.toThrow()
  })
  it.each([
    { principal: zeroAddress, sessionKey: key },
    { principal: owner, sessionKey: zeroAddress },
    { principal: owner, sessionKey: owner },
  ])('rejects invalid session query before request %#', async (query) => {
    const { exchange, requests } = setup(envelope(session()))
    await expect(exchange.getSessionAuthorization(query)).rejects.toThrow()
    expect(requests).toEqual([])
  })
  it.each([Number(maxU64), -1, '18446744073709551616'])(
    'rejects unsafe or out-of-domain indexed block %#',
    async (block) => {
      await expect(
        setup(envelope(expiry(), block)).exchange.getOrderExpiry(orderQuery),
      ).rejects.toThrow()
    },
  )
  it.each(['blockHash', 'indexDigest'])(
    'rejects malformed %s anchor',
    async (field) => {
      const wire = envelope(session())
      ;(wire as any)[field] = '0x12'
      await expect(
        setup(wire).exchange.getSessionAuthorization(sessionQuery),
      ).rejects.toThrow()
    },
  )
  it('propagates native RPC failure with no fallback or second request', async () => {
    const { exchange, requests } = setup(
      null,
      new Error('canonical session read unavailable'),
    )
    await expect(
      exchange.getSessionAuthorization(sessionQuery),
    ).rejects.toThrow('canonical session read unavailable')
    expect(requests).toHaveLength(1)
  })
})
