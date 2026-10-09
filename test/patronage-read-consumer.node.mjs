import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createPublicClient, custom, InternalRpcError } from 'viem'
import * as root from '@diesis/sdk'
import * as patronage from '@diesis/sdk/patronage'

const exec = promisify(execFile)
const require = createRequire(import.meta.url)
const sdkRoot = fileURLToPath(new URL('../', import.meta.url))
const first = `0x${'01'.padStart(64, '0')}`
const second = `0x${'02'.padStart(64, '0')}`
const maximum = `0x${'f'.repeat(64)}`
const maxUint256 = (1n << 256n) - 1n
const quantityFields = ['balance', 'totalContributed', 'totalSpent']
const entries = [
  { name: 'root public extension', decorator: root.diesisPublicActions },
  { name: 'patronage subpath', decorator: patronage.patronageActions },
]

// Handwritten native44bed DTO fixtures, not running-node captures. A valid
// zero observation proves neither contract/grant existence nor readiness.
function wire(grantId = first) {
  return {
    grantId,
    balance: '0x20000000000001',
    totalContributed: maximum,
    totalSpent: '0x0',
    paused: false,
  }
}

function decoded(value) {
  return {
    grantId: value.grantId,
    balance: BigInt(value.balance),
    totalContributed: BigInt(value.totalContributed),
    totalSpent: BigInt(value.totalSpent),
    paused: value.paused,
  }
}

function fixture(decorator, response, refusal) {
  const requests = []
  const client = createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }) => {
          requests.push({ method, params })
          if (refusal) throw refusal
          return JSON.parse(JSON.stringify(response))
        },
      },
      { retryCount: 0 },
    ),
  }).extend(decorator)
  return { client, requests }
}

function batch(client, grantIds) {
  // Deliberate missing-API assertion rather than a skip or setup TypeError.
  assert.equal(typeof client.getGrants, 'function')
  return client.getGrants({ grantIds })
}

async function semanticRejection(pending, category) {
  assert.ok(pending instanceof Promise, 'validation returns a Promise')
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof Error, 'semantic rejection is an Error')
    assert.ok(
      !(error instanceof TypeError),
      'engine TypeError is not validation',
    )
    assert.match(error.message, category)
    return true
  })
}

test('built root and patronage entry points share the actual decorator', () => {
  assert.equal(root.patronageActions, patronage.patronageActions)
  assert.equal(typeof root.diesisPublicActions, 'function')
  assert.equal(typeof patronage.patronageActions, 'function')
})

