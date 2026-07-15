import {
  bytesToHex,
  encodeFunctionData,
  hexToBytes,
  type Address,
  type Chain,
  type Client,
  type Hash,
  type Hex,
  type LocalAccount,
  type Transport,
  type TransactionSerializableEIP1559,
} from 'viem'
import { sendRawTransaction } from 'viem/actions'

import { IDiesisSpotBookAbi } from '../abi/index.js'
import { DIESIS_PERPS_BOOK, DIESIS_SPOT_BOOK } from '../addresses.js'
import type { CancelScheduleActionV2 } from './cancel-schedule.js'
import {
  fixedBytes,
  integerNumber,
  nonzeroBytes,
  Reader,
  UINT64_MAX,
  UINT256_MAX,
  Writer,
} from './wire-bytes.js'

export const EXCHANGE_ACTION_V2_LIMITS = {
  maxEncodedBytes: 16_384,
  maxActions: 32,
  maxCancels: 64,
  maxMarkets: 16,
  maxFills: 64,
  maxPriceLevelsPerAction: 16,
  maxCancelChunk: 32,
} as const

export type BatchAtomicityV2 = 'atomicAll' | 'continueOnReject'
export type SideV2 = 'buy' | 'sell'
export type OrderKindV2 = 'limit' | 'market'
export type MarginTypeV2 = 'cross' | 'isolated' | 'unified'
export type TimeInForceV2 =
  | { kind: 'gtc' }
  | { kind: 'gtd'; expiry: bigint }
  | { kind: 'ioc' }
  | { kind: 'fok' }

export type PlaceActionV2 = {
  kind: 'place'
  clientActionId: Hex
  marketId: Hex
  side: SideV2
  orderKind: OrderKindV2
  timeInForce: TimeInForceV2
  postOnly: boolean
  reduceOnly: boolean
  marginType: MarginTypeV2
  priceTicks: bigint
  quantityLots: bigint
  maxFills: number
  maxPriceLevels: number
  clientOrderId?: Hex
  marginContribution?: bigint
}

export type CancelByOrderIdActionV2 = {
  kind: 'cancelByOrderId'
  clientActionId: Hex
  marketId: Hex
  orderId: Hex
}

export type CancelByClientOrderIdActionV2 = {
  kind: 'cancelByClientOrderId'
  clientActionId: Hex
  marketId: Hex
  clientOrderId: Hex
}

export type CancelReplaceActionV2 = {
  kind: 'cancelReplace'
  clientActionId: Hex
  marketId: Hex
  cancelTarget: 'orderId' | 'clientOrderId'
  targetId: Hex
  replacementSide: SideV2
  replacementOrderKind: OrderKindV2
  replacementTimeInForce: TimeInForceV2
  replacementPostOnly: boolean
  replacementReduceOnly: boolean
  replacementMarginType: MarginTypeV2
  replacementPriceTicks: bigint
  replacementQuantityLots: bigint
  maxFills: number
  maxPriceLevels: number
  newClientOrderId?: Hex
  marginContribution?: bigint
}

export type CancelMarketChunkActionV2 = {
  kind: 'cancelMarketChunk'
  clientActionId: Hex
  marketId: Hex
  maxOrders: number
}

export type ExchangeActionV2 =
  | PlaceActionV2
  | CancelByOrderIdActionV2
  | CancelByClientOrderIdActionV2
  | CancelReplaceActionV2
  | CancelMarketChunkActionV2
  | CancelScheduleActionV2

export type ExchangeActionBatchV2 = {
  atomicity: BatchAtomicityV2
  actions: readonly ExchangeActionV2[]
}

export type ExchangeBookV2 = 'spot' | 'perpetual'

const MAGIC = Uint8Array.of(0x44, 0x58, 0x41, 0x32)
const VERSION = 2
const HEADER_BYTES = 12
const ZERO_32 = new Uint8Array(32)

const ACTION_KEYS: Readonly<
  Record<ExchangeActionV2['kind'], readonly string[]>
