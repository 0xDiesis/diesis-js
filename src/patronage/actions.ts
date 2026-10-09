import type { Client, Transport, Chain, Hex, Address } from 'viem'

export interface GasGrant {
  grantId: Hex
  balance: bigint
  totalContributed: bigint
  totalSpent: bigint
  paused: boolean
}

export type PatronEventKind =
  | 'grantContributed'
  | 'grantReserved'
  | 'grantReservationCancelled'
  | 'grantSettled'
  | 'settledBurnAccrued'
  | 'grantWithdrawn'
  | 'referralGrantSet'
  | 'accountGrantAssigned'
  | 'grantAuthorizationSet'
  | 'grantAuthorizationRevoked'
  | 'grantGasLimitsUpdated'
  | 'paused'
  | 'stakingAddressUpdated'
  | 'campaignRegistered'
  | 'campaignRevocationSet'
  | 'campaignOwnerRotated'
  | 'campaignVoucherClaimed'
  | 'campaignVoucherRevoked'
  | 'burnFlushed'
  | 'burnFlushFailed'

export interface PatronHistoryCursor {
  anchorBlockNumber: bigint
  anchorBlockHash: Hex
  blockNumber: bigint
  transactionIndex: number
  logIndex: number
}

export interface GetPatronHistoryParams {
  fromBlock?: bigint
  toBlock?: bigint
  cursor?: PatronHistoryCursor
  grantId?: Hex
  campaignId?: Hex
  account?: Address
  limit?: number
}

export interface PatronHistoryEvent {
  blockNumber: bigint
  blockHash: Hex
  transactionHash: Hex
  transactionIndex: number
  logIndex: number
  kind: PatronEventKind
  grantId: Hex | null
  campaignId: Hex | null
  account: Address | null
  topics: Hex[]
  data: Hex
}

export interface PatronHistoryPage {
  anchorBlockNumber: bigint
  anchorBlockHash: Hex
  retentionFloorBlockNumber: bigint
  retentionFloorBlockHash: Hex
  events: PatronHistoryEvent[]
  next: PatronHistoryCursor | null
}

export type PatronageActions = {
  getGrant: (params: { grantId: Hex }) => Promise<GasGrant>
  getGrants: (params: { grantIds: readonly Hex[] }) => Promise<GasGrant[]>
  getPatronHistory: (
    params?: GetPatronHistoryParams,
  ) => Promise<PatronHistoryPage>
}

function ownValue(value: object, key: PropertyKey, message: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) throw new Error(message)
  return descriptor.value
}

function grantQuery(value: unknown, field: 'grantId' | 'grantIds'): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid grant query')
  for (const key of Reflect.ownKeys(value)) {
    if (
      Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
      key !== field
    )
      throw new Error('Invalid grant query')
  }
  return value
}

function grantHash(value: unknown, message: string): Hex {
  if (
    typeof value !== 'string' ||
    value.length !== 66 ||
    !/^0x[0-9a-fA-F]{64}$/.test(value)
  )
    throw new Error(message)
  return value as Hex
}

function grantIds(value: unknown): Hex[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64)
    throw new Error('Invalid grantIds')
  const ids: Hex[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index++) {
    const id = grantHash(
      ownValue(value, index, 'Invalid grantIds'),
      'Invalid grantIds',
    )
    const identity = id.toLowerCase()
    // SDK preflight deliberately adds uniqueness to native RPC's count bound.
    if (seen.has(identity)) throw new Error('Invalid grantIds')
    seen.add(identity)
    ids.push(id)
  }
  return ids
}

function uint256(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 66 ||
    value !== value.trim() ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value)
  )
    throw new Error('Invalid uint256 quantity')
  return BigInt(value)
}

