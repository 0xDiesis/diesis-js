import type { Address, Hex } from 'viem'
import { DIESIS_PERPS_BOOK, DIESIS_SPOT_BOOK } from '../addresses.js'

/** Versioned control facts; indexGeneration is local publication identity. */
export type ControlRead<T> = {
  readVersion: 1
  indexGeneration: bigint
  value: T
}
export type SessionControlRead<T> = {
  readVersion: 2
  indexGeneration: bigint
  value: T
}
export type GetOrderExpiryParams = {
  owner: Address
  marketId: Hex
  book: Address
  /** Nonzero u64 order identity, padded to 32 bytes. */
  orderId: Hex
}
export type OrderExpiry = {
  identity: GetOrderExpiryParams
  /** Stored tag: GTC=0, GTD=1, IOC=2, FOK=3. */
  timeInForce: 0 | 1 | 2 | 3
  /** Positive GTD deadline; null for every other TIF. */
  expirySeconds: bigint | null
}
export type GetSessionAuthorizationParams = {
  principal: Address
  sessionKey: Address
}
export type SessionAuthorizationStatus =
  | 'unbound'
  | 'revoked'
  | 'authorized'
  | 'expired'
export type SessionMarketOrdinal = {
  marketId: Hex
  ordinal: number
  allowed: boolean
}
/** Canonical storage facts, not an execution eligibility decision. */
export type SessionAuthorizationRead = {
  principal: Address
  sessionKey: Address
  /** On-chain retained key generation, separate from indexGeneration. */
  authorizationGeneration: bigint
  blockTimestampSeconds: bigint
  status: SessionAuthorizationStatus
  actionScope: bigint | null
  /** Inclusive deadline: authorized when timestamp <= validUntil. */
  validUntilSeconds: bigint | null
  /** Zero is uncapped; null means the record is absent. */
  maxNotionalOrSpend: bigint | null
  /** Ordinal zero is the most significant bit of the first byte. */
  allowedMarketsMask: Hex | null
  marketCount: number
  marketOrdinals: SessionMarketOrdinal[]
  allAssignedAndFutureMarkets: boolean
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}
function hex(
  value: unknown,
  bytes: number,
  field: string,
  nonzero = false,
): Hex {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value) ||
    (nonzero && BigInt(value) === 0n)
  )
    throw new Error(
      `${field} must be ${nonzero ? 'nonzero ' : ''}${bytes} bytes of hex`,
    )
  return value as Hex
}
function decimal(value: unknown, bits: 64 | 256, field: string): bigint {
  if (
    typeof value !== 'string' ||
    value.length > (bits === 64 ? 20 : 78) ||
    !/^(?:0|[1-9][0-9]*)$/.test(value)
  )
    throw new Error(`${field} must be an unsigned decimal string`)
  const decoded = BigInt(value)
  if (decoded >= 1n << BigInt(bits))
    throw new Error(`${field} exceeds uint${bits}`)
  return decoded
}
function nullableDecimal(
  value: unknown,
  bits: 64 | 256,
  field: string,
): bigint | null {
  return value === null ? null : decimal(value, bits, field)
}
function number(value: unknown, maximum: number, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw new Error(`${field} must be an integer from zero through ${maximum}`)
  return value
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}
function same(actual: Hex, expected: Hex, field: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase())
    throw new Error(`${field} differs from queried identity`)
}