> = {
  place: [
    'kind',
    'clientActionId',
    'marketId',
    'side',
    'orderKind',
    'timeInForce',
    'postOnly',
    'reduceOnly',
    'marginType',
    'priceTicks',
    'quantityLots',
    'maxFills',
    'maxPriceLevels',
    'clientOrderId',
    'marginContribution',
  ],
  cancelByOrderId: ['kind', 'clientActionId', 'marketId', 'orderId'],
  cancelByClientOrderId: [
    'kind',
    'clientActionId',
    'marketId',
    'clientOrderId',
  ],
  cancelReplace: [
    'kind',
    'clientActionId',
    'marketId',
    'cancelTarget',
    'targetId',
    'replacementSide',
    'replacementOrderKind',
    'replacementTimeInForce',
    'replacementPostOnly',
    'replacementReduceOnly',
    'replacementMarginType',
    'replacementPriceTicks',
    'replacementQuantityLots',
    'maxFills',
    'maxPriceLevels',
    'newClientOrderId',
    'marginContribution',
  ],
  cancelMarketChunk: ['kind', 'clientActionId', 'marketId', 'maxOrders'],
  armCancelSchedule: [
    'kind',
    'clientActionId',
    'scheduleId',
    'authorizationExpiry',
    'cancellationDeadline',
    'expectedRenewalCounter',
    'maxOrdersPerTrigger',
    'marketIds',
  ],
  renewCancelSchedule: [
    'kind',
    'clientActionId',
    'scheduleId',
    'expectedRenewalCounter',
    'newDeadline',
  ],
  disarmCancelSchedule: [
    'kind',
    'clientActionId',
    'scheduleId',
    'expectedRenewalCounter',
  ],
  triggerCancelSchedule: ['kind', 'clientActionId', 'scheduleId'],
}

function strictKeys(action: ExchangeActionV2): void {
  const allowed = new Set(ACTION_KEYS[action.kind])
  for (const key of Object.keys(action)) {
    if (!allowed.has(key))
      throw new Error(`unknown ${action.kind} field ${key}`)
  }
}

function prefix(
  writer: Writer,
  tag: number,
  length: number,
  clientActionId: Hex,
): void {
  writer.u8(tag, 'action tag')
  writer.u8(0, 'reserved')
  writer.u16(length, 'record length')
  writer.push(fixedBytes(clientActionId, 16, 'clientActionId'))
}

function enumValue<T extends string>(
  value: T,
  values: Readonly<Record<T, number>>,
  name: string,
): number {
  const encoded = values[value]
  if (encoded === undefined) throw new Error(`unknown ${name} ${String(value)}`)
  return encoded
}

function booleanValue(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
}

type OrderFields = {
  orderKind: OrderKindV2
  timeInForce: TimeInForceV2
  postOnly: boolean
  reduceOnly: boolean
  priceTicks: bigint
  quantityLots: bigint
  maxFills: number
  maxPriceLevels: number
  clientOrderId?: Hex
  marginContribution?: bigint
}

