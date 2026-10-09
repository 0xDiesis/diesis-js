import { describe, expect, it } from 'vitest'
import { createPublicClient, custom, InternalRpcError } from 'viem'
import { patronageActions } from '../src/patronage/index.js'
import {
  patronageActions as rootPatronageActions,
  diesisPublicActions,
} from '../src/index.js'

// Independent synthetic source-derived DTOs, not emitted/ABI/golden/live logs.
// Native44bed gas_grants.rs uses bare JSON u64/u32, not U256 quantities.
// patron_index/tests.rs audited_events: contributor is indexed, amount word(1).
// topic0 below is deliberately a placeholder; no kind/topic/data ABI assertion.
// Vitest transpiles these annotations; source/package consumer tsc proves types.
type RecordValue = Record<string, any>
type Request = { method: string; params?: unknown }
type HistoryMethods = { getPatronHistory?: (params?: unknown) => Promise<any> }
type Category =
  | 'query'
  | 'cursor'
  | 'integer'
  | 'page'
  | 'event'
  | 'identity'
  | 'continuation'
const hash = (value: number) => `0x${value.toString(16).padStart(64, '0')}`
const grant = `0x${'11'.repeat(32)}`
const campaign = `0x${'12'.repeat(32)}`
const account = `0x${'22'.repeat(20)}`
const otherAccount = `0x${'33'.repeat(20)}`
const maxSafe = Number.MAX_SAFE_INTEGER
const u32Max = 0xffffffff
const u64Max = (1n << 64n) - 1n
const pageFields = [
  'anchorBlockNumber',
  'anchorBlockHash',
  'retentionFloorBlockNumber',
  'retentionFloorBlockHash',
  'events',
  'next',
]
const eventFields = [
  'blockNumber',
  'blockHash',
  'transactionHash',
  'transactionIndex',
  'logIndex',
  'kind',
  'grantId',
  'campaignId',
  'account',
  'topics',
  'data',
]
const cursorFields = [
  'anchorBlockNumber',
  'anchorBlockHash',
  'blockNumber',
  'transactionIndex',
  'logIndex',
]
const kinds = [
  'grantContributed',
  'grantReserved',
  'grantReservationCancelled',
  'grantSettled',
  'settledBurnAccrued',
  'grantWithdrawn',
  'referralGrantSet',
  'accountGrantAssigned',
  'grantAuthorizationSet',
  'grantAuthorizationRevoked',
  'grantGasLimitsUpdated',
  'paused',
  'stakingAddressUpdated',
  'campaignRegistered',
  'campaignRevocationSet',
  'campaignOwnerRotated',
  'campaignVoucherClaimed',
  'campaignVoucherRevoked',
  'burnFlushed',
  'burnFlushFailed',
]
function event(
  blockNumber = 5,
  transactionIndex = 0,
  logIndex = 0,
): RecordValue {
  return {
    blockNumber,
    blockHash: hash(blockNumber),
    transactionHash: hash(50 + blockNumber),
    transactionIndex,
    logIndex,
    kind: 'grantContributed',
    grantId: grant,
    campaignId: null,
    account,
    topics: [hash(999), grant, `0x${'00'.repeat(12)}${account.slice(2)}`],
    data: hash(1),
  }
}
function page(events: RecordValue[] = [event()]): RecordValue {
  return {
    anchorBlockNumber: 10,
    anchorBlockHash: hash(10),
    retentionFloorBlockNumber: 1,
    retentionFloorBlockHash: hash(1),
    events,
    next: null,
  }
}
function requestCursor(overrides: RecordValue = {}): RecordValue {
  return {
    anchorBlockNumber: 10n,
    anchorBlockHash: hash(10),
    blockNumber: 4n,
    transactionIndex: 0,
    logIndex: 0,
    ...overrides,
  }
}
function nextCursor(
  row: RecordValue = event(),
  overrides: RecordValue = {},
): RecordValue {
  return {
    anchorBlockNumber: 10,
    anchorBlockHash: hash(10),
    blockNumber: row.blockNumber,
    transactionIndex: row.transactionIndex,
    logIndex: row.logIndex,
    ...overrides,
  }
}
function jsonBoundary(value: unknown): any {
  return JSON.parse(JSON.stringify(value))
}
// Expected projection is constructed from independent valid literals only;
// no production decoder/validator manufactures either expected DTO or errors.
function expectedPage(value: RecordValue): RecordValue {
  return {
    anchorBlockNumber: BigInt(value.anchorBlockNumber),
    anchorBlockHash: value.anchorBlockHash,
    retentionFloorBlockNumber: BigInt(value.retentionFloorBlockNumber),
    retentionFloorBlockHash: value.retentionFloorBlockHash,
    events: value.events.map((row: RecordValue) => ({
      blockNumber: BigInt(row.blockNumber),
      blockHash: row.blockHash,
      transactionHash: row.transactionHash,
      transactionIndex: row.transactionIndex === 0 ? 0 : row.transactionIndex,
      logIndex: row.logIndex === 0 ? 0 : row.logIndex,
      kind: row.kind,
      grantId: row.grantId,
      campaignId: row.campaignId,
      account: row.account,
      topics: [...row.topics],
      data: row.data,
    })),
    next:
      value.next === null
        ? null
        : {
            anchorBlockNumber: BigInt(value.next.anchorBlockNumber),
            anchorBlockHash: value.next.anchorBlockHash,
            blockNumber: BigInt(value.next.blockNumber),
            transactionIndex:
              value.next.transactionIndex === 0
                ? 0
                : value.next.transactionIndex,
            logIndex: value.next.logIndex === 0 ? 0 : value.next.logIndex,
          },
  }
}
function fixture(response: unknown, mode: 'leaf' | 'root' | 'public' = 'leaf') {
  const requests: Request[] = []
  const rawRequests: Request[] = []
  const base = createPublicClient({
    transport: custom(
      {
        request: async (request) => {
          rawRequests.push(request)
          requests.push(jsonBoundary(request))
          return jsonBoundary(response)
        },
      },
      { retryCount: 0 },
    ),
  })
  const factory =
    mode === 'public'
      ? diesisPublicActions
      : mode === 'root'
        ? rootPatronageActions
        : patronageActions
  return {
    actions: base.extend(factory) as unknown as HistoryMethods,
    requests,
    rawRequests,
  }
}
function direct(response: unknown) {
  const requests: Request[] = []
  const actions = patronageActions({
    request: async (request: Request) => {
      requests.push(request)
      return response
    },
  } as never) as unknown as HistoryMethods
  return { actions, requests }
}
function requireHistory(actions: HistoryMethods) {
  // Precise healthy-runtime RED; never invoke an absent method/TypeError.
  expect(
    typeof actions.getPatronHistory,
    'getPatronHistory is exposed by the real existing decorator',
  ).toBe('function')
  return actions.getPatronHistory!
}
async function rejected(call: () => Promise<unknown>, category: Category) {
  let pending: Promise<unknown> | undefined
  expect(() => {
    pending = call()
  }).not.toThrow()
  expect(pending).toBeInstanceOf(Promise)
  let didReject = false
  let failure: unknown
  await pending!.then(
    () => {},
    (error: unknown) => {
      didReject = true
      failure = error
    },
  )
  expect(didReject).toBe(true)
  expect(failure).toBeInstanceOf(Error)
  expect(failure).not.toBeInstanceOf(TypeError)
  expect((failure as Error).message).toBe(`Invalid patron history ${category}`)
}
async function badQuery(value: unknown, category: Category) {
  const f = direct(page())
  const read = requireHistory(f.actions)
  await rejected(() => read(value), category)
  expect(f.requests).toEqual([])
}
async function badPage(value: unknown, category: Category, query?: unknown) {
  const f = direct(value)
  const read = requireHistory(f.actions)
  await rejected(() => read(query), category)
  expect(f.requests).toHaveLength(1)
  expect(f.requests[0].method).toBe('diesis_getPatronHistory')
}
function inheritedField(value: RecordValue, key: string): RecordValue {
  const own = { ...value }
  const inherited = own[key]
  delete own[key]
  return Object.assign(Object.create({ [key]: inherited }), own)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('manual source-root/subpath Patron history native44bed contract', () => {
  it('retains healthy existing exports and Stage1 RPC behavior without new imports', async () => {
    expect(rootPatronageActions).toBe(patronageActions)
    expect(typeof diesisPublicActions).toBe('function')
    const requests: Request[] = []
    const actions = patronageActions({
      request: async (request: Request) => {
        requests.push(request)
        return {
          grantId: grant,
          balance: '0x0',
          totalContributed: '0x1',
          totalSpent: '0x0',
          paused: false,
        }
      },
    } as never)
    expect(await actions.getGrant({ grantId: grant as never })).toEqual({
      grantId: grant,
      balance: 0n,
      totalContributed: 1n,
      totalSpent: 0n,
      paused: false,
    })
    expect(requests).toEqual([{ method: 'diesis_getGrant', params: [grant] }])
  })

  it.each(['leaf', 'root', 'public'] as const)(
    '%s exposes history with zero automatic calls and one default JSON RPC',
    async (mode) => {
      const source = page([])
      const f = fixture(source, mode)
      expect(f.requests).toEqual([])
      const read = requireHistory(f.actions)
      expect(f.requests).toEqual([])
      expect(await read()).toEqual(expectedPage(source))
      expect(f.requests).toEqual([
        { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
      ])
    },
  )
  it.each([
    { name: 'explicit undefined', value: undefined },
    { name: 'empty object', value: {} },
  ])('encodes $name with only limit0', async ({ value }) => {
    const f = fixture(page([]))
    const read = requireHistory(f.actions)
    await read(value)
    expect(f.requests).toEqual([
      { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
    ])
  })
  it('captures a complete filter/cursor query as exact JSON numbers and retains valid spelling', async () => {
    const g = `0x${'Ab'.repeat(32)}`
    const c = `0x${'Cd'.repeat(32)}`
    const a = `0x${'Ab'.repeat(20)}`
    const source = page([
      {
        ...event(),
        grantId: g.toLowerCase(),
        campaignId: c.toLowerCase(),
        account: a.toLowerCase(),
      },
    ])
    const query = {
      fromBlock: 1n,
      toBlock: 10n,
      cursor: requestCursor(),
      grantId: g,
      campaignId: c,
      account: a,
      limit: 2,
    }
    const f = fixture(source)
    const read = requireHistory(f.actions)
    expect(await read(query)).toEqual(expectedPage(source))
    expect(f.requests).toEqual([
      {
        method: 'diesis_getPatronHistory',
        params: [
          {
            fromBlock: 1,
            toBlock: 10,
            cursor: {
              anchorBlockNumber: 10,
              anchorBlockHash: hash(10),
              blockNumber: 4,
              transactionIndex: 0,
              logIndex: 0,
            },
            grantId: g,
            campaignId: c,
            account: a,
            limit: 2,
          },
        ],
      },
    ])
  })
  it('omits own undefined options and ignores nonenumerable unknown extras', async () => {
    const query = {
      fromBlock: undefined,
      toBlock: undefined,
      cursor: undefined,
      grantId: undefined,
      campaignId: undefined,
      account: undefined,
      limit: undefined,
    }
    Object.defineProperty(query, 'ignored', { value: 7, enumerable: false })
    const f = fixture(page([]))
    await requireHistory(f.actions)(query)
    expect(f.requests).toEqual([
      { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
    ])
  })
  it('snapshots mutable query filters/cursor/wire before a delayed response', async () => {
    const gate = deferred<unknown>()
    const requests: Request[] = []
    const actions = patronageActions({
      request: async (request: Request) => {
        requests.push(request)
        return gate.promise
      },
    } as never) as unknown as HistoryMethods
    const query = {
      fromBlock: 1n,
      toBlock: 10n,
      grantId: grant,
      cursor: requestCursor(),
      limit: 1,
    }
    const pending = requireHistory(actions)(query)
    query.fromBlock = 9n
    query.toBlock = 9n
    query.grantId = hash(90)
    query.cursor.blockNumber = 9n
    query.cursor.anchorBlockHash = hash(90)
    query.limit = 256
    gate.resolve(page())
    expect(await pending).toEqual(expectedPage(page()))
    expect(requests).toEqual([
      {
        method: 'diesis_getPatronHistory',
        params: [
          {
            fromBlock: 1,
            toBlock: 10,
            grantId: grant,
            cursor: {
              anchorBlockNumber: 10,
              anchorBlockHash: hash(10),
              blockNumber: 4,
              transactionIndex: 0,
              logIndex: 0,
            },
            limit: 1,
          },
        ],
      },
    ])
  })
})

describe('request preflight one-fault categories and bounds', () => {
  it.each([null, [], false, 3, 'query'].map((value) => ({ value })))(
    'rejects nonrecord query $value asynchronously before IO',
    async ({ value }) => {
      await badQuery(value, 'query')
    },
  )
  it.each([
    'fromBlock',
    'toBlock',
    'cursor',
    'grantId',
    'campaignId',
    'account',
    'limit',
  ])('rejects inherited known option %s', async (key) => {
    const value = {
      fromBlock: 1n,
      toBlock: 10n,
      cursor: requestCursor(),
      grantId: grant,
      campaignId: campaign,
      account,
      limit: 1,
    }
    await badQuery(inheritedField(value, key), 'query')
  })
  it('rejects enumerable unknown string and symbol keys but accepts valid own data', async () => {
    await badQuery({ scanBudget: 4096 }, 'query')
    await badQuery({ [Symbol('unknown')]: 1 }, 'query')
    const f = direct(page([]))
    await requireHistory(f.actions)({ limit: 1 })
    expect(f.requests).toHaveLength(1)
  })
  it('rejects a query getter without running it', async () => {
    let evaluations = 0
    const query = {}
    Object.defineProperty(query, 'grantId', {
      enumerable: true,
      get() {
        evaluations++
        return grant
      },
    })
    await badQuery(query, 'query')
    expect(evaluations).toBe(0)
  })
  it.each(['grantId', 'campaignId', 'account', 'cursor'])(
    'rejects optional nonnumeric %s:null as query',
    async (key) => {
      await badQuery({ [key]: null }, 'query')
    },
  )
  it.each(['grantId', 'campaignId'])(
    'rejects malformed %s spelling/width as query',
    async (key) => {
      for (const value of [
        '0x1',
        `0X${'a'.repeat(64)}`,
        `0x${'g'.repeat(64)}`,
        ` ${grant}`,
        [grant],
        false,
      ])
        await badQuery({ [key]: value }, 'query')
    },
  )
  it.each(
    [`0x${'1'.repeat(39)}`, `0x${'g'.repeat(40)}`, [account], 3].map(
      (value) => ({ value }),
    ),
  )('rejects malformed address $value as query', async ({ value }) => {
    await badQuery({ account: value }, 'query')
  })
  const badBlocks = [
    0,
    '1',
    1.5,
    -1n,
    u64Max,
    u64Max + 1n,
    BigInt(maxSafe) + 1n,
    null,
    false,
  ]
  it.each(['fromBlock', 'toBlock'])(
    'rejects present invalid public bigint block %s',
    async (key) => {
      for (const value of badBlocks) await badQuery({ [key]: value }, 'integer')
    },
  )
  it.each([{ value: 0n }, { value: BigInt(maxSafe) }])(
    'accepts safe bigint endpoint $value without invented missing bounds',
    async ({ value }) => {
      for (const key of ['fromBlock', 'toBlock']) {
        const f = fixture(page([]))
        await requireHistory(f.actions)({ [key]: value })
        expect(f.requests[0]).toEqual({
          method: 'diesis_getPatronHistory',
          params: [{ [key]: Number(value), limit: 0 }],
        })
      }
    },
  )
  it('accepts inclusive10000 range and refuses inverted/10001 explicit spans', async () => {
    const f = fixture(page([]))
    await requireHistory(f.actions)({ fromBlock: 1n, toBlock: 10000n })
    expect(f.requests[0].params).toEqual([
      { fromBlock: 1, toBlock: 10000, limit: 0 },
    ])
    await badQuery({ fromBlock: 10n, toBlock: 1n }, 'query')
    await badQuery({ fromBlock: 0n, toBlock: 10000n }, 'query')
  })
  it.each([0, 1, 256])(
    'accepts limit%s, including zero meaning256',
    async (limit) => {
      const f = fixture(page([]))
      await requireHistory(f.actions)({ limit })
      expect(f.requests[0].params).toEqual([{ limit }])
    },
  )
  it.each(
    [257, -1, 1.5, '1', null, Infinity, NaN, 1n].map((value) => ({ value })),
  )('rejects invalid limit $value as integer', async ({ value }) => {
    await badQuery({ limit: value }, 'integer')
  })
  it.each([[], false, 'cursor', 3].map((value) => ({ value })))(
    'rejects nonrecord nonnull cursor $value as cursor',
    async ({ value }) => {
      await badQuery({ cursor: value }, 'cursor')
    },
  )
  it.each(cursorFields)(
    'rejects missing/inherited/accessor request cursor %s',
    async (key) => {
      const missing = requestCursor()
      delete missing[key]
      await badQuery({ cursor: missing }, 'cursor')
      await badQuery({ cursor: inheritedField(requestCursor(), key) }, 'cursor')
      let evaluations = 0
      const accessor = requestCursor()
      Object.defineProperty(accessor, key, {
        get() {
          evaluations++
          return key.includes('Hash') ? hash(10) : 0
        },
        enumerable: true,
      })
      await badQuery({ cursor: accessor }, 'cursor')
      expect(evaluations).toBe(0)
    },
  )
  it('rejects cursor unknown enumerable fields/symbols and malformed B256', async () => {
    await badQuery({ cursor: requestCursor({ unknown: 0 }) }, 'cursor')
    await badQuery(
      { cursor: { ...requestCursor(), [Symbol('extra')]: true } },
      'cursor',
    )
    for (const anchorBlockHash of ['0x1', null, undefined, [hash(10)]])
      await badQuery({ cursor: requestCursor({ anchorBlockHash }) }, 'cursor')
  })
  it.each(['anchorBlockNumber', 'blockNumber'])(
    'rejects present bad request cursor height %s as integer',
    async (key) => {
      for (const value of badBlocks.concat([undefined] as any))
        await badQuery({ cursor: requestCursor({ [key]: value }) }, 'integer')
    },
  )
  it.each(['transactionIndex', 'logIndex'])(
    'accepts ordinal endpoints and refuses invalid cursor %s',
    async (key) => {
      for (const value of [0, u32Max]) {
        const f = direct(page([]))
        await requireHistory(f.actions)({
          cursor: requestCursor({ [key]: value }),
        })
        expect(f.requests).toHaveLength(1)
      }
      for (const value of [
        -1,
        1.5,
        NaN,
        Infinity,
        u32Max + 1,
        0n,
        '0',
        null,
        undefined,
      ])
        await badQuery({ cursor: requestCursor({ [key]: value }) }, 'integer')
    },
  )
  it('rejects cursor anchor/explicit endpoint membership independently', async () => {
    await badQuery({ cursor: requestCursor({ blockNumber: 11n }) }, 'cursor')
    await badQuery({ fromBlock: 5n, cursor: requestCursor() }, 'cursor')
    await badQuery({ toBlock: 3n, cursor: requestCursor() }, 'cursor')
  })
  it('accepts cursor equality at explicit endpoints and ignores a nonenumerable unknown cursor key', async () => {
    const cursor = requestCursor()
    Object.defineProperty(cursor, 'ignored', { value: 7, enumerable: false })
    const f = fixture(page([]))
    await requireHistory(f.actions)({ fromBlock: 4n, toBlock: 4n, cursor })
    expect(f.requests[0].params).toEqual([
      {
        fromBlock: 4,
        toBlock: 4,
        cursor: {
          anchorBlockNumber: 10,
          anchorBlockHash: hash(10),
          blockNumber: 4,
          transactionIndex: 0,
          logIndex: 0,
        },
        limit: 0,
      },
    ])
  })
  it('normalizes raw request -0 ordinals/limit before JSON crosses viem', async () => {
    const f = fixture(page([]))
    await requireHistory(f.actions)({
      limit: -0,
      cursor: requestCursor({ transactionIndex: -0, logIndex: -0 }),
    })
    const raw = (f.rawRequests[0].params as RecordValue[])[0]
    expect(raw.limit).toBe(0)
    expect(Object.is(raw.limit, -0)).toBe(false)
    for (const key of ['transactionIndex', 'logIndex']) {
      expect(raw.cursor[key]).toBe(0)
      expect(Object.is(raw.cursor[key], -0)).toBe(false)
    }
    expect(f.requests[0].params).toEqual([
      {
        limit: 0,
        cursor: {
          anchorBlockNumber: 10,
          anchorBlockHash: hash(10),
          blockNumber: 4,
          transactionIndex: 0,
          logIndex: 0,
        },
      },
    ])
  })
  it.each([
    {
      name: 'top shape before cursor integer',
      value: { extra: true, cursor: requestCursor({ logIndex: NaN }) },
      category: 'query',
    },
    {
      name: 'optional hash null before limit integer',
      value: { grantId: null, limit: NaN },
      category: 'query',
    },
    {
      name: 'optional hash null before cursor shape',
      value: { grantId: null, cursor: {} },
      category: 'query',
    },
    {
      name: 'cursor shape before query integer',
      value: { cursor: {}, limit: NaN },
      category: 'cursor',
    },
    {
      name: 'query hash before cursor hash',
      value: {
        grantId: '0x1',
        cursor: requestCursor({ anchorBlockHash: '0x1' }),
      },
      category: 'query',
    },
    {
      name: 'integer before query scalar',
      value: { grantId: '0x1', limit: NaN },
      category: 'integer',
    },
    {
      name: 'cursor membership before inverted range',
      value: { fromBlock: 9n, toBlock: 2n, cursor: requestCursor() },
      category: 'cursor',
    },
  ])('freezes request precedence: $name', async ({ value, category }) => {
    await badQuery(value, category as Category)
  })
})

describe('direct page structural/integer/event decoding', () => {
  it('accepts a valid source-shaped contribution with contributor mapping and nullable fields', async () => {
    const source = page()
    const f = fixture(source)
    const result = await requireHistory(f.actions)()
    expect(result).toEqual(expectedPage(source))
    expect(result.events[0].topics[2]).toBe(
      `0x${'00'.repeat(12)}${account.slice(2)}`,
    )
    expect(result.events[0].campaignId).toBeNull()
    expect(result.next).toBeNull()
  })
  it.each(kinds)(
    'accepts schema kind %s without claiming ABI kind/topic semantics',
    async (kind) => {
      const source = page([{ ...event(), kind }])
      const f = fixture(source)
      expect(await requireHistory(f.actions)()).toEqual(expectedPage(source))
    },
  )
  it.each([null, undefined, [], false, 2, 'page'].map((value) => ({ value })))(
    'refuses non-direct page $value',
    async ({ value }) => {
      await badPage(value, 'page')
    },
  )
  it.each(pageFields)(
    'refuses missing/inherited page %s as shape before numbers',
    async (key) => {
      const missing = page()
      delete missing[key]
      await badPage(missing, 'page')
      await badPage(inheritedField(page(), key), 'page')
    },
  )
  it.each(eventFields)('refuses missing/inherited event %s', async (key) => {
    const missing = event()
    delete missing[key]
    await badPage(page([missing]), 'event')
    await badPage(page([inheritedField(event(), key)]), 'event')
  })
  it.each(cursorFields)(
    'refuses missing/inherited next %s as continuation',
    async (key) => {
      const next = nextCursor()
      delete next[key]
      await badPage({ ...page(), next }, 'continuation', { limit: 1 })
      await badPage(
        { ...page(), next: inheritedField(nextCursor(), key) },
        'continuation',
        { limit: 1 },
      )
    },
  )
  it('refuses own response accessors in page/event/next/topics without evaluating them', async () => {
    for (const place of ['page', 'event', 'next', 'topic']) {
      let evaluations = 0
      const value = page()
      let target: object = value
      let key: PropertyKey = 'anchorBlockNumber'
      if (place === 'event') {
        target = value.events[0]
        key = 'kind'
      }
      if (place === 'next') {
        value.next = nextCursor()
        target = value.next
        key = 'blockNumber'
      }
      if (place === 'topic') {
        target = value.events[0].topics
        key = '0'
      }
      Object.defineProperty(target, key, {
        enumerable: true,
        get() {
          evaluations++
          return 1
        },
      })
      await badPage(
        value,
        place === 'page' ? 'page' : place === 'next' ? 'continuation' : 'event',
        { limit: 1 },
      )
      expect(evaluations).toBe(0)
    }
  })
  it.each([null, undefined, [], false, 2, 'event'].map((value) => ({ value })))(
    'refuses invalid event record $value as event',
    async ({ value }) => {
      await badPage(page([value as any]), 'event')
    },
  )
  it.each([undefined, [], false, 2, 'next'].map((value) => ({ value })))(
    'refuses present nonnull invalid next $value as continuation',
    async ({ value }) => {
      await badPage({ ...page(), next: value }, 'continuation', { limit: 1 })
    },
  )
  const numberFaults = [
    -1,
    0.5,
    NaN,
    Infinity,
    maxSafe + 1,
    '5',
    '0x5',
    5n,
    null,
    undefined,
  ]
  it.each(['anchorBlockNumber', 'retentionFloorBlockNumber'])(
    'refuses present page height %s integer faults, not enclosing shape',
    async (key) => {
      for (const value of numberFaults)
        await badPage({ ...page(), [key]: value }, 'integer')
    },
  )
  it.each(['blockNumber', 'transactionIndex', 'logIndex'])(
    'refuses present event %s integer faults',
    async (key) => {
      for (const value of numberFaults)
        await badPage(page([{ ...event(), [key]: value }]), 'integer')
      if (key !== 'blockNumber')
        await badPage(page([{ ...event(), [key]: u32Max + 1 }]), 'integer')
    },
  )
  it.each(['anchorBlockNumber', 'blockNumber', 'transactionIndex', 'logIndex'])(
    'refuses present next %s integer faults',
    async (key) => {
      for (const value of numberFaults)
        await badPage(
          { ...page(), next: nextCursor(event(), { [key]: value }) },
          'integer',
          { limit: 1 },
        )
      if (key.endsWith('Index'))
        await badPage(
          { ...page(), next: nextCursor(event(), { [key]: u32Max + 1 }) },
          'integer',
          { limit: 1 },
        )
    },
  )
  it('accepts zero/MAX_SAFE_INTEGER wire heights and u32max ordinals', async () => {
    for (const height of [0, maxSafe]) {
      const row = { ...event(height, u32Max, u32Max), blockHash: hash(7) }
      const source = {
        ...page([row]),
        anchorBlockNumber: height,
        anchorBlockHash: hash(7),
        retentionFloorBlockNumber: height,
        retentionFloorBlockHash: hash(7),
      }
      const f = fixture(source)
      expect(await requireHistory(f.actions)()).toEqual(expectedPage(source))
    }
  })
  it('refuses an unsafe bare JSON u64 parsed through the real viem boundary', async () => {
    const f = fixture({ ...page([]), anchorBlockNumber: maxSafe + 1 })
    const read = requireHistory(f.actions)
    await rejected(() => read(), 'integer')
    expect(f.requests).toEqual([
      { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
    ])
  })
  it('normalizes direct response negative-zero heights/ordinals including continuation', async () => {
    const row = { ...event(0, -0, -0), blockHash: hash(0) }
    const source = {
      ...page([row]),
      anchorBlockNumber: -0,
      anchorBlockHash: hash(0),
      retentionFloorBlockNumber: -0,
      retentionFloorBlockHash: hash(0),
      next: nextCursor(row, {
        anchorBlockNumber: -0,
        anchorBlockHash: hash(0),
        blockNumber: -0,
        transactionIndex: -0,
        logIndex: -0,
      }),
    }
    const f = direct(source)
    const result = await requireHistory(f.actions)({ limit: 1 })
    expect(result).toEqual(expectedPage(source))
    expect(result.anchorBlockNumber).toBe(0n)
    expect(result.events[0].blockNumber).toBe(0n)
    for (const holder of [result.events[0], result.next])
      for (const key of ['transactionIndex', 'logIndex'])
        expect(Object.is(holder[key], -0)).toBe(false)
  })
  it('projects fresh exact output fields/arrays without altering or aliasing server values', async () => {
    const source = { ...page(), next: nextCursor(), extra: 'ignored' }
    source.events[0].extra = true
    source.next.extra = true
    const f = direct(source)
    const result = await requireHistory(f.actions)({ limit: 1 })
    expect(result).toEqual(expectedPage(source))
    expect(result).not.toBe(source)
    expect(result.events).not.toBe(source.events)
    expect(result.events[0]).not.toBe(source.events[0])
    expect(result.events[0].topics).not.toBe(source.events[0].topics)
    expect(result.next).not.toBe(source.next)
    expect(Object.keys(result).sort()).toEqual([...pageFields].sort())
    expect(Object.keys(result.events[0]).sort()).toEqual(
      [...eventFields].sort(),
    )
    expect(Object.keys(result.next).sort()).toEqual([...cursorFields].sort())
    result.events[0].topics[0] = hash(88)
    result.next.logIndex = 99
    expect(source.events[0].topics[0]).toBe(hash(999))
    expect(source.next.logIndex).toBe(0)
    expect(source.extra).toBe('ignored')
    expect(source.events[0].extra).toBe(true)
  })
  it.each(['anchorBlockHash', 'retentionFloorBlockHash'])(
    'refuses malformed page %s as page',
    async (key) => {
      for (const value of ['0x1', [hash(1)], null, false])
        await badPage({ ...page(), [key]: value }, 'page')
    },
  )
  it.each(['blockHash', 'transactionHash'])(
    'refuses malformed event %s as event',
    async (key) => {
      for (const value of ['0x1', [hash(1)], null, false])
        await badPage(page([{ ...event(), [key]: value }]), 'event')
    },
  )
  it.each(['grantId', 'campaignId', 'account'])(
    'accepts explicit null but rejects malformed nullable %s',
    async (key) => {
      const source = page([{ ...event(), [key]: null }])
      const f = fixture(source)
      expect(await requireHistory(f.actions)()).toEqual(expectedPage(source))
      for (const value of ['0x1', [], false, undefined])
        await badPage(page([{ ...event(), [key]: value }]), 'event')
    },
  )
  it.each(
    ['unknown', null, ['grantContributed'], 1].map((value) => ({ value })),
  )('refuses invalid kind $value', async ({ value }) => {
    await badPage(page([{ ...event(), kind: value }]), 'event')
  })
  it('refuses malformed next anchor hash as continuation', async () => {
    for (const anchorBlockHash of ['0x1', null, undefined, [hash(10)]])
      await badPage(
        { ...page(), next: nextCursor(event(), { anchorBlockHash }) },
        'continuation',
        { limit: 1 },
      )
  })
})

describe('bounded dense events/topics/data', () => {
  it.each([0, 1, 256])(
    'accepts dense%s events at the effective maximum',
    async (count) => {
      const source = page(
        Array.from({ length: count }, (_, index) => event(5, 0, index)),
      )
      const f = fixture(source)
      expect(await requireHistory(f.actions)({ limit: 0 })).toEqual(
        expectedPage(source),
      )
    },
  )
  it('rejects effective-limit overflow and257 rows as page', async () => {
    await badPage(page([event(5, 0, 0), event(5, 0, 1)]), 'page', { limit: 1 })
    await badPage(
      page(Array.from({ length: 257 }, (_, index) => event(5, 0, index))),
      'page',
    )
  })
  it('treats negative-zero limit as the256-row default and puts positive0 on the raw wire', async () => {
    const source = page(
      Array.from({ length: 256 }, (_, index) => event(5, 0, index)),
    )
    const f = fixture(source)
    expect(await requireHistory(f.actions)({ limit: -0 })).toEqual(
      expectedPage(source),
    )
    const raw = (f.rawRequests[0].params as RecordValue[])[0]
    expect(raw.limit).toBe(0)
    expect(Object.is(raw.limit, -0)).toBe(false)
    expect(f.requests).toHaveLength(1)
  })
  it('rejects null/nonarray/sparse/inherited/accessor events without invoking getters', async () => {
    for (const value of [null, false, {}])
      await badPage({ ...page(), events: value }, 'page')
    const sparse = new Array(1)
    await badPage({ ...page(), events: sparse }, 'page')
    const inherited = new Array(1)
    Object.setPrototypeOf(
      inherited,
      Object.assign(Object.create(Array.prototype), { 0: event() }),
    )
    await badPage({ ...page(), events: inherited }, 'page')
    let count = 0
    const accessor = [event()]
    Object.defineProperty(accessor, '0', {
      get() {
        count++
        return event()
      },
    })
    await badPage({ ...page(), events: accessor }, 'page')
    expect(count).toBe(0)
  })
  it.each([1, 4])('accepts%s topic B256s', async (count) => {
    const source = page([
      {
        ...event(),
        topics: Array.from({ length: count }, (_, index) => hash(index)),
      },
    ])
    const f = fixture(source)
    expect(await requireHistory(f.actions)()).toEqual(expectedPage(source))
  })
  it('rejects zero/five/nonarray/sparse/inherited/malformed topics as event', async () => {
    for (const value of [
      [],
      Array(5).fill(hash(1)),
      null,
      false,
      {},
      ['0x1'],
      new Array(1),
    ])
      await badPage(page([{ ...event(), topics: value }]), 'event')
    const inherited = new Array(1)
    Object.setPrototypeOf(
      inherited,
      Object.assign(Object.create(Array.prototype), { 0: hash(1) }),
    )
    await badPage(page([{ ...event(), topics: inherited }]), 'event')
  })
  it.each([0, 65536])(
    'accepts exact even hex data%s-byte bound',
    async (bytes) => {
      const source = page([{ ...event(), data: `0x${'ab'.repeat(bytes)}` }])
      const f = fixture(source)
      expect(await requireHistory(f.actions)()).toEqual(expectedPage(source))
    },
  )
  it.each(
    ['0xa', '0xgg', 'ab', null, [], false, `0x${'ab'.repeat(65537)}`].map(
      (value) => ({ value }),
    ),
  )('refuses malformed/overbound data fixture', async ({ value }) => {
    await badPage(page([{ ...event(), data: value }]), 'event')
  })
})

describe('index identity/order/range/filter and continuation contracts', () => {
  it('accepts floor/anchor boundary hashes and multiple ordered events in one block', async () => {
    const source = page([
      event(1),
      event(5, 0, 0),
      event(5, 0, 1),
      event(5, 1, 0),
      event(10),
    ])
    const f = fixture(source)
    expect(
      await requireHistory(f.actions)({ fromBlock: 1n, toBlock: 10n }),
    ).toEqual(expectedPage(source))
  })
  it('compares same-height/floor/anchor hash bytes case-insensitively while retaining report spelling', async () => {
    const upper = `0x${'Ab'.repeat(32)}`
    const lower = upper.toLowerCase()
    const source = {
      ...page([
        { ...event(10, 0, 0), blockHash: lower },
        { ...event(10, 0, 1), blockHash: upper },
      ]),
      anchorBlockHash: upper,
      retentionFloorBlockNumber: 10,
      retentionFloorBlockHash: lower,
    }
    const f = fixture(source)
    expect(await requireHistory(f.actions)()).toEqual(expectedPage(source))
  })
  it('accepts future-from empty terminal report without synthesizing range/finality claims', async () => {
    const f = fixture(page([]))
    expect(await requireHistory(f.actions)({ fromBlock: 11n })).toEqual(
      expectedPage(page([])),
    )
  })
  it('rejects floor above anchor as page and equal-height differing valid hashes as identity', async () => {
    await badPage({ ...page([]), retentionFloorBlockNumber: 11 }, 'page')
    await badPage(
      {
        ...page([]),
        retentionFloorBlockNumber: 10,
        retentionFloorBlockHash: hash(99),
      },
      'identity',
    )
    const source = {
      ...page([]),
      retentionFloorBlockNumber: 10,
      retentionFloorBlockHash: hash(10),
    }
    const f = fixture(source)
    expect(await requireHistory(f.actions)()).toEqual(expectedPage(source))
  })
  it.each([
    { name: 'duplicate', rows: [event(), event()] },
    { name: 'log regression', rows: [event(5, 0, 1), event(5, 0, 0)] },
    { name: 'transaction regression', rows: [event(5, 1, 0), event(5, 0, 9)] },
    { name: 'height regression', rows: [event(6), event(5)] },
  ])('rejects strict key order $name as page', async ({ rows }) => {
    await badPage(page(rows), 'page')
  })
  it.each([
    {
      name: 'below retention floor',
      source: page([event(0)]),
      query: undefined,
    },
    { name: 'above anchor', source: page([event(11)]), query: undefined },
    { name: 'below explicit from', source: page(), query: { fromBlock: 6n } },
    { name: 'above explicit to', source: page(), query: { toBlock: 4n } },
    {
      name: 'wrong floor row hash',
      source: page([{ ...event(1), blockHash: hash(99) }]),
      query: undefined,
    },
    {
      name: 'wrong anchor row hash',
      source: page([{ ...event(10), blockHash: hash(99) }]),
      query: undefined,
    },
    {
      name: 'same-height hash disagreement',
      source: page([
        event(5, 0, 0),
        { ...event(5, 0, 1), blockHash: hash(99) },
      ]),
      query: undefined,
    },
    {
      name: 'resumed anchor height',
      source: { ...page(), anchorBlockNumber: 11 },
      query: { cursor: requestCursor() },
    },
    {
      name: 'resumed anchor hash',
      source: { ...page(), anchorBlockHash: hash(99) },
      query: { cursor: requestCursor() },
    },
    {
      name: 'resumed first equal cursor',
      source: page(),
      query: { cursor: requestCursor({ blockNumber: 5n }) },
    },
    {
      name: 'resumed first below cursor',
      source: page(),
      query: { cursor: requestCursor({ blockNumber: 6n }) },
    },
  ])(
    'refuses valid semantic contradiction $name as identity',
    async ({ source, query }) => {
      await badPage(source, 'identity', query)
    },
  )
  it.each(['grantId', 'campaignId', 'account'])(
    'enforces each %s filter independently with null/mismatch refusal',
    async (field) => {
      const filter =
        field === 'account' ? account : field === 'grantId' ? grant : campaign
      const row = { ...event(), [field]: filter }
      const source = page([row])
      const f = fixture(source)
      expect(await requireHistory(f.actions)({ [field]: filter })).toEqual(
        expectedPage(source),
      )
      await badPage(page([{ ...row, [field]: null }]), 'identity', {
        [field]: filter,
      })
      await badPage(
        page([
          { ...row, [field]: field === 'account' ? otherAccount : hash(99) },
        ]),
        'identity',
        { [field]: filter },
      )
    },
  )
  it('accepts mixed-case byte identities and enforces conjunctive filters', async () => {
    const g = `0x${'Ab'.repeat(32)}`
    const c = `0x${'Cd'.repeat(32)}`
    const a = `0x${'Ab'.repeat(20)}`
    const source = page([
      {
        ...event(),
        grantId: g.toLowerCase(),
        campaignId: c.toLowerCase(),
        account: a.toLowerCase(),
        blockHash: `0x${'Ef'.repeat(32)}`,
      },
    ])
    const query = { grantId: g, campaignId: c, account: a }
    const f = fixture(source)
    expect(await requireHistory(f.actions)(query)).toEqual(expectedPage(source))
    await badPage(
      page([{ ...source.events[0], campaignId: hash(99) }]),
      'identity',
      query,
    )
    const anchor = `0x${'Ab'.repeat(32)}`
    const anchored = { ...page([]), anchorBlockHash: anchor.toLowerCase() }
    const resumed = fixture(anchored)
    expect(
      await requireHistory(resumed.actions)({
        cursor: requestCursor({ anchorBlockHash: anchor }),
      }),
    ).toEqual(expectedPage(anchored))
  })
  it('accepts advanced retained floor at unchanged resumed anchor', async () => {
    const source = {
      ...page([event(6)]),
      retentionFloorBlockNumber: 5,
      retentionFloorBlockHash: hash(5),
    }
    const f = fixture(source)
    expect(
      await requireHistory(f.actions)({
        cursor: requestCursor({ blockNumber: 5n }),
      }),
    ).toEqual(expectedPage(source))
  })
  it('returns two manual contiguous source-shaped pages with a fixed retained anchor, then terminal null', async () => {
    const first = { ...page([event(5)]), next: nextCursor(event(5)) }
    const second = page([event(6)])
    const requests: Request[] = []
    let count = 0
    const base = createPublicClient({
      transport: custom(
        {
          request: async (request) => {
            requests.push(jsonBoundary(request))
            return jsonBoundary(count++ === 0 ? first : second)
          },
        },
        { retryCount: 0 },
      ),
    })
    const read = requireHistory(
      base.extend(patronageActions) as unknown as HistoryMethods,
    )
    const one = await read({
      fromBlock: 1n,
      toBlock: 10n,
      grantId: grant,
      limit: 1,
    })
    expect(count).toBe(1)
    expect(one).toEqual(expectedPage(first))
    const two = await read({
      fromBlock: 1n,
      toBlock: 10n,
      grantId: grant,
      cursor: one.next,
      limit: 1,
    })
    expect(two).toEqual(expectedPage(second))
    expect(two.next).toBeNull()
    expect(count).toBe(2)
    expect(requests).toEqual([
      {
        method: 'diesis_getPatronHistory',
        params: [{ fromBlock: 1, toBlock: 10, grantId: grant, limit: 1 }],
      },
      {
        method: 'diesis_getPatronHistory',
        params: [
          {
            fromBlock: 1,
            toBlock: 10,
            grantId: grant,
            cursor: {
              anchorBlockNumber: 10,
              anchorBlockHash: hash(10),
              blockNumber: 5,
              transactionIndex: 0,
              logIndex: 0,
            },
            limit: 1,
          },
        ],
      },
    ])
  })
  it('accepts fixed-anchor history after linear extension without automatically reanchoring', async () => {
    const source = page([event(6)])
    const f = fixture(source)
    expect(
      await requireHistory(f.actions)({
        toBlock: 11n,
        cursor: requestCursor({ blockNumber: 5n }),
      }),
    ).toEqual(expectedPage(source))
    expect(f.requests).toHaveLength(1)
  })
  it('accepts a full final next:null page and synthesizes no continuation', async () => {
    const f = fixture(page())
    const result = await requireHistory(f.actions)({ limit: 1 })
    expect(result.next).toBeNull()
    expect(f.requests).toHaveLength(1)
  })
  it.each([
    {
      name: 'empty next',
      source: { ...page([]), next: nextCursor() },
      query: { limit: 1 },
    },
    {
      name: 'partial next',
      source: { ...page(), next: nextCursor() },
      query: { limit: 2 },
    },
    {
      name: 'wrong next anchor height',
      source: {
        ...page(),
        next: nextCursor(event(), { anchorBlockNumber: 11 }),
      },
      query: { limit: 1 },
    },
    {
      name: 'wrong next anchor hash',
      source: {
        ...page(),
        next: nextCursor(event(), { anchorBlockHash: hash(99) }),
      },
      query: { limit: 1 },
    },
    {
      name: 'wrong last height',
      source: { ...page(), next: nextCursor(event(), { blockNumber: 6 }) },
      query: { limit: 1 },
    },
    {
      name: 'wrong last transaction',
      source: { ...page(), next: nextCursor(event(), { transactionIndex: 1 }) },
      query: { limit: 1 },
    },
    {
      name: 'wrong last log',
      source: { ...page(), next: nextCursor(event(), { logIndex: 1 }) },
      query: { limit: 1 },
    },
    {
      name: 'empty resumed nonadvance',
      source: { ...page([]), next: nextCursor(event(4)) },
      query: { limit: 1, cursor: requestCursor() },
    },
  ])(
    'rejects isolated continuation contradiction $name',
    async ({ source, query }) => {
      await badPage(source, 'continuation', query)
    },
  )
  it('classifies nonempty resumed first<=cursor and matching last<=cursor as identity, not continuation', async () => {
    await badPage({ ...page(), next: nextCursor() }, 'identity', {
      limit: 1,
      cursor: requestCursor({ blockNumber: 5n }),
    })
  })
})

describe('response ordered phase precedence, source-index errors and no fallback', () => {
  it('missing page field wins over unsafe event integer', async () => {
    const value = page([{ ...event(), blockNumber: maxSafe + 1 }])
    delete value.anchorBlockHash
    await badPage(value, 'page')
  })
  it('missing event field wins over unsafe page integer', async () => {
    const row = event()
    delete row.kind
    await badPage({ ...page([row]), anchorBlockNumber: maxSafe + 1 }, 'event')
  })
  it('malformed next shape wins over unsafe page integer', async () => {
    await badPage(
      { ...page(), anchorBlockNumber: maxSafe + 1, next: {} },
      'continuation',
      { limit: 1 },
    )
  })
  it('unsafe next ordinal wins over a valid contradictory next anchor', async () => {
    await badPage(
      {
        ...page(),
        next: nextCursor(event(), {
          logIndex: u32Max + 1,
          anchorBlockHash: hash(99),
        }),
      },
      'integer',
      { limit: 1 },
    )
  })
  it('topics structural fault wins over unsafe page integer', async () => {
    await badPage(
      { ...page([{ ...event(), topics: [] }]), anchorBlockNumber: maxSafe + 1 },
      'event',
    )
  })
  it('present integer wins before malformed scalar and semantic order', async () => {
    await badPage(
      page([{ ...event(), logIndex: NaN, kind: 'unknown' }]),
      'integer',
    )
    await badPage(
      { ...page([event(), event()]), anchorBlockNumber: NaN },
      'integer',
    )
  })
  it('malformed event scalar wins over floor/hash/continuation contradictions', async () => {
    await badPage(
      {
        ...page([{ ...event(), kind: 'unknown' }]),
        retentionFloorBlockNumber: 11,
        next: nextCursor(event(), { anchorBlockHash: hash(99) }),
      },
      'event',
      { limit: 1 },
    )
  })
  it('page order wins over valid identity contradiction and continuation', async () => {
    await badPage(
      {
        ...page([event(), event()]),
        next: nextCursor(event(), { anchorBlockHash: hash(99) }),
      },
      'page',
      { limit: 2, grantId: hash(99) },
    )
  })
  it('identity contradiction wins over independent valid next binding fault', async () => {
    await badPage(
      { ...page(), next: nextCursor(event(), { logIndex: 1 }) },
      'identity',
      { limit: 1, grantId: hash(99) },
    )
  })
  it.each([
    {
      name: 'unconfigured index',
      message: 'Patron history reader is not configured',
    },
    { name: 'unavailable index', message: 'Patron history index unavailable' },
    {
      name: 'retained anchor membership',
      message: 'Patron history cursor anchor is no longer retained',
    },
    {
      name: 'fixed4096 scan/lookahead cap',
      message: 'Patron history scan budget exceeded',
    },
  ])(
    'propagates real viem native-shaped -32603 $name once without fallback',
    async ({ message }) => {
      const requests: Request[] = []
      const nativeError = { code: -32603, message }
      const base = createPublicClient({
        transport: custom(
          {
            request: async (request) => {
              requests.push(jsonBoundary(request))
              throw nativeError
            },
          },
          { retryCount: 0 },
        ),
      })
      const read = requireHistory(
        base.extend(patronageActions) as unknown as HistoryMethods,
      )
      let failure: unknown
      try {
        await read()
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(InternalRpcError)
      expect((failure as InternalRpcError).code).toBe(-32603)
      expect((failure as Error).message).toContain(message)
      expect((failure as InternalRpcError).cause).toBe(nativeError)
      expect(requests).toEqual([
        { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
      ])
    },
  )
  it('propagates direct request sentinel identity and permits only a later manual narrower query', async () => {
    const sentinel = new Error(
      'synthetic source-shaped scan-cap failure, not a live receipt',
    )
    const requests: Request[] = []
    let fail = true
    const actions = patronageActions({
      request: async (request: Request) => {
        requests.push(request)
        if (fail) throw sentinel
        return page([])
      },
    } as never) as unknown as HistoryMethods
    const read = requireHistory(actions)
    await expect(read({ fromBlock: 1n, toBlock: 10000n })).rejects.toBe(
      sentinel,
    )
    expect(requests).toHaveLength(1)
    fail = false
    expect(await read({ fromBlock: 1n, toBlock: 2n })).toEqual(
      expectedPage(page([])),
    )
    expect(requests).toEqual([
      {
        method: 'diesis_getPatronHistory',
        params: [{ fromBlock: 1, toBlock: 10000, limit: 0 }],
      },
      {
        method: 'diesis_getPatronHistory',
        params: [{ fromBlock: 1, toBlock: 2, limit: 0 }],
      },
    ])
  })
})