for (const { name, decorator } of entries) {
  test(`${name}: built single read decodes all three quantities without precision loss`, async () => {
    const response = { ...wire(), ignoredAuthority: 'not a native field' }
    const { client, requests } = fixture(decorator, response)
    const result = await client.getGrant({ grantId: first })
    assert.deepEqual(result, decoded(response))
    for (const field of quantityFields)
      assert.equal(typeof result[field], 'bigint')
    assert.equal(result.balance, 9007199254740993n)
    assert.equal(result.totalContributed, maxUint256)
    assert.equal(result.totalSpent, 0n)
    assert.equal(result.paused, false)
    assert.deepEqual(requests, [{ method: 'diesis_getGrant', params: [first] }])

    const zero = {
      ...wire(),
      balance: '0x0',
      totalContributed: '0x0',
      paused: true,
    }
    const control = fixture(decorator, zero)
    assert.deepEqual(
      await control.client.getGrant({ grantId: first }),
      decoded(zero),
    )
    assert.deepEqual(control.requests, [
      { method: 'diesis_getGrant', params: [first] },
    ])
  })

  test(`${name}: built batch preserves requested order and sends one batch RPC`, async () => {
    const rows = [wire(second), { ...wire(first), paused: true }]
    const { client, requests } = fixture(decorator, rows)
    assert.deepEqual(await batch(client, [second, first]), rows.map(decoded))
    assert.deepEqual(requests, [
      { method: 'diesis_getGrants', params: [{ grantIds: [second, first] }] },
    ])
  })

  test(`${name}: built single refuses malformed JSON rows with semantic errors`, async (t) => {
    const cases = [
      { label: 'null', value: null, category: /^Invalid grant response$/ },
      { label: 'array', value: [], category: /^Invalid grant response$/ },
      { label: 'primitive', value: 1, category: /^Invalid grant response$/ },
      {
        label: 'wrong identity',
        value: wire(second),
        category: /^Invalid grant identity$/,
      },
      {
        label: 'malformed identity',
        value: { ...wire(), grantId: '0x01' },
        category: /^Invalid grant response$/,
      },
      {
        label: 'paused string',
        value: { ...wire(), paused: 'false' },
        category: /^Invalid grant response$/,
      },
      ...Object.keys(wire()).map((field) => {
        const value = { ...wire() }
        delete value[field]
        return {
          label: `missing ${field}`,
          value,
          category: /^Invalid grant response$/,
        }
      }),
      ...quantityFields.flatMap((field) =>
        [1, null, '1', '0x01', '0xA', '0x', `0x1${'0'.repeat(64)}`].map(
          (value) => ({
            label: `${field}: ${String(value)}`,
            value: { ...wire(), [field]: value },
            category: /^Invalid uint256 quantity$/,
          }),
        ),
      ),
    ]
    for (const { label, value, category } of cases) {
      await t.test(label, async () => {
        const { client, requests } = fixture(decorator, value)
        await semanticRejection(client.getGrant({ grantId: first }), category)
        assert.deepEqual(requests, [
          { method: 'diesis_getGrant', params: [first] },
        ])
      })
    }
  })

  test(`${name}: built batch refuses whole malformed or reordered responses`, async (t) => {
    const cases = [
      {
        label: 'null batch',
        value: null,
        category: /^Invalid grant (?:batch )?response$/,
      },
      {
        label: 'object batch',
        value: {},
        category: /^Invalid grant (?:batch )?response$/,
      },
      {
        label: 'short batch',
        value: [wire(second)],
        category: /^Invalid grant (?:batch )?response$/,
      },
      {
        label: 'surplus batch',
        value: [wire(second), wire(first), wire(first)],
        category: /^Invalid grant (?:batch )?response$/,
      },
      {
        label: 'wrong order',
        value: [wire(first), wire(second)],
        category: /^Invalid grant identity$/,
      },
      {
        label: 'duplicate row',
        value: [wire(second), wire(second)],
        category: /^Invalid grant identity$/,
      },
      {
        label: 'null final row',
        value: [wire(second), null],
        category: /^Invalid grant response$/,
      },
      ...quantityFields.map((field) => ({
        label: `malformed final ${field}`,
        value: [wire(second), { ...wire(first), [field]: '0x00' }],
        category: /^Invalid uint256 quantity$/,
      })),
    ]
    for (const { label, value, category } of cases) {
      await t.test(label, async () => {
        const { client, requests } = fixture(decorator, value)
        await semanticRejection(batch(client, [second, first]), category)
        assert.deepEqual(requests, [
          {
            method: 'diesis_getGrants',
            params: [{ grantIds: [second, first] }],
          },
        ])
      })
    }
  })

  for (const kind of ['single', 'batch']) {
    test(`${name}: ${kind} native-shaped -32603 refusal makes exactly one attempt`, async () => {
      // Frozen helpers.rs uses jsonrpsee INTERNAL_ERROR_CODE=-32603. These
      // messages are source-derived illustrative fixtures, not emitted captures.
      const message =
        kind === 'single'
          ? `state provider unavailable for gas grant ${first}`
          : 'state provider unavailable for pinned gas grant batch'
      const refusal = { code: -32603, message }
      const { client, requests } = fixture(decorator, undefined, refusal)
      const pending =
        kind === 'single'
          ? client.getGrant({ grantId: first })
          : batch(client, [second, first])
      await assert.rejects(pending, (error) => {
        assert.ok(error instanceof InternalRpcError)
        assert.equal(error.code, -32603)
        assert.ok(error.message.includes(message))
        assert.equal(error.cause, refusal)
        return true
      })
      assert.deepEqual(requests, [
        kind === 'single'
          ? { method: 'diesis_getGrant', params: [first] }
          : {
              method: 'diesis_getGrants',
              params: [{ grantIds: [second, first] }],
            },
      ])
    })
  }
}