function encodedOrderFields(fields: OrderFields): {
  tif: number
  flags: number
  options: number
  expiry: bigint
  clientOrderId: Uint8Array
  marginContribution: bigint
} {
  const { orderKind, timeInForce, postOnly, priceTicks, quantityLots } = fields
  booleanValue(postOnly, 'postOnly')
  booleanValue(fields.reduceOnly, 'reduceOnly')
  if (priceTicks < 0n || priceTicks > UINT64_MAX)
    throw new Error('priceTicks is outside uint64')
  if (quantityLots <= 0n || quantityLots > UINT64_MAX) {
    throw new Error('quantityLots must be a nonzero uint64')
  }
  if (orderKind === 'limit' && priceTicks === 0n)
    throw new Error('limit price is zero')
  if (orderKind === 'market' && priceTicks !== 0n)
    throw new Error('market price is nonzero')
  if (
    orderKind === 'market' &&
    timeInForce.kind !== 'ioc' &&
    timeInForce.kind !== 'fok'
  ) {
    throw new Error('market order requires IOC or FOK')
  }
  if (
    postOnly &&
    (orderKind !== 'limit' ||
      timeInForce.kind === 'ioc' ||
      timeInForce.kind === 'fok')
  ) {
    throw new Error('post-only requires limit GTC/GTD')
  }
  integerNumber(fields.maxFills, 0xffff, 'maxFills')
  integerNumber(fields.maxPriceLevels, 0xffff, 'maxPriceLevels')
  if (postOnly) {
    if (fields.maxFills !== 0 || fields.maxPriceLevels !== 0) {
      throw new Error('post-only work caps must be zero')
    }
  } else if (fields.maxFills === 0 || fields.maxPriceLevels === 0) {
    throw new Error('executable order work caps must be nonzero')
  }
  if (fields.maxPriceLevels > fields.maxFills)
    throw new Error('price levels exceed fills')
  if (fields.maxFills > EXCHANGE_ACTION_V2_LIMITS.maxFills) {
    throw new Error('fills per action exceed 64')
  }
  if (
    fields.maxPriceLevels > EXCHANGE_ACTION_V2_LIMITS.maxPriceLevelsPerAction
  ) {
    throw new Error('price levels per action exceed 16')
  }

  let tif = 0
  let expiry = 0n
  let options = 0
  if (timeInForce.kind === 'gtd') {
    if (timeInForce.expiry <= 0n || timeInForce.expiry > UINT64_MAX) {
      throw new Error('GTD expiry must be a nonzero uint64')
    }
    tif = 1
    expiry = timeInForce.expiry
    options |= 0x02
  } else if (timeInForce.kind === 'ioc') tif = 2
  else if (timeInForce.kind === 'fok') tif = 3
  else if (timeInForce.kind !== 'gtc') throw new Error('unknown timeInForce')

  let flags = 0
  if (postOnly) flags |= 0x01
  if (fields.reduceOnly) flags |= 0x02
  const clientOrderId =
    fields.clientOrderId === undefined
      ? ZERO_32
      : nonzeroBytes(fields.clientOrderId, 32, 'clientOrderId')
  if (fields.clientOrderId !== undefined) options |= 0x01
  const marginContribution = fields.marginContribution ?? 0n
  if (fields.marginContribution !== undefined) {
    if (marginContribution <= 0n || marginContribution > UINT256_MAX) {
      throw new Error('marginContribution must be a nonzero uint256')
    }
    options |= 0x04
  }
  return { tif, flags, options, expiry, clientOrderId, marginContribution }
}

function encodePlace(action: PlaceActionV2): Uint8Array {
  const writer = new Writer()
  prefix(writer, 0x01, 152, action.clientActionId)
  writer.push(nonzeroBytes(action.marketId, 32, 'marketId'))
  writer.u8(enumValue(action.side, { buy: 0, sell: 1 }, 'side'), 'side')
  writer.u8(
    enumValue(action.orderKind, { limit: 0, market: 1 }, 'orderKind'),
    'orderKind',
  )
  const fields = encodedOrderFields(action)
  writer.u8(fields.tif, 'timeInForce')
  writer.u8(fields.flags, 'order flags')
  writer.u8(fields.options, 'order options')
  writer.u8(
    enumValue(
      action.marginType,
      { cross: 0, isolated: 1, unified: 2 },
      'marginType',
    ),
    'marginType',
  )
  writer.u16(0, 'reserved')
  writer.u64(action.priceTicks, 'priceTicks')
  writer.u64(action.quantityLots, 'quantityLots')
  writer.u64(fields.expiry, 'expiry')
  writer.u16(action.maxFills, 'maxFills')
  writer.u16(action.maxPriceLevels, 'maxPriceLevels')
  writer.push(fields.clientOrderId)
  writer.u256(fields.marginContribution, 'marginContribution')
  return writer.output()
}

