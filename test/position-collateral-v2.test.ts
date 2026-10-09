import { describe, expect, it } from 'vitest'
import {
  encodeExchangeActionBatch,
  decodeExchangeActionBatch,
  exchangeActionBatchAdmissionWork,
} from '../src/exchange/actions-v2.js'
import { exchangeActionScope } from '../src/exchange/session-keys.js'

const action = (collateralDelta: bigint) => ({
  kind: 'adjustPositionCollateral' as const,
  clientActionId: `0x${'11'.repeat(16)}` as const,
  marketId: `0x${'22'.repeat(32)}` as const,
  collateralDelta,
})

describe('position collateral V2 wire', () => {
  it('requires its own explicit session action bit', () => {
    expect(exchangeActionScope(['adjustPositionCollateral'])).toBe(1n << 10n)
    expect(exchangeActionScope(['place'])).toBe(1n << 1n)
  })
  it.each([-(1n << 255n), -1n, 1n, (1n << 255n) - 1n])(
    'roundtrips signed boundary %s',
    (collateralDelta) => {
      const batch = {
        atomicity: 'atomicAll' as const,
        actions: [action(collateralDelta)],
      }
      const encoded = encodeExchangeActionBatch(batch)
      expect((encoded.length - 2) / 2).toBe(96)
      expect(encoded.slice(26, 34)).toBe('0a000054')
      if (collateralDelta === -1n) {
        expect(encoded).toBe(
          `0x4458413202000000000100000a000054${'11'.repeat(16)}${'22'.repeat(32)}${'ff'.repeat(32)}`,
        )
      }
      expect(decodeExchangeActionBatch(encoded)).toEqual(batch)
      const work = exchangeActionBatchAdmissionWork(batch)
      expect(work.economicLogs).toBe(1)
      expect(work.totalLogBytes).toBe(512)
    },
  )

  it.each([0n, 1n << 255n, -(1n << 255n) - 1n])(
    'rejects invalid signed delta %s',
    (collateralDelta) => {
      expect(() =>
        encodeExchangeActionBatch({
          atomicity: 'atomicAll',
          actions: [action(collateralDelta)],
        }),
      ).toThrow()
    },
  )

  it('rejects zero and malformed lengths during decode', () => {
    const encoded = encodeExchangeActionBatch({
      atomicity: 'atomicAll',
      actions: [action(1n)],
    })
    const zero = `${encoded.slice(0, -64)}${'00'.repeat(32)}` as `0x${string}`
    expect(() => decodeExchangeActionBatch(zero)).toThrow(/nonzero/)
    const wrongLength =
      `${encoded.slice(0, 30)}53${encoded.slice(32)}` as `0x${string}`
    expect(() => decodeExchangeActionBatch(wrongLength)).toThrow()
    expect(() => decodeExchangeActionBatch(`${encoded}00`)).toThrow()
  })
})