// Synthetic native44bed history DTO shape, not an ABI/emitted/live receipt.
// Placeholder topic0 and contributor/amount layout; no kind-topic semantic decode.
const historyHash = (value) => `0x${value.toString(16).padStart(64, '0')}`
const historyGrant = `0x${'11'.repeat(32)}`
const historyAccount = `0x${'22'.repeat(20)}`
function historyEvent(blockNumber = 5, logIndex = 0) {
  return {
    blockNumber,
    blockHash: historyHash(blockNumber),
    transactionHash: historyHash(50 + blockNumber),
    transactionIndex: 0,
    logIndex,
    kind: 'grantContributed',
    grantId: historyGrant,
    campaignId: null,
    account: historyAccount,
    topics: [
      historyHash(999),
      historyGrant,
      `0x${'00'.repeat(12)}${historyAccount.slice(2)}`,
    ],
    data: historyHash(1),
  }
}
function historyPage(events = [historyEvent()]) {
  return {
    anchorBlockNumber: 10,
    anchorBlockHash: historyHash(10),
    retentionFloorBlockNumber: 1,
    retentionFloorBlockHash: historyHash(1),
    events,
    next: null,
  }
}
function historyNext(row = historyEvent()) {
  return {
    anchorBlockNumber: 10,
    anchorBlockHash: historyHash(10),
    blockNumber: row.blockNumber,
    transactionIndex: row.transactionIndex,
    logIndex: row.logIndex,
  }
}
function historyDecoded(value) {
  return {
    anchorBlockNumber: BigInt(value.anchorBlockNumber),
    anchorBlockHash: value.anchorBlockHash,
    retentionFloorBlockNumber: BigInt(value.retentionFloorBlockNumber),
    retentionFloorBlockHash: value.retentionFloorBlockHash,
    events: value.events.map((event) => ({
      ...event,
      blockNumber: BigInt(event.blockNumber),
      topics: [...event.topics],
    })),
    next:
      value.next === null
        ? null
        : {
            ...value.next,
            anchorBlockNumber: BigInt(value.next.anchorBlockNumber),
            blockNumber: BigInt(value.next.blockNumber),
          },
  }
}
function history(client, params) {
  assert.equal(typeof client.getPatronHistory, 'function')
  return client.getPatronHistory(params)
}