function encodeCancelReplace(action: CancelReplaceActionV2): Uint8Array {
  const writer = new Writer()
  prefix(writer, 0x04, 184, action.clientActionId)
  writer.push(nonzeroBytes(action.marketId, 32, 'marketId'))
  writer.u8(
    enumValue(
      action.cancelTarget,
      { orderId: 0, clientOrderId: 1 },
      'cancelTarget',
    ),
    'cancelTarget',
  )
  writer.u8(
    enumValue(action.replacementSide, { buy: 0, sell: 1 }, 'replacementSide'),
    'replacementSide',
  )
  writer.u8(
    enumValue(
      action.replacementOrderKind,
      { limit: 0, market: 1 },
      'replacementOrderKind',
    ),
    'replacementOrderKind',
  )
  booleanValue(action.replacementPostOnly, 'replacementPostOnly')
  booleanValue(action.replacementReduceOnly, 'replacementReduceOnly')
  const fields = encodedOrderFields({
    orderKind: action.replacementOrderKind,
    timeInForce: action.replacementTimeInForce,
    postOnly: action.replacementPostOnly,
    reduceOnly: action.replacementReduceOnly,
    priceTicks: action.replacementPriceTicks,
    quantityLots: action.replacementQuantityLots,
    maxFills: action.maxFills,
    maxPriceLevels: action.maxPriceLevels,
    clientOrderId: action.newClientOrderId,
    marginContribution: action.marginContribution,
  })
  writer.u8(fields.tif, 'replacementTimeInForce')
  writer.u8(fields.flags, 'replacement flags')
  writer.u8(fields.options, 'replacement options')
  writer.u8(
    enumValue(
      action.replacementMarginType,
      { cross: 0, isolated: 1, unified: 2 },
      'replacementMarginType',
    ),
    'replacementMarginType',
  )
  writer.u8(0, 'reserved')
  writer.push(nonzeroBytes(action.targetId, 32, 'targetId'))
  writer.push(fields.clientOrderId)
  writer.u64(action.replacementPriceTicks, 'replacementPriceTicks')
  writer.u64(action.replacementQuantityLots, 'replacementQuantityLots')
  writer.u64(fields.expiry, 'expiry')
  writer.u16(action.maxFills, 'maxFills')
  writer.u16(action.maxPriceLevels, 'maxPriceLevels')
  writer.u256(fields.marginContribution, 'marginContribution')
  return writer.output()
}

function encodeAction(action: ExchangeActionV2): Uint8Array {
  strictKeys(action)
  if (action.kind === 'place') return encodePlace(action)
  const writer = new Writer()
  if (
    action.kind === 'cancelByOrderId' ||
    action.kind === 'cancelByClientOrderId'
  ) {
    prefix(
      writer,
      action.kind === 'cancelByOrderId' ? 0x02 : 0x03,
      84,
      action.clientActionId,
    )
    writer.push(nonzeroBytes(action.marketId, 32, 'marketId'))
    writer.push(
      nonzeroBytes(
        action.kind === 'cancelByOrderId'
          ? action.orderId
          : action.clientOrderId,
        32,
        action.kind === 'cancelByOrderId' ? 'orderId' : 'clientOrderId',
      ),
    )
  } else if (action.kind === 'cancelReplace') return encodeCancelReplace(action)
  else if (action.kind === 'cancelMarketChunk') {
    if (
      action.maxOrders <= 0 ||
      action.maxOrders > EXCHANGE_ACTION_V2_LIMITS.maxCancelChunk
    ) {
      throw new Error('maxOrders must be between 1 and 32')
    }
    prefix(writer, 0x05, 56, action.clientActionId)
    writer.push(nonzeroBytes(action.marketId, 32, 'marketId'))
    writer.u16(action.maxOrders, 'maxOrders')
    writer.u16(0, 'reserved')
  } else if (action.kind === 'armCancelSchedule') {
    if (
      action.marketIds.length === 0 ||
      action.marketIds.length > EXCHANGE_ACTION_V2_LIMITS.maxMarkets
    ) {
      throw new Error('schedule must contain between 1 and 16 markets')
    }
    if (action.authorizationExpiry <= 0n || action.cancellationDeadline <= 0n) {
      throw new Error('schedule deadlines must be nonzero')
    }
    if (action.cancellationDeadline > action.authorizationExpiry) {
      throw new Error('schedule deadline exceeds authorization expiry')
    }
    if (
      action.maxOrdersPerTrigger <= 0 ||
      action.maxOrdersPerTrigger > EXCHANGE_ACTION_V2_LIMITS.maxCancelChunk
    ) {
      throw new Error('maxOrdersPerTrigger must be between 1 and 32')
    }
    const markets = action.marketIds.map((marketId) =>
      nonzeroBytes(marketId, 32, 'marketId'),
    )
    for (let index = 1; index < markets.length; index += 1) {
      if (bytesToHex(markets[index - 1]!) >= bytesToHex(markets[index]!)) {
        throw new Error('schedule marketIds must be strictly increasing')
      }
    }
    prefix(writer, 0x06, 80 + markets.length * 32, action.clientActionId)
    writer.push(nonzeroBytes(action.scheduleId, 32, 'scheduleId'))
    writer.u64(action.authorizationExpiry, 'authorizationExpiry')
    writer.u64(action.cancellationDeadline, 'cancellationDeadline')
    writer.u64(action.expectedRenewalCounter, 'expectedRenewalCounter')
    writer.u16(action.maxOrdersPerTrigger, 'maxOrdersPerTrigger')
    writer.u16(markets.length, 'market count')
    for (const market of markets) writer.push(market)
  } else if (action.kind === 'renewCancelSchedule') {
    if (action.newDeadline <= 0n) throw new Error('newDeadline must be nonzero')
    prefix(writer, 0x07, 68, action.clientActionId)
    writer.push(nonzeroBytes(action.scheduleId, 32, 'scheduleId'))
    writer.u64(action.expectedRenewalCounter, 'expectedRenewalCounter')
    writer.u64(action.newDeadline, 'newDeadline')
  } else if (action.kind === 'disarmCancelSchedule') {
    prefix(writer, 0x08, 60, action.clientActionId)
    writer.push(nonzeroBytes(action.scheduleId, 32, 'scheduleId'))
    writer.u64(action.expectedRenewalCounter, 'expectedRenewalCounter')
  } else {
    prefix(writer, 0x09, 52, action.clientActionId)
    writer.push(nonzeroBytes(action.scheduleId, 32, 'scheduleId'))
  }
  return writer.output()
}

