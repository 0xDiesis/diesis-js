import { keccak256, stringToBytes, type Address, type Hex } from 'viem'

import { fixedBytes, UINT64_MAX, UINT256_MAX, Writer } from './wire-bytes.js'

/** Immutable quote atoms per priceDenominator raw base atoms. */
export type MarketPricing = Readonly<{
  pricingVersion: 0 | 1
  priceDenominator: bigint
}>

/** Missing both pricing fields means legacy. Partial metadata is invalid. */
export type MarketPricingMetadata = Partial<MarketPricing> & {
  quantityUnit?: 'baseAtoms'
  lotSize?: bigint
}

export type ResolvedMarketPricing = MarketPricing & { lotSize?: bigint }

export const LEGACY_MARKET_PRICING: MarketPricing = Object.freeze({
  pricingVersion: 0,
  priceDenominator: 1n,
})

function unsigned(value: bigint, maximum: bigint, name: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > maximum)
    throw new Error(
      `${name} must fit ${maximum === UINT64_MAX ? 'uint64' : 'uint256'}`,
    )
  return value
}

function positiveU64(value: bigint, name: string): bigint {
  unsigned(value, UINT64_MAX, name)
  if (value === 0n) throw new Error(`${name} must be positive`)
  return value
}

/** Validate explicit units, and the lot grid when available. */
export function validateMarketPricing(
  pricing: MarketPricing,
  lotSize?: bigint,
): MarketPricing {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing))
    throw new Error('Invalid market pricing')
  const { pricingVersion, priceDenominator } = pricing
  if (pricingVersion !== 0 && pricingVersion !== 1)
    throw new Error('Unsupported pricing version')
  positiveU64(priceDenominator, 'Price denominator')
  if (pricingVersion === 0 && priceDenominator !== 1n)
    throw new Error('Legacy price denominator must equal 1')
  if (lotSize !== undefined) {
    positiveU64(lotSize, 'Lot size')
    if (lotSize % priceDenominator !== 0n)
      throw new Error('Lot size must be divisible by price denominator')
  }
  return Object.freeze({ pricingVersion, priceDenominator })
}

/** Resolve complete discovered market metadata before converting public quantities. */
export function resolveMarketPricing(
  metadata: MarketPricingMetadata = {},
): ResolvedMarketPricing {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error('Invalid market pricing metadata')
  const { pricingVersion, priceDenominator, quantityUnit, lotSize } = metadata
  if (quantityUnit !== undefined && quantityUnit !== 'baseAtoms')
    throw new Error('Unsupported market quantity unit')
  const pricing =
    pricingVersion === undefined && priceDenominator === undefined
      ? validateMarketPricing(LEGACY_MARKET_PRICING, lotSize)
      : validateMarketPricing(
          { pricingVersion, priceDenominator } as MarketPricing,
          lotSize,
        )
  if (pricing.pricingVersion === 1 && lotSize === undefined)
    throw new Error('Priced market metadata requires a lot size')
  return Object.freeze(
    lotSize === undefined ? pricing : { ...pricing, lotSize },
  )
}

function decimals(base: number, quote: number): void {
  if (
    ![base, quote].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  )
    throw new Error('Invalid token decimals')
}

/** Exact quote/base decimal string to native uint64 price. No rounding. */
export function humanPriceToNative(
  price: string,
  baseDecimals: number,
  quoteDecimals: number,
  tickSize: bigint,
  metadata?: MarketPricingMetadata,
): bigint {
  decimals(baseDecimals, quoteDecimals)
  positiveU64(tickSize, 'Tick size')
  if (
    typeof price !== 'string' ||
    price.length > 512 ||
    !/^\d+(\.\d+)?$/.test(price)
  )
    throw new Error('Invalid decimal price')
  const [whole, fraction = ''] = price.split('.')
  let numerator =
    BigInt(`${whole}${fraction}`) *
    resolveMarketPricing(metadata).priceDenominator
  let denominator = 1n
  const exponent = quoteDecimals - baseDecimals - fraction.length
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent)
  else denominator = 10n ** BigInt(-exponent)
  if (numerator <= 0n) throw new Error('Price must be positive')
  if (numerator % (denominator * tickSize) !== 0n)
    throw new Error('Price must align exactly to the native tick')
  return unsigned(numerator / denominator, UINT64_MAX, 'Price')
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