function grantResponse(value: unknown, expectedId: string): GasGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid grant response')
  const grantId = ownValue(value, 'grantId', 'Invalid grant response')
  const balance = ownValue(value, 'balance', 'Invalid grant response')
  const totalContributed = ownValue(
    value,
    'totalContributed',
    'Invalid grant response',
  )
  const totalSpent = ownValue(value, 'totalSpent', 'Invalid grant response')
  const paused = ownValue(value, 'paused', 'Invalid grant response')
  const id = grantHash(grantId, 'Invalid grant response')
  if (typeof paused !== 'boolean') throw new Error('Invalid grant response')
  if (id.toLowerCase() !== expectedId) throw new Error('Invalid grant identity')
  // Valid zero storage observations are retained, with no existence/readiness claim.
  return {
    grantId: id,
    balance: uint256(balance),
    totalContributed: uint256(totalContributed),
    totalSpent: uint256(totalSpent),
    paused,
  }
}

function grantBatchResponse(
  value: unknown,
  expectedIds: readonly string[],
): GasGrant[] {
  if (!Array.isArray(value) || value.length !== expectedIds.length)
    throw new Error('Invalid grant batch response')
  const grants: GasGrant[] = []
  for (let index = 0; index < expectedIds.length; index++) {
    const row = ownValue(value, index, 'Invalid grant batch response')
    grants.push(grantResponse(row, expectedIds[index]))
  }
  return grants
}

type HistoryCategory =
  | 'query'
  | 'cursor'
  | 'integer'
  | 'page'
  | 'event'
  | 'identity'
  | 'continuation'
type HistoryRecord = Record<string, unknown>
type HistoryKey = Pick<
  PatronHistoryCursor,
  'blockNumber' | 'transactionIndex' | 'logIndex'
>
type HistoryWireCursor = Omit<
  PatronHistoryCursor,
  'anchorBlockNumber' | 'blockNumber'
> & {
  anchorBlockNumber: number
  blockNumber: number
}
type HistoryWireQuery = {
  fromBlock?: number
  toBlock?: number
  cursor?: HistoryWireCursor
  grantId?: Hex
  campaignId?: Hex
  account?: Address
  limit: number
}
const historyQueryFields = [
  'fromBlock',
  'toBlock',
  'cursor',
  'grantId',
  'campaignId',
  'account',
  'limit',
] as const
const historyCursorFields = [
  'anchorBlockNumber',
  'anchorBlockHash',
  'blockNumber',
  'transactionIndex',
  'logIndex',
] as const
const historyPageFields = [
  'anchorBlockNumber',
  'anchorBlockHash',
  'retentionFloorBlockNumber',
  'retentionFloorBlockHash',
  'events',
  'next',
] as const
const historyEventFields = [
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
] as const
const historyKinds: readonly PatronEventKind[] = [
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

function historyError(category: HistoryCategory): Error {
  return new Error(`Invalid patron history ${category}`)
}

function historyObject(value: unknown, category: HistoryCategory): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw historyError(category)
  return value
}

function historyRequired(
  value: unknown,
  fields: readonly string[],
  category: HistoryCategory,
): HistoryRecord {
  const record = historyObject(value, category)
  const captured: HistoryRecord = Object.create(null)
  for (const field of fields)
    captured[field] = ownValue(
      record,
      field,
      `Invalid patron history ${category}`,
    )
  return captured
}

function historyQueryKeys(
  value: object,
  fields: readonly string[],
  category: HistoryCategory,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (
      Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
      (typeof key !== 'string' || !fields.includes(key))
    )
      throw historyError(category)
  }
}

function historyInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw historyError('integer')
  return value === 0 ? 0 : value
}