function validateAggregateBounds(batch: ExchangeActionBatchV2): void {
  const clientIds = new Set<string>()
  const markets = new Set<string>()
  let cancels = 0
  let fills = 0
  for (const action of batch.actions) {
    const clientId = bytesToHex(
      fixedBytes(action.clientActionId, 16, 'clientActionId'),
    ).toLowerCase()
    if (clientId !== `0x${'00'.repeat(16)}`) {
      if (clientIds.has(clientId)) throw new Error('duplicate client action id')
      clientIds.add(clientId)
    }
    if ('marketId' in action) markets.add(action.marketId.toLowerCase())
    if (action.kind === 'armCancelSchedule')
      for (const market of action.marketIds) markets.add(market.toLowerCase())
    if (
      action.kind === 'cancelByOrderId' ||
      action.kind === 'cancelByClientOrderId' ||
      action.kind === 'cancelReplace'
    )
      cancels += 1
    else if (action.kind === 'cancelMarketChunk') cancels += action.maxOrders
    if (action.kind === 'place' || action.kind === 'cancelReplace')
      fills += action.maxFills
  }
  if (markets.size > EXCHANGE_ACTION_V2_LIMITS.maxMarkets)
    throw new Error('batch contains more than 16 markets')
  if (cancels > EXCHANGE_ACTION_V2_LIMITS.maxCancels)
    throw new Error('batch requests more than 64 cancels')
  if (fills > EXCHANGE_ACTION_V2_LIMITS.maxFills)
    throw new Error('batch requests more than 64 fills')
}

/** Encode one canonical DXA2 batch with the same selected Task 5 limits as Rust. */
export function encodeExchangeActionBatchV2(batch: ExchangeActionBatchV2): Hex {
  if (
    batch.atomicity !== 'atomicAll' &&
    batch.atomicity !== 'continueOnReject'
  ) {
    throw new Error('unknown batch atomicity')
  }
  if (batch.actions.length === 0) throw new Error('actions must be nonempty')
  if (batch.actions.length > EXCHANGE_ACTION_V2_LIMITS.maxActions) {
    throw new Error('batch supports at most 32 actions')
  }
  validateAggregateBounds(batch)
  const records = batch.actions.map(encodeAction)
  const writer = new Writer()
  writer.push(MAGIC)
  writer.u8(VERSION, 'version')
  writer.u8(batch.atomicity === 'atomicAll' ? 0 : 1, 'atomicity')
  writer.u16(0, 'reserved')
  writer.u16(records.length, 'action count')
  writer.u16(0, 'reserved')
  for (const record of records) writer.push(record)
  const encoded = writer.output()
  if (encoded.length > EXCHANGE_ACTION_V2_LIMITS.maxEncodedBytes) {
    throw new Error('encoded batch exceeds 16384 bytes')
  }
  return bytesToHex(encoded)
}

function decodeEnum<T>(value: number, values: readonly T[], name: string): T {
  const decoded = values[value]
  if (decoded === undefined) throw new Error(`unknown ${name} ${value}`)
  return decoded
}