const historyEntries = [
  ...entries,
  { name: 'root patronage decorator', decorator: root.patronageActions },
]
for (const { name, decorator } of historyEntries) {
  test(`${name}: history is manual, bare-number JSON becomes bigint and default sends once`, async () => {
    const source = historyPage()
    const { client, requests } = fixture(decorator, source)
    assert.deepEqual(requests, [])
    const result = await history(client)
    assert.deepEqual(result, historyDecoded(source))
    assert.equal(typeof result.anchorBlockNumber, 'bigint')
    assert.equal(typeof result.events[0].transactionIndex, 'number')
    assert.equal(result.events[0].campaignId, null)
    assert.equal(result.next, null)
    assert.deepEqual(requests, [
      { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
    ])
  })
  test(`${name}: complete history query captures safe numbers, all filters and cursor`, async () => {
    const campaign = `0x${'12'.repeat(32)}`
    const source = historyPage([{ ...historyEvent(), campaignId: campaign }])
    const { client, requests } = fixture(decorator, source)
    const cursor = {
      anchorBlockNumber: 10n,
      anchorBlockHash: historyHash(10),
      blockNumber: 4n,
      transactionIndex: 0,
      logIndex: 0,
    }
    assert.deepEqual(
      await history(client, {
        fromBlock: 1n,
        toBlock: 10n,
        grantId: historyGrant,
        campaignId: campaign,
        account: historyAccount,
        cursor,
        limit: 2,
      }),
      historyDecoded(source),
    )
    const wire = [
      {
        method: 'diesis_getPatronHistory',
        params: [
          {
            limit: 2,
            fromBlock: 1,
            toBlock: 10,
            grantId: historyGrant,
            campaignId: campaign,
            account: historyAccount,
            cursor: {
              anchorBlockNumber: 10,
              anchorBlockHash: historyHash(10),
              blockNumber: 4,
              transactionIndex: 0,
              logIndex: 0,
            },
          },
        ],
      },
    ]
    assert.deepEqual(requests, wire)
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), wire)
  })
  test(`${name}: full history terminal-null and manual resumption preserve one fixed anchor`, async () => {
    const one = { ...historyPage(), next: historyNext() }
    const two = historyPage([historyEvent(6)])
    let calls = 0
    const requests = []
    const client = createPublicClient({
      transport: custom(
        {
          request: async (request) => {
            requests.push(JSON.parse(JSON.stringify(request)))
            return JSON.parse(JSON.stringify(calls++ === 0 ? one : two))
          },
        },
        { retryCount: 0 },
      ),
    }).extend(decorator)
    const firstPage = await history(client, {
      fromBlock: 1n,
      toBlock: 10n,
      grantId: historyGrant,
      limit: 1,
    })
    assert.equal(calls, 1)
    assert.deepEqual(firstPage, historyDecoded(one))
    const finalPage = await history(client, {
      fromBlock: 1n,
      toBlock: 10n,
      grantId: historyGrant,
      cursor: firstPage.next,
      limit: 1,
    })
    assert.deepEqual(finalPage, historyDecoded(two))
    assert.equal(finalPage.next, null)
    assert.equal(calls, 2)
    assert.deepEqual(requests[1], {
      method: 'diesis_getPatronHistory',
      params: [
        {
          limit: 1,
          fromBlock: 1,
          toBlock: 10,
          grantId: historyGrant,
          cursor: {
            anchorBlockNumber: 10,
            anchorBlockHash: historyHash(10),
            blockNumber: 5,
            transactionIndex: 0,
            logIndex: 0,
          },
        },
      ],
    })
  })
  test(`${name}: direct built history projection owns output objects and strips additive fields`, async () => {
    const source = { ...historyPage(), next: historyNext(), extra: true }
    source.events[0].extra = true
    source.next.extra = true
    const requests = []
    const actions = decorator({
      request: async (request) => {
        requests.push(request)
        return source
      },
    })
    const result = await history(actions, { limit: 1 })
    assert.notEqual(result, source)
    assert.notEqual(result.events, source.events)
    assert.notEqual(result.events[0], source.events[0])
    assert.notEqual(result.events[0].topics, source.events[0].topics)
    assert.notEqual(result.next, source.next)
    assert.equal('extra' in result, false)
    assert.equal('extra' in result.events[0], false)
    assert.equal('extra' in result.next, false)
    result.events[0].topics[0] = historyHash(88)
    result.next.logIndex = 99
    assert.equal(source.events[0].topics[0], historyHash(999))
    assert.equal(source.next.logIndex, 0)
    assert.equal(source.extra, true)
    assert.equal(requests.length, 1)
  })
  test(`${name}: built history refuses unsafe JSON, malformed scalar and wrong continuation`, async () => {
    const cases = [
      {
        source: {
          ...historyPage(),
          anchorBlockNumber: Number.MAX_SAFE_INTEGER + 1,
        },
        category: /^Invalid patron history integer$/,
      },
      {
        source: historyPage([{ ...historyEvent(), kind: 'unknown' }]),
        category: /^Invalid patron history event$/,
      },
      {
        source: { ...historyPage(), next: { ...historyNext(), logIndex: 1 } },
        category: /^Invalid patron history continuation$/,
      },
    ]
    for (const { source, category } of cases) {
      const { client, requests } = fixture(decorator, source)
      await semanticRejection(history(client, { limit: 1 }), category)
      assert.deepEqual(requests, [
        { method: 'diesis_getPatronHistory', params: [{ limit: 1 }] },
      ])
    }
  })
  test(`${name}: built history retains real viem -32603 cause with no retry/fallback`, async () => {
    const refusal = {
      code: -32603,
      message: 'synthetic retained-anchor or fixed4096 scan-cap refusal',
    }
    const { client, requests } = fixture(decorator, undefined, refusal)
    await assert.rejects(history(client), (error) => {
      assert.ok(error instanceof InternalRpcError)
      assert.equal(error.code, -32603)
      assert.equal(error.cause, refusal)
      assert.ok(error.message.includes(refusal.message))
      return true
    })
    assert.deepEqual(requests, [
      { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
    ])
  })
  test(`${name}: direct built history preserves rejected sentinel identity`, async () => {
    const sentinel = new Error('direct history reader sentinel')
    const requests = []
    const actions = decorator({
      request: async (request) => {
        requests.push(request)
        throw sentinel
      },
    })
    await assert.rejects(history(actions), (error) => error === sentinel)
    assert.deepEqual(requests, [
      { method: 'diesis_getPatronHistory', params: [{ limit: 0 }] },
    ])
  })
}

