import { describe, expect, it } from 'vitest'
import {
  canonicalToRawQuantity,
  derivePricedMarketId,
  humanPriceToNative,
  LEGACY_MARKET_PRICING,
  nativePriceRational,
  nativePriceToHuman,
  quoteNotional,
  rawToCanonicalQuantity,
  resolveMarketPricing,
  validateMarketPricing,
  type MarketPricingMetadata,
} from '../src/exchange/market-pricing.js'

const U64_MAX = (1n << 64n) - 1n
const U256_MAX = (1n << 256n) - 1n
const priced: MarketPricingMetadata = {
  pricingVersion: 1,
  priceDenominator: 1_000_000_000_000n,
  lotSize: 1_000_000_000_000n,
  quantityUnit: 'baseAtoms',
}

describe('exact immutable market pricing', () => {
  it('defaults absent fields to legacy D=1 without changing quantity or quote atoms', () => {
    expect(resolveMarketPricing()).toEqual(LEGACY_MARKET_PRICING)
    expect(resolveMarketPricing({ lotSize: 5n })).toEqual({
      ...LEGACY_MARKET_PRICING,
      lotSize: 5n,
    })
    expect(rawToCanonicalQuantity(15n, { lotSize: 5n })).toBe(15n)
    expect(canonicalToRawQuantity(15n)).toBe(15n)
    expect(quoteNotional(7n, 15n)).toBe(105n)
  })

  it.each([
    { pricingVersion: 1 },
    { priceDenominator: 1n },
    { pricingVersion: 2, priceDenominator: 1n, lotSize: 1n },
    { pricingVersion: 0, priceDenominator: 2n },
    { pricingVersion: 1, priceDenominator: 0n, lotSize: 1n },
    { pricingVersion: 1, priceDenominator: U64_MAX + 1n, lotSize: 1n },
    { pricingVersion: 1, priceDenominator: 3n, lotSize: 4n },
    { pricingVersion: 1, priceDenominator: 1n },
    { pricingVersion: 1, priceDenominator: 1n, lotSize: 0n },
    { lotSize: U64_MAX + 1n },
    { quantityUnit: 'lots' },
    { pricingVersion: 1, priceDenominator: '1000', lotSize: 1000n },
  ])('rejects incomplete, noncanonical, or unknown metadata %#', (metadata) => {
    expect(() =>
      resolveMarketPricing(metadata as MarketPricingMetadata),
    ).toThrow()
  })

  it('validates the two-word pricing query separately from the market lot grid', () => {
    expect(
      validateMarketPricing({ pricingVersion: 1, priceDenominator: 3n }),
    ).toEqual({ pricingVersion: 1, priceDenominator: 3n })
    expect(() =>
      validateMarketPricing({ pricingVersion: 1, priceDenominator: 3n }, 4n),
    ).toThrow('divisible')
    expect(
      validateMarketPricing(
        { pricingVersion: 1, priceDenominator: U64_MAX },
        U64_MAX,
      ).priceDenominator,
    ).toBe(U64_MAX)
  })

  it('converts an 18/6 pair at a cent tick using D=1e14', () => {
    const units = {
      ...priced,
      priceDenominator: 100_000_000_000_000n,
      lotSize: 100_000_000_000_000n,
    }
    const price = humanPriceToNative('123.45', 18, 6, 1n, units)
    expect(price).toBe(12345n)
    expect(nativePriceToHuman(price, 18, 6, units)).toBe('123.45')
    expect(quoteNotional(price, 2_000_000_000_000_000_000n, units)).toBe(
      246_900_000n,
    )
    expect(rawToCanonicalQuantity(2_000_000_000_000_000_000n, units)).toBe(
      20_000n,
    )
    expect(canonicalToRawQuantity(20_000n, units)).toBe(
      2_000_000_000_000_000_000n,
    )
  })

  it('roundtrips native prices across the full ERC20 decimals range', () => {
    for (const [base, quote] of [
      [255, 0],
      [0, 255],
      [255, 255],
    ] as const) {
      for (const price of [1n, U64_MAX]) {
        const human = nativePriceToHuman(price, base, quote)
        expect(humanPriceToNative(human, base, quote, 1n)).toBe(price)
      }
    }
    expect(() => humanPriceToNative('1'.repeat(513), 0, 0, 1n)).toThrow(
      'decimal price',
    )
  })

  it('requires exact native ticks and refuses float input or silent rounding', () => {
    expect(() => humanPriceToNative('123.45', 18, 6, 1n, priced)).toThrow(
      'align exactly',
    )
    expect(() => humanPriceToNative('1.25', 6, 6, 1n)).toThrow('align exactly')
    expect(humanPriceToNative('125', 6, 6, 5n)).toBe(125n)
    expect(() => humanPriceToNative('126', 6, 6, 5n)).toThrow('align exactly')
    expect(() =>
      humanPriceToNative(1.25 as unknown as string, 6, 6, 1n),
    ).toThrow('decimal price')
    expect(() => humanPriceToNative('1e3', 6, 6, 1n)).toThrow('decimal price')
    expect(() => humanPriceToNative('0', 6, 6, 1n)).toThrow('positive')
    expect(() => humanPriceToNative('1', 256, 6, 1n)).toThrow('decimals')
    expect(() =>
      humanPriceToNative((U64_MAX + 1n).toString(), 6, 6, 1n),
    ).toThrow('uint64')
  })

  it('preserves nonterminating rational prices without rounding display decimals', () => {
    const units = {
      pricingVersion: 1 as const,
      priceDenominator: 3n,
      lotSize: 3n,
    }
    expect(nativePriceRational(1n, 6, 6, units)).toEqual({
      numerator: 1n,
      denominator: 3n,
    })
    expect(() => nativePriceToHuman(1n, 6, 6, units)).toThrow('terminating')
    expect(nativePriceToHuman(0n, 6, 6, units)).toBe('0')
    expect(nativePriceToHuman(3n, 6, 6, units)).toBe('1')
    expect(nativePriceToHuman(1n, 6, 8)).toBe('0.01')
  })

  it('rejects inexact raw quantities, lot misalignment, and uint256 overflow', () => {
    const units = {
      pricingVersion: 1 as const,
      priceDenominator: 2n,
      lotSize: 4n,
    }
    expect(() => rawToCanonicalQuantity(3n, units)).toThrow('align exactly')
    expect(() => rawToCanonicalQuantity(2n, units)).toThrow('align exactly')
    expect(() => canonicalToRawQuantity(1n, units)).toThrow('align exactly')
    expect(() => canonicalToRawQuantity(U256_MAX, units)).toThrow('uint256')
    expect(() => quoteNotional(2n, U256_MAX)).toThrow('uint256')
    expect(() => quoteNotional(U64_MAX + 1n, 1n)).toThrow('uint64')
    expect(() => rawToCanonicalQuantity(-1n)).toThrow('uint256')
    expect(() => rawToCanonicalQuantity(U256_MAX + 1n)).toThrow('uint256')
    expect(quoteNotional(U64_MAX, 1n)).toBe(U64_MAX)
    expect(quoteNotional(1n, U256_MAX)).toBe(U256_MAX)
  })

  it('sums per-fill quote amounts independently of a truncated average', () => {
    expect(quoteNotional(1n, 1n) + quoteNotional(2n, 1n)).toBe(3n)
    const units = {
      pricingVersion: 1 as const,
      priceDenominator: 10n,
      lotSize: 10n,
    }
    expect(quoteNotional(1n, 10n, units) + quoteNotional(2n, 10n, units)).toBe(
      3n,
    )
  })

  it('binds identity to the reviewed domain, tokens, type, version and big-endian D', () => {
    const base = `0x${'11'.repeat(20)}` as const
    const quote = `0x${'22'.repeat(20)}` as const
    const pricing = {
      pricingVersion: 1 as const,
      priceDenominator: 1_000_000_000_000n,
    }
    const id = derivePricedMarketId(base, quote, 0, pricing)
    expect(id).toBe(
      '0xcf6451844c9f1d402a95a6e57a066bfe7bbae2a31b2f791cff824679f9cbc61f',
    )
    expect(derivePricedMarketId(base, quote, 1, pricing)).not.toBe(id)
    expect(derivePricedMarketId(quote, base, 0, pricing)).not.toBe(id)
    expect(
      derivePricedMarketId(base, quote, 0, {
        ...pricing,
        priceDenominator: 1n,
      }),
    ).not.toBe(id)
    expect(() =>
      derivePricedMarketId(base, quote, 0, LEGACY_MARKET_PRICING),
    ).toThrow('version 1')
    expect(() => derivePricedMarketId(base, quote, 2 as 0, pricing)).toThrow(
      'market type',
    )
    expect(() =>
      derivePricedMarketId(`0x${'1'.repeat(39)}`, quote, 0, pricing),
    ).toThrow('20 bytes')
    expect(() => derivePricedMarketId('0x11', quote, 0, pricing)).toThrow(
      '20 bytes',
    )
  })
})