function decodedOrderFields(
  reader: Reader,
  _orderKind: OrderKindV2,
): {
  timeInForce: TimeInForceV2
  postOnly: boolean
  reduceOnly: boolean
  options: number
  marginType: MarginTypeV2
  priceTicks: bigint
  quantityLots: bigint
  maxFills: number
  maxPriceLevels: number
  clientOrderId?: Hex
  marginContribution?: bigint
} {
  const tif = reader.u8('time in force')
  const flags = reader.u8('flags')
  const options = reader.u8('options')
  if ((flags & ~0x03) !== 0 || (options & ~0x07) !== 0)
    throw new Error('nonzero reserved order bits')
  const marginType = decodeEnum(
    reader.u8('margin type'),
    ['cross', 'isolated', 'unified'] as const,
    'margin type',
  )
  if (reader.u16('reserved') !== 0) throw new Error('nonzero reserved bytes')
  const priceTicks = reader.u64('price ticks')
  const quantityLots = reader.u64('quantity lots')
  const expiry = reader.u64('expiry')
  const maxFills = reader.u16('max fills')
  const maxPriceLevels = reader.u16('max price levels')
  const rawClientOrderId = reader.take(32, 'client order id')
  const rawMargin = reader.u256('margin contribution')
  const expiryPresent = (options & 0x02) !== 0
  const timeInForce: TimeInForceV2 =
    tif === 0 && !expiryPresent && expiry === 0n
      ? { kind: 'gtc' }
      : tif === 1 && expiryPresent && expiry !== 0n
        ? { kind: 'gtd', expiry }
        : tif === 2 && !expiryPresent && expiry === 0n
          ? { kind: 'ioc' }
          : tif === 3 && !expiryPresent && expiry === 0n
            ? { kind: 'fok' }
            : (() => {
                throw new Error('noncanonical time in force')
              })()
  const clientPresent = (options & 0x01) !== 0
  const clientZero = rawClientOrderId.every((byte) => byte === 0)
  if (clientPresent === clientZero)
    throw new Error('noncanonical client order id option')
  const marginPresent = (options & 0x04) !== 0
  if (marginPresent === (rawMargin === 0n))
    throw new Error('noncanonical margin option')
  return {
    timeInForce,
    postOnly: (flags & 0x01) !== 0,
    reduceOnly: (flags & 0x02) !== 0,
    options,
    marginType,
    priceTicks,
    quantityLots,
    maxFills,
    maxPriceLevels,
    ...(clientPresent ? { clientOrderId: bytesToHex(rawClientOrderId) } : {}),
    ...(marginPresent ? { marginContribution: rawMargin } : {}),
  }
}