function declarationConsumer(rootSpecifier, patronageSpecifier) {
  return `import { createPublicClient, custom, type Hex } from 'viem'
import {
  diesisPublicActions,
  patronageActions as rootPatronageActions,
  type DiesisPublicActions,
  type GasGrant,
  type GetPatronHistoryParams,
  type PatronEventKind,
  type PatronHistoryCursor,
  type PatronHistoryEvent,
  type PatronHistoryPage,
} from '${rootSpecifier}'
import {
  patronageActions,
  type PatronageActions,
  type GasGrant as SubpathGasGrant,
  type GetPatronHistoryParams as SubpathGetPatronHistoryParams,
  type PatronEventKind as SubpathPatronEventKind,
  type PatronHistoryCursor as SubpathPatronHistoryCursor,
  type PatronHistoryEvent as SubpathPatronHistoryEvent,
  type PatronHistoryPage as SubpathPatronHistoryPage,
} from '${patronageSpecifier}'

const first: Hex = '0x${'01'.padStart(64, '0')}'
const grantIds: readonly Hex[] = [first]
const publicClient = createPublicClient({
  transport: custom({ request: async () => { throw new Error('type fixture only') } }, { retryCount: 0 }),
}).extend(diesisPublicActions)
const leafClient = createPublicClient({
  transport: custom({ request: async () => { throw new Error('type fixture only') } }, { retryCount: 0 }),
}).extend(patronageActions)
const rootLeafClient = createPublicClient({
  transport: custom({ request: async () => { throw new Error('type fixture only') } }, { retryCount: 0 }),
}).extend(rootPatronageActions)

export function requests(publicActions: DiesisPublicActions, leafActions: PatronageActions) {
  const single: Promise<GasGrant> = publicClient.getGrant({ grantId: first })
  const batch: Promise<GasGrant[]> = publicClient.getGrants({ grantIds })
  const leafSingle: Promise<SubpathGasGrant> = leafClient.getGrant({ grantId: first })
  const leafBatch: Promise<SubpathGasGrant[]> = leafClient.getGrants({ grantIds })
  const rootLeafBatch: Promise<GasGrant[]> = rootLeafClient.getGrants({ grantIds })
  const publicTypeBatch: Promise<GasGrant[]> = publicActions.getGrants({ grantIds })
  const leafTypeBatch: Promise<SubpathGasGrant[]> = leafActions.getGrants({ grantIds })
  return { single, batch, leafSingle, leafBatch, rootLeafBatch, publicTypeBatch, leafTypeBatch }
}

export function quantities(grant: GasGrant, subpath: SubpathGasGrant) {
  const balance: bigint = grant.balance
  const totalContributed: bigint = grant.totalContributed
  const totalSpent: bigint = grant.totalSpent
  const paused: boolean = grant.paused
  const rootCompatible: GasGrant = subpath
  const subpathCompatible: SubpathGasGrant = grant
  // @ts-expect-error quantities cannot accept JSON numbers
  grant.balance = 1
  // @ts-expect-error contributed quantity cannot accept JSON numbers
  grant.totalContributed = 1
  // @ts-expect-error spent quantity cannot accept JSON numbers
  grant.totalSpent = 1
  // @ts-expect-error paused remains boolean
  subpath.paused = 'false'
  return { balance, totalContributed, totalSpent, paused, rootCompatible, subpathCompatible }
}

export function invalidRequests(maybe: GasGrant | null) {
  // @ts-expect-error a grant ID is hexadecimal text, not bigint
  publicClient.getGrant({ grantId: 1n })
  // @ts-expect-error grantIds is a readonly Hex array, not a scalar
  publicClient.getGrants({ grantIds: first })
  // @ts-expect-error subpath array items are hexadecimal text
  leafClient.getGrants({ grantIds: [1] })
  // @ts-expect-error getGrant never returns a synthetic nullable GrantInfo
  const required: GasGrant = maybe
  return required
}

export function historyRequests(publicActions: DiesisPublicActions, leafActions: PatronageActions) {
  const cursor: PatronHistoryCursor = {
    anchorBlockNumber: 10n, anchorBlockHash: first,
    blockNumber: 5n, transactionIndex: 0, logIndex: 1,
  }
  const params: GetPatronHistoryParams = {fromBlock: 1n, toBlock: 10n, cursor, limit: 2}
  const publicHistory: Promise<PatronHistoryPage> = publicClient.getPatronHistory(params)
  const leafHistory: Promise<SubpathPatronHistoryPage> = leafClient.getPatronHistory(params)
  const rootLeafHistory: Promise<PatronHistoryPage> = rootLeafClient.getPatronHistory(params)
  const publicTypeHistory: Promise<PatronHistoryPage> = publicActions.getPatronHistory(params)
  const leafTypeHistory: Promise<SubpathPatronHistoryPage> = leafActions.getPatronHistory(params)
  const subpathCursor: SubpathPatronHistoryCursor = cursor
  const subpathParams: SubpathGetPatronHistoryParams = params
  return {publicHistory, leafHistory, rootLeafHistory, publicTypeHistory, leafTypeHistory, subpathCursor, subpathParams}
}

export function historyFields(page: PatronHistoryPage, event: PatronHistoryEvent) {
  const height: bigint = page.anchorBlockNumber
  const floor: bigint = page.retentionFloorBlockNumber
  const eventHeight: bigint = event.blockNumber
  const transactionIndex: number = event.transactionIndex
  const logIndex: number = event.logIndex
  const grantId: Hex | null = event.grantId
  const campaignId: Hex | null = event.campaignId
  const account: Hex | null = event.account
  const next: PatronHistoryCursor | null = page.next
  const subpathEvent: SubpathPatronHistoryEvent = event
  const subpathPage: SubpathPatronHistoryPage = page
  const kind: SubpathPatronEventKind = event.kind
  const allKinds: readonly PatronEventKind[] = [
    'grantContributed', 'grantReserved', 'grantReservationCancelled', 'grantSettled',
    'settledBurnAccrued', 'grantWithdrawn', 'referralGrantSet', 'accountGrantAssigned',
    'grantAuthorizationSet', 'grantAuthorizationRevoked', 'grantGasLimitsUpdated',
    'paused', 'stakingAddressUpdated', 'campaignRegistered', 'campaignRevocationSet',
    'campaignOwnerRotated', 'campaignVoucherClaimed', 'campaignVoucherRevoked',
    'burnFlushed', 'burnFlushFailed',
  ]
  return {height, floor, eventHeight, transactionIndex, logIndex, grantId, campaignId, account, next, subpathEvent, subpathPage, kind, allKinds}
}

export function invalidHistoryTypes(page: PatronHistoryPage, cursor: PatronHistoryCursor, event: PatronHistoryEvent) {
  // @ts-expect-error public block input is bigint, not number
  const wrongBlock: GetPatronHistoryParams = {fromBlock: 1}
  // @ts-expect-error cursor ordinals are numbers, not bigint
  const wrongOrdinal: PatronHistoryCursor = {...cursor, logIndex: 1n}
  // @ts-expect-error the native event kind union is closed
  const wrongKind: PatronEventKind = 'unknown'
  // @ts-expect-error next is legitimately nullable
  const requiredNext: PatronHistoryCursor = page.next
  // @ts-expect-error nullable event identities cannot become required hashes
  const requiredGrant: Hex = event.grantId
  // @ts-expect-error response heights are decoded bigint values
  const numberHeight: number = event.blockNumber
  // @ts-expect-error a cursor requires all five fields
  publicClient.getPatronHistory({cursor: {anchorBlockNumber: 10n}})
  // @ts-expect-error limit is a number, not hexadecimal text
  leafClient.getPatronHistory({limit: '0x1'})
  return {wrongBlock, wrongOrdinal, wrongKind, requiredNext, requiredGrant, numberHeight}
}
`
}