export function orderExpiryQuery(
  params: GetOrderExpiryParams,
): GetOrderExpiryParams {
  const owner = hex(params.owner, 20, 'owner', true) as Address
  const marketId = hex(params.marketId, 32, 'marketId', true)
  const book = hex(params.book, 20, 'book', true) as Address
  const orderId = hex(params.orderId, 32, 'orderId', true)
  if (
    book.toLowerCase() !== DIESIS_SPOT_BOOK.toLowerCase() &&
    book.toLowerCase() !== DIESIS_PERPS_BOOK.toLowerCase()
  )
    throw new Error('book must be a canonical spot or perps book')
  if (BigInt(orderId) >= 1n << 64n) throw new Error('orderId exceeds uint64')
  return { owner, marketId, book, orderId }
}
export function sessionAuthorizationQuery(
  params: GetSessionAuthorizationParams,
): GetSessionAuthorizationParams {
  const principal = hex(params.principal, 20, 'principal', true) as Address
  const sessionKey = hex(params.sessionKey, 20, 'sessionKey', true) as Address
  if (principal.toLowerCase() === sessionKey.toLowerCase())
    throw new Error('principal and sessionKey must be distinct')
  return { principal, sessionKey }
}
export function decodeOrderExpiryControl(
  data: unknown,
  query: GetOrderExpiryParams,
): ControlRead<OrderExpiry | null> {
  const control = object(data, 'order expiry control')
  if (control.readVersion !== 1)
    throw new Error('order expiry readVersion must be 1')
  const indexGeneration = decimal(
    control.indexGeneration,
    64,
    'indexGeneration',
  )
  if (control.value === null)
    return { readVersion: 1, indexGeneration, value: null }
  const row = object(control.value, 'order expiry value')
  const identity = orderExpiryQuery(
    object(row.identity, 'order identity') as GetOrderExpiryParams,
  )
  for (const field of ['owner', 'marketId', 'book', 'orderId'] as const)
    same(identity[field], query[field], field)
  const timeInForce = number(
    row.timeInForce,
    3,
    'timeInForce',
  ) as OrderExpiry['timeInForce']
  const expirySeconds = nullableDecimal(row.expirySeconds, 64, 'expirySeconds')
  if (
    timeInForce === 1
      ? expirySeconds === null || expirySeconds === 0n
      : expirySeconds !== null
  )
    throw new Error('stored TIF and expirySeconds are inconsistent')
  return {
    readVersion: 1,
    indexGeneration,
    value: { identity, timeInForce, expirySeconds },
  }
}
export function decodeSessionAuthorizationControl(
  data: unknown,
  query: GetSessionAuthorizationParams,
): SessionControlRead<SessionAuthorizationRead> {
  const control = object(data, 'session authorization control')
  if (control.readVersion !== 2)
    throw new Error('session authorization readVersion must be 2')
  const indexGeneration = decimal(
    control.indexGeneration,
    64,
    'indexGeneration',
  )
  const row = object(control.value, 'session authorization value')
  const identity = sessionAuthorizationQuery(
    row as GetSessionAuthorizationParams,
  )
  same(identity.principal, query.principal, 'principal')
  same(identity.sessionKey, query.sessionKey, 'sessionKey')
  const authorizationGeneration = decimal(
    row.authorizationGeneration,
    64,
    'authorizationGeneration',
  )
  const blockTimestampSeconds = decimal(
    row.blockTimestampSeconds,
    64,
    'blockTimestampSeconds',
  )
  const status = row.status
  if (
    status !== 'unbound' &&
    status !== 'revoked' &&
    status !== 'authorized' &&
    status !== 'expired'
  )
    throw new Error('unknown session authorization status')
  const actionScope = nullableDecimal(row.actionScope, 256, 'actionScope')
  const validUntilSeconds = nullableDecimal(
    row.validUntilSeconds,
    64,
    'validUntilSeconds',
  )
  const maxNotionalOrSpend = nullableDecimal(
    row.maxNotionalOrSpend,
    256,
    'maxNotionalOrSpend',
  )
  const allowedMarketsMask =
    row.allowedMarketsMask === null
      ? null
      : hex(row.allowedMarketsMask, 32, 'allowedMarketsMask')
  const marketCount = number(row.marketCount, 256, 'marketCount')
  const allAssignedAndFutureMarkets = boolean(
    row.allAssignedAndFutureMarkets,
    'allAssignedAndFutureMarkets',
  )
  const bound = status === 'authorized' || status === 'expired'
  const mask = allowedMarketsMask === null ? null : BigInt(allowedMarketsMask)
  const all = mask === (1n << 256n) - 1n
  if (bound) {
    if (
      authorizationGeneration === 0n ||
      actionScope === null ||
      actionScope === 0n ||
      (actionScope & ~0x07fen) !== 0n ||
      validUntilSeconds === null ||
      validUntilSeconds === 0n ||
      maxNotionalOrSpend === null ||
      mask === null
    )
      throw new Error('bound session authorization fields are invalid')
    if (validUntilSeconds < blockTimestampSeconds !== (status === 'expired'))
      throw new Error(
        'session status differs from inclusive canonical deadline',
      )
    if (!all && (mask & ((1n << BigInt(256 - marketCount)) - 1n)) !== 0n)
      throw new Error('session mask includes unassigned ordinals')
  } else {
    if (
      (status === 'unbound') !== (authorizationGeneration === 0n) ||
      actionScope !== null ||
      validUntilSeconds !== null ||
      maxNotionalOrSpend !== null ||
      mask !== null
    )
      throw new Error('absent session authorization fields are inconsistent')
  }
  if (allAssignedAndFutureMarkets !== (bound && all))
    throw new Error('session future-market sentinel is inconsistent')
  if (
    !Array.isArray(row.marketOrdinals) ||
    row.marketOrdinals.length !== marketCount
  )
    throw new Error('marketOrdinals must enumerate the complete registry')
  const seen = new Set<string>()
  const marketOrdinals = row.marketOrdinals.map(
    (value, index): SessionMarketOrdinal => {
      const item = object(value, 'market ordinal')
      const marketId = hex(item.marketId, 32, 'marketId', true)
      const ordinal = number(item.ordinal, 255, 'ordinal')
      const allowed = boolean(item.allowed, 'allowed')
      if (ordinal !== index || seen.has(marketId.toLowerCase()))
        throw new Error(
          'marketOrdinals are unordered or contain duplicate markets',
        )
      seen.add(marketId.toLowerCase())
      const expected =
        mask !== null && (mask & (1n << BigInt(255 - ordinal))) !== 0n
      if (allowed !== expected)
        throw new Error('market permission differs from native mask')
      return { marketId, ordinal, allowed }
    },
  )
  return {
    readVersion: 2,
    indexGeneration,
    value: {
      ...identity,
      authorizationGeneration,
      blockTimestampSeconds,
      status,
      actionScope,
      validUntilSeconds,
      maxNotionalOrSpend,
      allowedMarketsMask,
      marketCount,
      marketOrdinals,
      allAssignedAndFutureMarkets,
    },
  }
}