function decodeRecord(record: Uint8Array): ExchangeActionV2 {
  const reader = new Reader(record)
  const tag = reader.u8('action tag')
  if (reader.u8('reserved') !== 0)
    throw new Error('nonzero reserved action byte')
  const declaredLength = reader.u16('record length')
  if (declaredLength !== record.length)
    throw new Error('record length mismatch')
  const clientActionId = bytesToHex(reader.take(16, 'client action id'))
  if (tag === 0x01) {
    const marketId = bytesToHex(reader.take(32, 'market id'))
    const side = decodeEnum(reader.u8('side'), ['buy', 'sell'] as const, 'side')
    const orderKind = decodeEnum(
      reader.u8('order kind'),
      ['limit', 'market'] as const,
      'order kind',
    )
    const fields = decodedOrderFields(reader, orderKind)
    const { options: _options, ...orderFields } = fields
    return {
      kind: 'place',
      clientActionId,
      marketId,
      side,
      orderKind,
      ...orderFields,
    }
  }
  if (tag === 0x02 || tag === 0x03) {
    const marketId = bytesToHex(reader.take(32, 'market id'))
    const id = bytesToHex(reader.take(32, 'cancel id'))
    return tag === 0x02
      ? { kind: 'cancelByOrderId', clientActionId, marketId, orderId: id }
      : {
          kind: 'cancelByClientOrderId',
          clientActionId,
          marketId,
          clientOrderId: id,
        }
  }
  if (tag === 0x04) {
    const marketId = bytesToHex(reader.take(32, 'market id'))
    const cancelTarget = decodeEnum(
      reader.u8('cancel target'),
      ['orderId', 'clientOrderId'] as const,
      'cancel target',
    )
    const replacementSide = decodeEnum(
      reader.u8('side'),
      ['buy', 'sell'] as const,
      'side',
    )
    const replacementOrderKind = decodeEnum(
      reader.u8('order kind'),
      ['limit', 'market'] as const,
      'order kind',
    )
    const tif = reader.u8('time in force')
    const flags = reader.u8('flags')
    const options = reader.u8('options')
    const replacementMarginType = decodeEnum(
      reader.u8('margin type'),
      ['cross', 'isolated', 'unified'] as const,
      'margin type',
    )
    if (reader.u8('reserved') !== 0) throw new Error('nonzero reserved byte')
    const targetId = bytesToHex(reader.take(32, 'target id'))
    const rawClient = reader.take(32, 'new client order id')
    const replacementPriceTicks = reader.u64('replacement price ticks')
    const replacementQuantityLots = reader.u64('replacement quantity lots')
    const expiry = reader.u64('expiry')
    const maxFills = reader.u16('max fills')
    const maxPriceLevels = reader.u16('max price levels')
    const margin = reader.u256('margin contribution')
    const synthetic = new Writer()
    synthetic.u8(tif, 'time in force')
    synthetic.u8(flags, 'flags')
    synthetic.u8(options, 'options')
    synthetic.u8(
      enumValue(
        replacementMarginType,
        { cross: 0, isolated: 1, unified: 2 },
        'margin type',
      ),
      'margin type',
    )
    synthetic.u16(0, 'reserved')
    synthetic.u64(replacementPriceTicks, 'price')
    synthetic.u64(replacementQuantityLots, 'quantity')
    synthetic.u64(expiry, 'expiry')
    synthetic.u16(maxFills, 'fills')
    synthetic.u16(maxPriceLevels, 'levels')
    synthetic.push(rawClient)
    synthetic.u256(margin, 'margin')
    const decoded = decodedOrderFields(
      new Reader(synthetic.output()),
      replacementOrderKind,
    )
    const {
      options: _options,
      timeInForce: replacementTimeInForce,
      postOnly: replacementPostOnly,
      reduceOnly: replacementReduceOnly,
      marginType: _marginType,
      priceTicks: _priceTicks,
      quantityLots: _quantityLots,
      clientOrderId: newClientOrderId,
      marginContribution,
    } = decoded
    return {
      kind: 'cancelReplace',
      clientActionId,
      marketId,
      cancelTarget,
      targetId,
      replacementSide,
      replacementOrderKind,
      replacementTimeInForce,
      replacementPostOnly,
      replacementReduceOnly,
      replacementMarginType,
      replacementPriceTicks,
      replacementQuantityLots,
      maxFills,
      maxPriceLevels,
      ...(newClientOrderId === undefined ? {} : { newClientOrderId }),
      ...(marginContribution === undefined ? {} : { marginContribution }),
    }
  }
  if (tag === 0x05) {
    const marketId = bytesToHex(reader.take(32, 'market id'))
    const maxOrders = reader.u16('max orders')
    if (reader.u16('reserved') !== 0) throw new Error('nonzero reserved bytes')
    return { kind: 'cancelMarketChunk', clientActionId, marketId, maxOrders }
  }
  const scheduleId = bytesToHex(reader.take(32, 'schedule id'))
  if (tag === 0x06) {
    const authorizationExpiry = reader.u64('authorization expiry')
    const cancellationDeadline = reader.u64('cancellation deadline')
    const expectedRenewalCounter = reader.u64('renewal counter')
    const maxOrdersPerTrigger = reader.u16('max orders')
    const marketCount = reader.u16('market count')
    const marketIds = Array.from({ length: marketCount }, () =>
      bytesToHex(reader.take(32, 'market id')),
    )
    return {
      kind: 'armCancelSchedule',
      clientActionId,
      scheduleId,
      authorizationExpiry,
      cancellationDeadline,
      expectedRenewalCounter,
      maxOrdersPerTrigger,
      marketIds,
    }
  }
  if (tag === 0x07)
    return {
      kind: 'renewCancelSchedule',
      clientActionId,
      scheduleId,
      expectedRenewalCounter: reader.u64('renewal counter'),
      newDeadline: reader.u64('new deadline'),
    }
  if (tag === 0x08)
    return {
      kind: 'disarmCancelSchedule',
      clientActionId,
      scheduleId,
      expectedRenewalCounter: reader.u64('renewal counter'),
    }
  if (tag === 0x09)
    return { kind: 'triggerCancelSchedule', clientActionId, scheduleId }
  throw new Error(`unknown action tag ${tag}`)
}