test('actual source and package declarations accept grant consumers and reject invalid types', async (t) => {
  const compiler = require.resolve('typescript/bin/tsc')
  const temporary = await mkdtemp(
    path.join(sdkRoot, '.patronage-read-consumers-'),
  )
  t.diagnostic(`Patronage TypeScript temporary directory: ${temporary}`)
  try {
    const variants = [
      {
        name: 'source.ts',
        source: declarationConsumer(
          '../src/index.js',
          '../src/patronage/index.js',
        ),
      },
      {
        name: 'package.ts',
        source: declarationConsumer('@diesis/sdk', '@diesis/sdk/patronage'),
      },
    ]
    const inputs = []
    for (const variant of variants) {
      const target = path.join(temporary, variant.name)
      await writeFile(target, variant.source)
      inputs.push(target)
    }
    try {
      const { stdout, stderr } = await exec(
        process.execPath,
        [
          compiler,
          '--ignoreConfig',
          '--noEmit',
          '--strict',
          '--target',
          'ES2022',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--skipLibCheck',
          ...inputs,
        ],
        { cwd: sdkRoot, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      )
      if (stdout) t.diagnostic(stdout)
      if (stderr) t.diagnostic(stderr)
    } catch (error) {
      throw new Error(
        `Patronage consumer TypeScript check failed in ${temporary}: ${error.message}\n${error.stdout ?? ''}${error.stderr ?? ''}`,
        { cause: error },
      )
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