function historyBlock(value: unknown): number {
  if (
    typeof value !== 'bigint' ||
    value < 0n ||
    value > (1n << 64n) - 1n ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw historyError('integer')
  return Number(value)
}

function historyAddress(value: unknown, category: HistoryCategory): Address {
  if (
    typeof value !== 'string' ||
    value.length !== 42 ||
    !/^0x[0-9a-fA-F]{40}$/.test(value)
  )
    throw historyError(category)
  return value as Address
}

function historyHash(value: unknown, category: HistoryCategory): Hex {
  return grantHash(value, `Invalid patron history ${category}`)
}

function patronHistoryQuery(input: unknown): {
  wire: HistoryWireQuery
  expected: HistoryWireQuery
} {
  const record = historyObject(input === undefined ? {} : input, 'query')
  historyQueryKeys(record, historyQueryFields, 'query')
  const query: HistoryRecord = Object.create(null)
  // Query descriptor/null shape precedes cursor shape and every numeric check.
  for (const field of historyQueryFields) {
    const descriptor = Object.getOwnPropertyDescriptor(record, field)
    if (!descriptor) {
      if (field in record) throw historyError('query')
      continue
    }
    if (!('value' in descriptor)) throw historyError('query')
    if (descriptor.value === undefined) continue
    if (
      descriptor.value === null &&
      !['fromBlock', 'toBlock', 'limit'].includes(field)
    )
      throw historyError('query')
    query[field] = descriptor.value
  }
  let rawCursor: HistoryRecord | undefined
  if ('cursor' in query) {
    const cursor = historyObject(query.cursor, 'cursor')
    historyQueryKeys(cursor, historyCursorFields, 'cursor')
    rawCursor = historyRequired(cursor, historyCursorFields, 'cursor')
  }
  const wire: HistoryWireQuery = { limit: 0 }
  if ('fromBlock' in query) wire.fromBlock = historyBlock(query.fromBlock)
  if ('toBlock' in query) wire.toBlock = historyBlock(query.toBlock)
  if ('limit' in query) wire.limit = historyInteger(query.limit, 256)
  const numericCursor =
    rawCursor === undefined
      ? undefined
      : {
          anchorBlockNumber: historyBlock(rawCursor.anchorBlockNumber),
          blockNumber: historyBlock(rawCursor.blockNumber),
          transactionIndex: historyInteger(
            rawCursor.transactionIndex,
            0xffffffff,
          ),
          logIndex: historyInteger(rawCursor.logIndex, 0xffffffff),
        }
  // All numeric request fields passed; query identities precede cursor identity.
  if ('grantId' in query) wire.grantId = historyHash(query.grantId, 'query')
  if ('campaignId' in query)
    wire.campaignId = historyHash(query.campaignId, 'query')
  if ('account' in query) wire.account = historyAddress(query.account, 'query')
  if (rawCursor !== undefined && numericCursor !== undefined) {
    wire.cursor = {
      ...numericCursor,
      anchorBlockHash: historyHash(rawCursor.anchorBlockHash, 'cursor'),
    }
    if (
      wire.cursor.blockNumber > wire.cursor.anchorBlockNumber ||
      (wire.fromBlock !== undefined &&
        wire.cursor.blockNumber < wire.fromBlock) ||
      (wire.toBlock !== undefined && wire.cursor.blockNumber > wire.toBlock)
    )
      throw historyError('cursor')
  }
  if (
    wire.fromBlock !== undefined &&
    wire.toBlock !== undefined &&
    (wire.fromBlock > wire.toBlock || wire.toBlock - wire.fromBlock >= 10000)
  )
    throw historyError('query')
  // No caller or provider aliases are retained in the expected response context.
  const expected: HistoryWireQuery = { ...wire }
  if (wire.cursor) expected.cursor = { ...wire.cursor }
  return { wire, expected }
}

function historyDense(
  value: unknown,
  minimum: number,
  maximum: number,
  category: HistoryCategory,
): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    throw historyError(category)
  const values: unknown[] = []
  for (let index = 0; index < value.length; index++)
    values.push(ownValue(value, index, `Invalid patron history ${category}`))
  return values
}

function historyCursorNumbers(
  value: HistoryRecord,
): Omit<PatronHistoryCursor, 'anchorBlockHash'> {
  return {
    anchorBlockNumber: BigInt(historyInteger(value.anchorBlockNumber)),
    blockNumber: BigInt(historyInteger(value.blockNumber)),
    transactionIndex: historyInteger(value.transactionIndex, 0xffffffff),
    logIndex: historyInteger(value.logIndex, 0xffffffff),
  }
}

