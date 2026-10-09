import { describe, expect, it } from 'vitest'
import { createPublicClient, custom, InternalRpcError, type Hex } from 'viem'
import {
  diesisPublicActions,
  patronageActions as rootPatronageActions,
} from '../src/index.js'
import { patronageActions, type GasGrant } from '../src/patronage/index.js'

// Source-derived fixtures, not running-node captures or deployment evidence.
// Frozen native44bed gas_grants.rs GrantInfo has required fields and U256 hex.
// Missing storage slots can read as zero: success proves no existence/readiness.
type Request = { method: string; params?: unknown }
type GrantMethods = {
  getGrant: (params: { grantId: Hex }) => Promise<GasGrant>
  getGrants: (params: { grantIds: readonly Hex[] }) => Promise<GasGrant[]>
}
type WireGrant = {
  grantId: Hex
  balance: string
  totalContributed: string
  totalSpent: string
  paused: boolean
}
const id = (number: number): Hex => `0x${number.toString(16).padStart(64, '0')}`
const first = id(1)
const second = id(2)
const third = id(3)
const maximum = `0x${'f'.repeat(64)}`
const maxUint256 = (1n << 256n) - 1n
const quantityFields = ['balance', 'totalContributed', 'totalSpent'] as const

function row(grantId = first): WireGrant {
  return {
    grantId,
    balance: '0x20000000000001',
    totalContributed: maximum,
    totalSpent: '0x0',
    paused: false,
  }
}
function decoded(value: WireGrant): GasGrant {
  return {
    grantId: value.grantId,
    balance: BigInt(value.balance),
    totalContributed: BigInt(value.totalContributed),
    totalSpent: BigInt(value.totalSpent),
    paused: value.paused,
  }
}
function jsonBoundary(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}
function fixture(response: unknown, mode: 'leaf' | 'public' = 'leaf') {
  const requests: Request[] = []
  const base = createPublicClient({
    transport: custom(
      {
        request: async (request) => {
          requests.push(request)
          return jsonBoundary(response)
        },
      },
      { retryCount: 0 },
    ),
  })
  const client =
    mode === 'public'
      ? base.extend(diesisPublicActions)
      : base.extend(patronageActions)
  // The new method's absence is asserted at runtime, never skipped or imported
  // from a nonexistent module. Public declaration proof is a separate gate.
  return { actions: client as unknown as GrantMethods, requests }
}
function direct(response: unknown) {
  const requests: Request[] = []
  const actions = patronageActions({
    request: async (request: Request) => {
      requests.push(request)
      return response
    },
  } as never) as unknown as GrantMethods
  return { actions, requests }
}
function requireBatch(actions: GrantMethods): GrantMethods['getGrants'] {
  // On old ac14, this deliberate API assertion fails before a call can crash.
  expect(typeof actions.getGrants).toBe('function')
  return actions.getGrants
}
async function validationRejection(
  pending: Promise<unknown> | undefined,
  category: RegExp,
) {
  expect(pending).toBeInstanceOf(Promise)
  let rejected = false
  let failure: unknown
  await pending!.then(
    () => {},
    (error: unknown) => {
      rejected = true
      failure = error
    },
  )
  expect(rejected).toBe(true)
  expect(failure).toBeInstanceOf(Error)
  // An asynchronous engine dereference is not the chosen validation refusal.
  // This applies to every bad input and every malformed response category.
  expect(failure).not.toBeInstanceOf(TypeError)
  expect((failure as Error).message).toMatch(category)
}
async function badInput(
  call: () => Promise<unknown>,
  requests: Request[],
  category: RegExp,
) {
  let pending: Promise<unknown> | undefined
  // Old null/no-params access is a classified async-preflight RED here, not an
  // uncaught TypeError in test setup. Every future invalid input must be async.
  expect(() => {
    pending = call()
  }).not.toThrow()
  expect(pending).toBeInstanceOf(Promise)
  await validationRejection(pending, category)
  expect(requests).toEqual([])
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('source root/subpath grant RPC contract, native44bed', () => {
  it('retains actual decorator exports and exposes both public read methods', () => {
    expect(rootPatronageActions).toBe(patronageActions)
    for (const mode of ['leaf', 'public'] as const) {
      const { actions, requests } = fixture(row(), mode)
      expect(typeof actions.getGrant).toBe('function')
      requireBatch(actions)
      expect(requests).toEqual([])
    }
  })

  it.each(['leaf', 'public'] as const)(
    '%s decodes three U256 fields without safe-integer precision loss',
    async (mode) => {
      const { actions, requests } = fixture(row(), mode)
      expect(await actions.getGrant({ grantId: first })).toEqual({
        grantId: first,
        balance: 9007199254740993n,
        totalContributed: maxUint256,
        totalSpent: 0n,
        paused: false,
      })
      expect(requests).toEqual([{ method: 'diesis_getGrant', params: [first] }])
    },
  )

  it.each([false, true])(
    'accepts valid zero observations with paused=%s',
    async (paused) => {
      const zero = {
        ...row(),
        balance: '0x0',
        totalContributed: '0x0',
        totalSpent: '0x0',
        paused,
      }
      const { actions } = fixture(zero)
      const result = await actions.getGrant({ grantId: first })
      expect(result).toEqual(decoded(zero))
      expect(Object.keys(result).sort()).toEqual(
        [
          'grantId',
          'balance',
          'totalContributed',
          'totalSpent',
          'paused',
        ].sort(),
      )
      // Neither zero nor a nonzero success licenses invented authority fields.
      for (const field of [
        'exists',
        'grantExists',
        'deployed',
        'ready',
        'eligible',
      ])
        expect(field in result).toBe(false)
    },
  )

  it('binds B256 identity by bytes while preserving valid response spelling', async () => {
    const supplied = `0x${'Ab'.repeat(32)}` as Hex
    const response = row(`0x${'ab'.repeat(32)}`)
    const { actions, requests } = fixture(response)
    expect(await actions.getGrant({ grantId: supplied })).toEqual(
      decoded(response),
    )
    expect(requests).toEqual([
      { method: 'diesis_getGrant', params: [supplied] },
    ])
  })

  it('projects fresh known fields and does not invent bookkeeping invariants', async () => {
    const response = {
      ...row(),
      balance: '0x1',
      totalContributed: '0x2',
      totalSpent: '0x4',
      blockNumber: 99,
      exists: true,
      eligibility: 'invented-extension',
    }
    const { actions } = direct(response)
    const result = await actions.getGrant({ grantId: first })
    expect(result).toEqual(decoded(response))
    expect(result).not.toBe(response)
    expect(response.balance).toBe('0x1')
    expect(Object.keys(result).sort()).toEqual(Object.keys(row()).sort())
  })

  it('snapshots the single requested identity before awaiting transport', async () => {
    const gate = deferred<unknown>()
    const requests: Request[] = []
    const actions = patronageActions({
      request: async (request: Request) => {
        requests.push(request)
        return gate.promise
      },
    } as never)
    const params = { grantId: first }
    const pending = actions.getGrant(params)
    params.grantId = second
    gate.resolve(jsonBoundary(row(first)))
    await expect(pending).resolves.toEqual(decoded(row(first)))
    expect(requests).toEqual([{ method: 'diesis_getGrant', params: [first] }])
  })
})

const singleInputs = [
  { name: 'null params', value: null, category: /^Invalid grant query$/ },
  {
    name: 'undefined params',
    value: undefined,
    category: /^Invalid grant query$/,
  },
  { name: 'array params', value: [first], category: /^Invalid grant query$/ },
  { name: 'string params', value: first, category: /^Invalid grant query$/ },
  { name: 'missing ID', value: {}, category: /^Invalid grantId$/ },
  { name: 'numeric ID', value: { grantId: 1 }, category: /^Invalid grantId$/ },
  { name: 'null ID', value: { grantId: null }, category: /^Invalid grantId$/ },
  {
    name: 'short ID',
    value: { grantId: '0x11' },
    category: /^Invalid grantId$/,
  },
  {
    name: 'odd ID',
    value: { grantId: `0x${'1'.repeat(63)}` },
    category: /^Invalid grantId$/,
  },
  {
    name: 'nonhex ID',
    value: { grantId: `0x${'z'.repeat(64)}` },
    category: /^Invalid grantId$/,
  },
  {
    name: 'unknown query field',
    value: { grantId: first, extra: 1 },
    category: /^Invalid grant query$/,
  },
]
describe('asynchronous grant input preflight', () => {
  it.each(singleInputs)(
    '$name rejects as a promise without I/O',
    async ({ value, category }) => {
      const { actions, requests } = fixture(row())
      await badInput(() => actions.getGrant(value as never), requests, category)
    },
  )

  const sparseIds = new Array<Hex>(2)
  sparseIds[0] = first
  const mixed = `0x${'Ab'.repeat(32)}` as Hex
  const batchInputs = [
    { name: 'null', value: null, category: /^Invalid grant query$/ },
    { name: 'undefined', value: undefined, category: /^Invalid grant query$/ },
    {
      name: 'array params',
      value: [[first]],
      category: /^Invalid grant query$/,
    },
    { name: 'missing IDs', value: {}, category: /^Invalid grantIds$/ },
    {
      name: 'nonarray IDs',
      value: { grantIds: first },
      category: /^Invalid grantIds$/,
    },
    { name: 'empty', value: { grantIds: [] }, category: /^Invalid grantIds$/ },
    {
      name: '65 distinct IDs',
      value: { grantIds: Array.from({ length: 65 }, (_, i) => id(i + 1)) },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'sparse',
      value: { grantIds: sparseIds },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'numeric ID',
      value: { grantIds: [1] },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'null ID',
      value: { grantIds: [null] },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'bigint ID',
      value: { grantIds: [1n] },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'short ID',
      value: { grantIds: ['0x11'] },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'nonhex ID',
      value: { grantIds: [`0x${'z'.repeat(64)}`] },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'same hash twice',
      value: { grantIds: [first, first] },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'case duplicate',
      value: { grantIds: [mixed, mixed.toLowerCase()] },
      category: /^Invalid grantIds$/,
    },
    {
      name: 'unknown field',
      value: { grantIds: [first], cursor: 1 },
      category: /^Invalid grant query$/,
    },
  ]
  it.each(batchInputs)(
    'batch $name rejects as a promise without I/O',
    async ({ value, category }) => {
      const { actions, requests } = fixture([row()])
      const getGrants = requireBatch(actions)
      await badInput(() => getGrants(value as never), requests, category)
    },
  )
})

describe('strict grant response schema and quantities', () => {
  it.each([
    { name: 'null', value: null },
    { name: 'array', value: [row()] },
    { name: 'number', value: 0 },
    { name: 'string', value: first },
  ])('refuses $name GrantInfo', async ({ value }) => {
    const { actions, requests } = fixture(value)
    await validationRejection(
      actions.getGrant({ grantId: first }),
      /^Invalid grant response$/,
    )
    expect(requests).toEqual([{ method: 'diesis_getGrant', params: [first] }])
  })

  it.each(Object.keys(row()))('requires own present %s', async (field) => {
    const value: Record<string, unknown> = { ...row() }
    delete value[field]
    await validationRejection(
      fixture(value).actions.getGrant({ grantId: first }),
      /^Invalid grant response$/,
    )
    // An inherited required field is not an actual decoded JSON field.
    const inherited = Object.assign(
      Object.create({ [field]: row()[field as keyof WireGrant] }),
      value,
    )
    await validationRejection(
      direct(inherited).actions.getGrant({ grantId: first }),
      /^Invalid grant response$/,
    )
  })

  it.each(['false', 0, 1, null, undefined])(
    'refuses nonboolean paused=%s',
    async (paused) => {
      await validationRejection(
        direct({ ...row(), paused }).actions.getGrant({ grantId: first }),
        /^Invalid grant response$/,
      )
    },
  )
  it.each([
    {
      name: 'different valid identity',
      grantId: second,
      category: /^Invalid grant identity$/,
    },
    {
      name: 'short identity',
      grantId: '0x11',
      category: /^Invalid grant response$/,
    },
    {
      name: 'nonhex identity',
      grantId: `0x${'z'.repeat(64)}`,
      category: /^Invalid grant response$/,
    },
    {
      name: 'numeric identity',
      grantId: 1,
      category: /^Invalid grant response$/,
    },
  ])('refuses $name', async ({ grantId, category }) => {
    await validationRejection(
      fixture({ ...row(), grantId }).actions.getGrant({ grantId: first }),
      category,
    )
  })

  const malformedQuantities = [
    { name: 'safe JSON number', value: 1 },
    { name: 'unsafe JSON number', value: Number.MAX_SAFE_INTEGER + 1 },
    { name: 'decimal', value: '1' },
    { name: 'negative', value: '-1' },
    { name: 'negative hex', value: '-0x1' },
    { name: 'upper digit', value: '0xA' },
    { name: 'upper prefix', value: '0X1' },
    { name: 'padded zero', value: '0x00' },
    { name: 'padded nonzero', value: '0x01' },
    { name: 'empty', value: '0x' },
    { name: 'whitespace', value: ' 0x1' },
    { name: 'fraction', value: '0x1.1' },
    { name: 'uint256 overflow', value: `0x1${'0'.repeat(64)}` },
    { name: '65 digits', value: `0x${'f'.repeat(65)}` },
    { name: 'null', value: null },
    { name: 'boolean', value: false },
  ]
  for (const field of quantityFields) {
    it.each(malformedQuantities)(
      `${field} refuses $name`,
      async ({ value }) => {
        const malformed = { ...row(), [field]: value }
        await validationRejection(
          fixture(malformed).actions.getGrant({ grantId: first }),
          /^Invalid uint256 quantity$/,
        )
        for (const valid of ['0x0', '0x1', maximum]) {
          const control = { ...row(), [field]: valid }
          expect(
            await fixture(control).actions.getGrant({ grantId: first }),
          ).toEqual(decoded(control))
        }
      },
    )
    it(`${field} refuses raw bigint from a direct request double`, async () => {
      await validationRejection(
        direct({ ...row(), [field]: 1n }).actions.getGrant({ grantId: first }),
        /^Invalid uint256 quantity$/,
      )
      expect(await direct(row()).actions.getGrant({ grantId: first })).toEqual(
        decoded(row()),
      )
    })
  }
})

describe('bounded batch grant read', () => {
  it.each([1, 64])(
    'reads %s unique IDs in exactly one native batch request',
    async (count) => {
      const ids = Array.from({ length: count }, (_, i) => id(count - i))
      const rows = ids.map((grantId, i) => ({
        ...row(grantId),
        paused: i % 2 === 1,
      }))
      const { actions, requests } = fixture(rows, 'public')
      const getGrants = requireBatch(actions)
      expect(await getGrants({ grantIds: ids })).toEqual(rows.map(decoded))
      expect(requests).toEqual([
        { method: 'diesis_getGrants', params: [{ grantIds: ids }] },
      ])
    },
  )

  it('accepts a zero-valued batch without adding existence or readiness metadata', async () => {
    const rows = [first, second].map((grantId) => ({
      ...row(grantId),
      balance: '0x0',
      totalContributed: '0x0',
      totalSpent: '0x0',
    }))
    const { actions, requests } = fixture(rows)
    const result = await requireBatch(actions)({ grantIds: [first, second] })
    expect(result).toEqual(rows.map(decoded))
    for (const grant of result)
      expect(Object.keys(grant).sort()).toEqual(Object.keys(row()).sort())
    expect(requests).toEqual([
      { method: 'diesis_getGrants', params: [{ grantIds: [first, second] }] },
    ])
  })

  it('accepts matching mixed-case batch identities in requested order', async () => {
    const supplied = `0x${'Ab'.repeat(32)}` as Hex
    const rows = [row(second), row(supplied.toLowerCase() as Hex)]
    const { actions, requests } = fixture(rows)
    expect(
      await requireBatch(actions)({ grantIds: [second, supplied] }),
    ).toEqual(rows.map(decoded))
    expect(requests).toEqual([
      {
        method: 'diesis_getGrants',
        params: [{ grantIds: [second, supplied] }],
      },
    ])
  })

  it('copies batch IDs before await rather than binding to caller mutations', async () => {
    const gate = deferred<unknown>()
    const requests: Request[] = []
    const base = createPublicClient({
      transport: custom(
        {
          request: async (request) => {
            requests.push(request)
            return gate.promise
          },
        },
        { retryCount: 0 },
      ),
    }).extend(patronageActions) as unknown as GrantMethods
    const ids = [second, first]
    const pending = requireBatch(base)({ grantIds: ids })
    ids.reverse()
    ids.push(third)
    gate.resolve(jsonBoundary([row(second), row(first)]))
    await expect(pending).resolves.toEqual([
      decoded(row(second)),
      decoded(row(first)),
    ])
    expect(requests).toEqual([
      { method: 'diesis_getGrants', params: [{ grantIds: [second, first] }] },
    ])
    expect((requests[0].params as [{ grantIds: Hex[] }])[0].grantIds).not.toBe(
      ids,
    )
  })

  const sparseRows = new Array<WireGrant>(2)
  sparseRows[0] = row(first)
  const failures = [
    {
      name: 'null',
      response: null,
      category: /^Invalid grant (?:batch )?response$/,
    },
    {
      name: 'object',
      response: row(),
      category: /^Invalid grant (?:batch )?response$/,
    },
    {
      name: 'empty',
      response: [],
      category: /^Invalid grant (?:batch )?response$/,
    },
    {
      name: 'missing row',
      response: [row(first)],
      category: /^Invalid grant (?:batch )?response$/,
    },
    {
      name: 'surplus row',
      response: [row(first), row(second), row(third)],
      category: /^Invalid grant (?:batch )?response$/,
    },
    {
      name: 'shuffled rows',
      response: [row(second), row(first)],
      category: /^Invalid grant identity$/,
    },
    {
      name: 'duplicate row',
      response: [row(first), row(first)],
      category: /^Invalid grant identity$/,
    },
    {
      name: 'substituted row',
      response: [row(first), row(third)],
      category: /^Invalid grant identity$/,
    },
    {
      name: 'malformed last row',
      response: [row(first), { ...row(second), balance: '0x01' }],
      category: /^Invalid uint256 quantity$/,
    },
    {
      name: 'null last row',
      response: [row(first), null],
      category: /^Invalid grant response$/,
    },
  ]
  it.each(failures)(
    'rejects the whole batch for $name with no repair/fallback',
    async ({ response, category }) => {
      const { actions, requests } = fixture(response)
      await validationRejection(
        requireBatch(actions)({ grantIds: [first, second] }),
        category,
      )
      expect(requests).toEqual([
        { method: 'diesis_getGrants', params: [{ grantIds: [first, second] }] },
      ])
    },
  )
  it('rejects sparse direct response arrays rather than skipping a missing row', async () => {
    const { actions, requests } = direct(sparseRows)
    await validationRejection(
      requireBatch(actions)({ grantIds: [first, second] }),
      /^Invalid grant (?:batch )?response$/,
    )
    expect(requests).toEqual([
      { method: 'diesis_getGrants', params: [{ grantIds: [first, second] }] },
    ])
  })

  for (const field of quantityFields) {
    it.each([
      { name: 'JSON number', value: 1 },
      { name: 'decimal', value: '1' },
      { name: 'padded quantity', value: '0x01' },
      { name: 'uppercase', value: '0xA' },
      { name: 'null', value: null },
      { name: 'overflow', value: `0x1${'0'.repeat(64)}` },
    ])(
      `batch last-row ${field} rejects $name as a whole response`,
      async ({ value }) => {
        const { actions, requests } = fixture([
          row(first),
          { ...row(second), [field]: value },
        ])
        await validationRejection(
          requireBatch(actions)({ grantIds: [first, second] }),
          /^Invalid uint256 quantity$/,
        )
        expect(requests).toEqual([
          {
            method: 'diesis_getGrants',
            params: [{ grantIds: [first, second] }],
          },
        ])
        const control = fixture([row(first), row(second)])
        expect(
          await requireBatch(control.actions)({ grantIds: [first, second] }),
        ).toEqual([decoded(row(first)), decoded(row(second))])
      },
    )
    it(`batch last-row ${field} refuses a direct raw bigint`, async () => {
      const { actions, requests } = direct([
        row(first),
        { ...row(second), [field]: 1n },
      ])
      await validationRejection(
        requireBatch(actions)({ grantIds: [first, second] }),
        /^Invalid uint256 quantity$/,
      )
      expect(requests).toEqual([
        { method: 'diesis_getGrants', params: [{ grantIds: [first, second] }] },
      ])
    })
  }
  it.each(Object.keys(row()))(
    'batch last-row requires own present %s',
    async (field) => {
      const value: Record<string, unknown> = { ...row(second) }
      delete value[field]
      const { actions, requests } = fixture([row(first), value])
      await validationRejection(
        requireBatch(actions)({ grantIds: [first, second] }),
        /^Invalid grant response$/,
      )
      expect(requests).toEqual([
        { method: 'diesis_getGrants', params: [{ grantIds: [first, second] }] },
      ])
    },
  )
  it('batch projects fresh rows and preserves source inputs/additive-property tolerance', async () => {
    const rows = [
      { ...row(first), exists: true },
      { ...row(second), anchor: 'not-a-native-grant-field' },
    ]
    const { actions } = direct(rows)
    const result = await requireBatch(actions)({ grantIds: [first, second] })
    expect(result).toEqual(rows.map(decoded))
    expect(result).not.toBe(rows)
    for (const [index, grant] of result.entries()) {
      expect(grant).not.toBe(rows[index])
      expect(Object.keys(grant).sort()).toEqual(Object.keys(row()).sort())
      expect(rows[index].balance).toBe('0x20000000000001')
    }
  })
})

describe('native refusal and direct error identity remain distinct', () => {
  it.each(['single', 'batch'] as const)(
    '%s native -32603 refusal makes one attempt without synthetic result',
    async (kind) => {
      const requests: Request[] = []
      const message =
        kind === 'single'
          ? `state provider unavailable for gas grant ${first}`
          : 'state provider unavailable for pinned gas grant batch'
      // Frozen helpers.rs -> jsonrpsee-types0.26 INTERNAL_ERROR_CODE=-32603.
      const nativeError = { code: -32603, message }
      const actions = createPublicClient({
        transport: custom(
          {
            request: async (request) => {
              requests.push(request)
              throw nativeError
            },
          },
          { retryCount: 0 },
        ),
      }).extend(diesisPublicActions) as unknown as GrantMethods
      const pending =
        kind === 'single'
          ? actions.getGrant({ grantId: first })
          : requireBatch(actions)({ grantIds: [first, second] })
      const error = await pending.catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(InternalRpcError)
      expect((error as InternalRpcError).code).toBe(-32603)
      expect((error as InternalRpcError).message).toContain(message)
      expect((error as InternalRpcError).cause).toBe(nativeError)
      expect(requests).toEqual([
        kind === 'single'
          ? { method: 'diesis_getGrant', params: [first] }
          : {
              method: 'diesis_getGrants',
              params: [{ grantIds: [first, second] }],
            },
      ])
    },
  )

  it.each(['single', 'batch'] as const)(
    '%s direct request preserves sentinel identity without retry',
    async (kind) => {
      const sentinel = new Error('direct provider sentinel')
      const requests: Request[] = []
      const actions = patronageActions({
        request: async (request: Request) => {
          requests.push(request)
          throw sentinel
        },
      } as never) as unknown as GrantMethods
      const pending =
        kind === 'single'
          ? actions.getGrant({ grantId: first })
          : requireBatch(actions)({ grantIds: [first, second] })
      await expect(pending).rejects.toBe(sentinel)
      expect(requests).toEqual([
        kind === 'single'
          ? { method: 'diesis_getGrant', params: [first] }
          : {
              method: 'diesis_getGrants',
              params: [{ grantIds: [first, second] }],
            },
      ])
    },
  )
})