/** Strictly decode canonical DXA2 bytes and reject alternate encodings. */
export function decodeExchangeActionBatchV2(
  encoded: Hex,
): ExchangeActionBatchV2 {
  const bytes = fixedBytes(encoded, hexToBytes(encoded).length, 'encoded batch')
  if (bytes.length < HEADER_BYTES) throw new Error('truncated batch header')
  if (!MAGIC.every((byte, index) => bytes[index] === byte))
    throw new Error('invalid DXA2 magic')
  if (bytes[4] !== VERSION)
    throw new Error(`unsupported action batch version ${bytes[4]}`)
  const atomicity = decodeEnum(
    bytes[5]!,
    ['atomicAll', 'continueOnReject'] as const,
    'atomicity',
  )
  const header = new Reader(bytes.slice(6, HEADER_BYTES))
  if (header.u16('reserved') !== 0)
    throw new Error('nonzero reserved header bytes')
  const actionCount = header.u16('action count')
  if (header.u16('reserved') !== 0)
    throw new Error('nonzero reserved header bytes')
  const actions: ExchangeActionV2[] = []
  let offset = HEADER_BYTES
  for (let index = 0; index < actionCount; index += 1) {
    if (offset + 4 > bytes.length) throw new Error('truncated action prefix')
    const length = bytes[offset + 2]! * 0x100 + bytes[offset + 3]!
    if (length < 20 || offset + length > bytes.length)
      throw new Error('truncated action record')
    actions.push(decodeRecord(bytes.slice(offset, offset + length)))
    offset += length
  }
  if (offset !== bytes.length)
    throw new Error('trailing bytes after action batch')
  const batch: ExchangeActionBatchV2 = { atomicity, actions }
  if (
    encodeExchangeActionBatchV2(batch).toLowerCase() !== encoded.toLowerCase()
  ) {
    throw new Error('noncanonical action batch encoding')
  }
  return batch
}

/** ABI-encode the top-level precompile call without adding action signatures/nonces. */
export function prepareExchangeActionsV2Transaction(parameters: {
  book: ExchangeBookV2
  batch: ExchangeActionBatchV2
}): { to: Address; data: Hex; value: 0n } {
  const encodedActions = encodeExchangeActionBatchV2(parameters.batch)
  let to: Address
  if (parameters.book === 'spot') to = DIESIS_SPOT_BOOK
  else if (parameters.book === 'perpetual') to = DIESIS_PERPS_BOOK
  else throw new Error(`unknown exchange book ${String(parameters.book)}`)
  return {
    to,
    data: encodeFunctionData({
      abi: IDiesisSpotBookAbi,
      functionName: 'submitExchangeActionsV2',
      args: [encodedActions],
    }),
    value: 0n,
  }
}

export type SignExchangeActionsV2Parameters = {
  book: ExchangeBookV2
  batch: ExchangeActionBatchV2
  transaction: Omit<TransactionSerializableEIP1559, 'to' | 'data' | 'value'> & {
    chainId: number
    nonce: number
  }
}

/** Sign one ordinary EIP-1559 transaction; only its Ethereum nonce provides replay protection. */
export function signExchangeActionsV2Transaction(
  account: Pick<LocalAccount, 'signTransaction'>,
  parameters: SignExchangeActionsV2Parameters,
): Promise<Hex> {
  const prepared = prepareExchangeActionsV2Transaction(parameters)
  return account.signTransaction({
    ...parameters.transaction,
    type: 'eip1559',
    ...prepared,
  })
}

export type SendExchangeActionsV2Parameters = {
  book: ExchangeBookV2
  batch: ExchangeActionBatchV2
  transaction: {
    nonce: number
    gas: bigint
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
  }
}

/** Submit one ordinary transaction through a viem-compatible wallet client. */
export function sendExchangeActionsV2Transaction(
  client: Client<Transport, Chain, LocalAccount>,
  parameters: SendExchangeActionsV2Parameters,
): Promise<Hash> {
  return signExchangeActionsV2Transaction(client.account, {
    ...parameters,
    transaction: {
      ...parameters.transaction,
      type: 'eip1559',
      chainId: client.chain.id,
    },
  }).then((serializedTransaction) =>
    sendRawTransaction(client, { serializedTransaction }),
  )
}

export * from './actions-v2-results.js'