function historyData(value: unknown): Hex {
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    value.length > 2 + 65536 * 2 ||
    !value.startsWith('0x') ||
    (value.length - 2) % 2 !== 0 ||
    !/^[0-9a-fA-F]*$/.test(value.slice(2))
  )
    throw historyError('event')
  return value as Hex
}

function historyCompare(left: HistoryKey, right: HistoryKey): number {
  if (left.blockNumber !== right.blockNumber)
    return left.blockNumber < right.blockNumber ? -1 : 1
  if (left.transactionIndex !== right.transactionIndex)
    return left.transactionIndex < right.transactionIndex ? -1 : 1
  if (left.logIndex !== right.logIndex)
    return left.logIndex < right.logIndex ? -1 : 1
  return 0
}

function patronHistoryPage(
  input: unknown,
  expected: HistoryWireQuery,
): PatronHistoryPage {
  const limit = expected.limit === 0 ? 256 : expected.limit
  // Structural prepass: page/dense events, every event/topics, then next shape.
  // Required descriptor failures precede all present numeric/scalar failures.
  const raw = historyRequired(input, historyPageFields, 'page')
  const rawEvents = historyDense(raw.events, 0, limit, 'page').map((value) => {
    const row = historyRequired(value, historyEventFields, 'event')
    row.topics = historyDense(row.topics, 1, 4, 'event')
    return row
  })
  const rawNext =
    raw.next === null
      ? null
      : historyRequired(raw.next, historyCursorFields, 'continuation')
  // Parsed safe numbers only: ordinary JSON cannot recover lexical rounding.
  const anchorBlockNumber = BigInt(historyInteger(raw.anchorBlockNumber))
  const retentionFloorBlockNumber = BigInt(
    historyInteger(raw.retentionFloorBlockNumber),
  )
  const numbers = rawEvents.map((row) => ({
    blockNumber: BigInt(historyInteger(row.blockNumber)),
    transactionIndex: historyInteger(row.transactionIndex, 0xffffffff),
    logIndex: historyInteger(row.logIndex, 0xffffffff),
  }))
  const nextNumbers = rawNext === null ? null : historyCursorNumbers(rawNext)
  // All numeric fields passed before scalar validation in page/event/next order.
  const anchorBlockHash = historyHash(raw.anchorBlockHash, 'page')
  const retentionFloorBlockHash = historyHash(
    raw.retentionFloorBlockHash,
    'page',
  )
  const events: PatronHistoryEvent[] = rawEvents.map((row, index) => {
    const blockHash = historyHash(row.blockHash, 'event')
    const transactionHash = historyHash(row.transactionHash, 'event')
    if (
      typeof row.kind !== 'string' ||
      !historyKinds.includes(row.kind as PatronEventKind)
    )
      throw historyError('event')
    return {
      ...numbers[index],
      blockHash,
      transactionHash,
      kind: row.kind as PatronEventKind,
      grantId: row.grantId === null ? null : historyHash(row.grantId, 'event'),
      campaignId:
        row.campaignId === null ? null : historyHash(row.campaignId, 'event'),
      account:
        row.account === null ? null : historyAddress(row.account, 'event'),
      topics: (row.topics as unknown[]).map((topic) =>
        historyHash(topic, 'event'),
      ),
      data: historyData(row.data),
    }
  })
  const next: PatronHistoryCursor | null =
    rawNext === null || nextNumbers === null
      ? null
      : {
          ...nextNumbers,
          anchorBlockHash: historyHash(rawNext.anchorBlockHash, 'continuation'),
        }
  // Native index consistency policy: floor/key-order, identities, then next.
  if (retentionFloorBlockNumber > anchorBlockNumber) throw historyError('page')
  for (let index = 1; index < events.length; index++) {
    if (historyCompare(events[index - 1], events[index]) >= 0)
      throw historyError('page')
  }
  if (
    retentionFloorBlockNumber === anchorBlockNumber &&
    retentionFloorBlockHash.toLowerCase() !== anchorBlockHash.toLowerCase()
  )
    throw historyError('identity')
  const cursor = expected.cursor
  if (
    cursor &&
    (BigInt(cursor.anchorBlockNumber) !== anchorBlockNumber ||
      cursor.anchorBlockHash.toLowerCase() !== anchorBlockHash.toLowerCase())
  )
    throw historyError('identity')
  for (let index = 0; index < events.length; index++) {
    const row = events[index]
    if (
      row.blockNumber < retentionFloorBlockNumber ||
      row.blockNumber > anchorBlockNumber ||
      (expected.fromBlock !== undefined &&
        row.blockNumber < BigInt(expected.fromBlock)) ||
      (expected.toBlock !== undefined &&
        row.blockNumber > BigInt(expected.toBlock)) ||
      (row.blockNumber === retentionFloorBlockNumber &&
        row.blockHash.toLowerCase() !==
          retentionFloorBlockHash.toLowerCase()) ||
      (row.blockNumber === anchorBlockNumber &&
        row.blockHash.toLowerCase() !== anchorBlockHash.toLowerCase()) ||
      (index > 0 &&
        row.blockNumber === events[index - 1].blockNumber &&
        row.blockHash.toLowerCase() !==
          events[index - 1].blockHash.toLowerCase())
    )
      throw historyError('identity')
    for (const filter of ['grantId', 'campaignId', 'account'] as const) {
      const requested = expected[filter]
      if (
        requested !== undefined &&
        (row[filter] === null ||
          row[filter]?.toLowerCase() !== requested.toLowerCase())
      )
        throw historyError('identity')
    }
  }
  if (
    cursor &&
    events.length > 0 &&
    historyCompare(events[0], {
      blockNumber: BigInt(cursor.blockNumber),
      transactionIndex: cursor.transactionIndex,
      logIndex: cursor.logIndex,
    }) <= 0
  )
    throw historyError('identity')
  if (
    next !== null &&
    (next.anchorBlockNumber !== anchorBlockNumber ||
      next.anchorBlockHash.toLowerCase() !== anchorBlockHash.toLowerCase() ||
      events.length === 0 ||
      events.length !== limit ||
      historyCompare(next, events[events.length - 1]) !== 0)
  )
    throw historyError('continuation')
  // Last-key binding and resumed first>cursor already imply next advancement.
  // No filter/range authentication, cache, scan restart or ABI semantic decode.
  return {
    anchorBlockNumber,
    anchorBlockHash,
    retentionFloorBlockNumber,
    retentionFloorBlockHash,
    events,
    next,
  }
}

export function patronageActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): PatronageActions {
  return {
    getPatronHistory: async (params) => {
      const captured = patronHistoryQuery(params)
      const response: unknown = await client.request({
        method: 'diesis_getPatronHistory' as never,
        params: [captured.wire],
      } as never)
      return patronHistoryPage(response, captured.expected)
    },
    getGrant: async (params) => {
      const query = grantQuery(params, 'grantId')
      const grantId = grantHash(
        ownValue(query, 'grantId', 'Invalid grantId'),
        'Invalid grantId',
      )
      const expectedId = grantId.toLowerCase()
      const response: unknown = await client.request({
        method: 'diesis_getGrant' as never,
        params: [grantId],
      } as never)
      return grantResponse(response, expectedId)
    },
    getGrants: async (params) => {
      const query = grantQuery(params, 'grantIds')
      const ids = grantIds(ownValue(query, 'grantIds', 'Invalid grantIds'))
      const expectedIds = ids.map((id) => id.toLowerCase())
      const response: unknown = await client.request({
        method: 'diesis_getGrants' as never,
        params: [{ grantIds: ids }],
      } as never)
      return grantBatchResponse(response, expectedIds)
    },
  }
}
