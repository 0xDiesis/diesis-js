import type { Hex } from 'viem'

import {
  derivePricedMarketId,
  validateMarketPricing,
} from './market-pricing.js'
import { marketId as deriveLegacyMarketId } from './utils.js'
import type { IndexedResponse, MarketInfo } from './types.js'

export type GetMarketPricingParams = { marketId: Hex; blockHash?: Hex }
export interface MarketPricingInfo extends MarketInfo {
  pricingVersion: 0 | 1
  priceDenominator: bigint
  quantityUnit: 'baseAtoms'
}

function invalid(): never {
  throw new Error('Invalid canonical market pricing observation')
}

function exactKeys(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const own = Reflect.ownKeys(value)
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    invalid()
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) invalid()
  }
}

function hash(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) invalid()
  return value as Hex
}

function decimal(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 20 ||
    !/^(?:0|[1-9][0-9]*)$/.test(value)
  )
    invalid()
  const parsed = BigInt(value)
  if (parsed === 0n || parsed >= 1n << 64n) invalid()
  return parsed
}

/** Copy request identity before crossing the asynchronous RPC boundary. */
export function marketPricingQuery(
  value: GetMarketPricingParams,
): GetMarketPricingParams {
  if (!value || typeof value !== 'object') invalid()
  exactKeys(
    value,
    Object.hasOwn(value, 'blockHash')
      ? ['marketId', 'blockHash']
      : ['marketId'],
  )
  const marketId = hash(value.marketId)
  return {
    marketId,
    ...(value.blockHash === undefined
      ? {}
      : { blockHash: hash(value.blockHash) }),
  }
}

/** Older discovery responses may omit all three fields; partial metadata refuses. */
export function decodeMarketPricingMetadata(
  row: Record<string, unknown>,
  market: MarketInfo,
  required = false,
):
  | Pick<
      MarketPricingInfo,
      'pricingVersion' | 'priceDenominator' | 'quantityUnit'
    >
  | Record<string, never> {
  const fields = ['pricing_version', 'price_denominator', 'quantity_unit']
  if (market.marketType !== 0 && market.marketType !== 1) invalid()
  if (!fields.some((key) => Object.hasOwn(row, key))) {
    if (required) invalid()
    if (
      deriveLegacyMarketId(
        market.baseToken,
        market.quoteToken,
        market.marketType,
      ).toLowerCase() !== market.marketId.toLowerCase()
    )
      invalid()
    return {}
  }
  if (!fields.every((key) => Object.hasOwn(row, key))) invalid()
  if (row.pricing_version !== 0 && row.pricing_version !== 1) invalid()
  if (row.quantity_unit !== 'baseAtoms') invalid()
  const pricing = validateMarketPricing(
    {
      pricingVersion: row.pricing_version,
      priceDenominator: decimal(row.price_denominator),
    },
    decimal(row.lot_size),
  )
  if (decimal(row.tick_size) !== market.tickSize) invalid()
  if (pricing.pricingVersion === 1 && market.marketType !== 0) invalid()
  const expectedId =
    pricing.pricingVersion === 1
      ? derivePricedMarketId(market.baseToken, market.quoteToken, 0, pricing)
      : deriveLegacyMarketId(
          market.baseToken,
          market.quoteToken,
          market.marketType,
        )
  if (expectedId.toLowerCase() !== market.marketId.toLowerCase()) invalid()
  return { ...pricing, quantityUnit: 'baseAtoms' }
}

export function assertMarketPricingObservation(
  raw: unknown,
  decoded: IndexedResponse<MarketInfo>,
  query: GetMarketPricingParams,
): asserts decoded is IndexedResponse<MarketPricingInfo> {
  exactKeys(raw, ['blockNumber', 'blockHash', 'indexDigest', 'data'])
  exactKeys((raw as { data: unknown }).data, [
    'market_id',
    'base_token',
    'quote_token',
    'market_type',
    'state',
    'tick_size',
    'lot_size',
    'pricing_version',
    'price_denominator',
    'quantity_unit',
  ])
  if (decoded.data.marketId.toLowerCase() !== query.marketId.toLowerCase())
    invalid()
  if (
    query.blockHash !== undefined &&
    decoded.blockHash.toLowerCase() !== query.blockHash.toLowerCase()
  )
    invalid()
}