/** Exact human quote/base ratio, including nonterminating decimals. */
export function nativePriceRational(
  price: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  metadata?: MarketPricingMetadata,
): { numerator: bigint; denominator: bigint } {
  decimals(baseDecimals, quoteDecimals)
  const numerator =
    unsigned(price, UINT64_MAX, 'Price') * 10n ** BigInt(baseDecimals)
  const denominator =
    resolveMarketPricing(metadata).priceDenominator *
    10n ** BigInt(quoteDecimals)
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

/** Exact decimal display. Use nativePriceRational when the decimal cannot terminate. */
export function nativePriceToHuman(
  price: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  metadata?: MarketPricingMetadata,
): string {
  const { numerator, denominator } = nativePriceRational(
    price,
    baseDecimals,
    quoteDecimals,
    metadata,
  )
  let remainder = denominator
  let twos = 0
  let fives = 0
  while (remainder % 2n === 0n) {
    remainder /= 2n
    twos++
  }
  while (remainder % 5n === 0n) {
    remainder /= 5n
    fives++
  }
  if (remainder !== 1n)
    throw new Error('Price has no exact terminating decimal representation')
  const places = Math.max(twos, fives)
  const scaled = numerator * (10n ** BigInt(places) / denominator)
  if (places === 0) return scaled.toString()
  const raw = scaled.toString().padStart(places + 1, '0')
  const fraction = raw.slice(-places).replace(/0+$/, '')
  return fraction
    ? `${raw.slice(0, -places)}.${fraction}`
    : raw.slice(0, -places)
}

/** Public raw base atoms to the canonical quantity lattice, with exact lot alignment. */
export function rawToCanonicalQuantity(
  raw: bigint,
  metadata?: MarketPricingMetadata,
): bigint {
  unsigned(raw, UINT256_MAX, 'Raw quantity')
  const { priceDenominator, lotSize } = resolveMarketPricing(metadata)
  if (
    raw % priceDenominator !== 0n ||
    (lotSize !== undefined && raw % lotSize !== 0n)
  )
    throw new Error('Raw quantity must align exactly to the market lot grid')
  return raw / priceDenominator
}

export function canonicalToRawQuantity(
  size: bigint,
  metadata?: MarketPricingMetadata,
): bigint {
  unsigned(size, UINT256_MAX, 'Canonical quantity')
  const { priceDenominator } = resolveMarketPricing(metadata)
  const raw = unsigned(size * priceDenominator, UINT256_MAX, 'Raw quantity')
  rawToCanonicalQuantity(raw, metadata)
  return raw
}

/** Checked quote atoms. Average display prices cannot determine custody amounts. */
export function quoteNotional(
  price: bigint,
  rawQuantity: bigint,
  metadata?: MarketPricingMetadata,
): bigint {
  unsigned(price, UINT64_MAX, 'Price')
  return unsigned(
    price * rawToCanonicalQuantity(rawQuantity, metadata),
    UINT256_MAX,
    'Quote notional',
  )
}

/** New immutable identity. Legacy IDs retain their separate 41-byte preimage. */
export function derivePricedMarketId(
  baseToken: Address,
  quoteToken: Address,
  marketType: 0 | 1,
  pricing: MarketPricing,
): Hex {
  const resolved = validateMarketPricing(pricing)
  if (resolved.pricingVersion !== 1)
    throw new Error('Priced market identity requires version 1')
  if (marketType !== 0 && marketType !== 1)
    throw new Error('Unsupported market type')
  for (const [name, token] of [
    ['baseToken', baseToken],
    ['quoteToken', quoteToken],
  ] as const) {
    if (typeof token !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(token))
      throw new Error(`${name} must be exactly 20 bytes`)
  }
  const writer = new Writer()
  writer.push(stringToBytes('diesis.exchange.priced-market.v1'))
  writer.push(fixedBytes(baseToken, 20, 'baseToken'))
  writer.push(fixedBytes(quoteToken, 20, 'quoteToken'))
  writer.u8(marketType, 'marketType')
  writer.u8(resolved.pricingVersion, 'pricingVersion')
  writer.u64(resolved.priceDenominator, 'priceDenominator')
  return keccak256(writer.output())
}
