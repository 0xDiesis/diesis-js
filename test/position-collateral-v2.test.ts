import { describe, expect, it } from 'vitest'
import {
  encodeExchangeActionBatchV2,
  decodeExchangeActionBatchV2,
  exchangeActionBatchV2AdmissionWork,
} from '../src/exchange/actions-v2.js'
import { exchangeActionScopeV2 } from '../src/exchange/session-keys.js'

const action = (collateralDelta: bigint) => ({
  kind: 'adjustPositionCollateral' as const,
  clientActionId: `0x${'11'.repeat(16)}` as const,
  marketId: `0x${'22'.repeat(32)}` as const,
  collateralDelta,
})

describe('position collateral V2 wire', () => {
  it('requires its own explicit session action bit', () => {
    expect(exchangeActionScopeV2(['adjustPositionCollateral'])).toBe(1n << 10n)
    expect(exchangeActionScopeV2(['place'])).toBe(1n << 1n)
  })
  it.each([-(1n << 255n), -1n, 1n, (1n << 255n) - 1n])(
    'roundtrips signed boundary %s',
    (collateralDelta) => {
      const batch = {
        atomicity: 'atomicAll' as const,
        actions: [action(collateralDelta)],
      }
      const encoded = encodeExchangeActionBatchV2(batch)
      expect((encoded.length - 2) / 2).toBe(96)
      expect(encoded.slice(26, 34)).toBe('0a000054')
      if (collateralDelta === -1n) {
        expect(encoded).toBe(
          `0x4458413202000000000100000a000054${'11'.repeat(16)}${'22'.repeat(32)}${'ff'.repeat(32)}`,
        )
      }
      expect(decodeExchangeActionBatchV2(encoded)).toEqual(batch)
      const work = exchangeActionBatchV2AdmissionWork(batch)
      expect(work.economicLogs).toBe(1)
      expect(work.totalLogBytes).toBe(512)
    },
  )

  it.each([0n, 1n << 255n, -(1n << 255n) - 1n])(
    'rejects invalid signed delta %s',
    (collateralDelta) => {
      expect(() =>
        encodeExchangeActionBatchV2({
          atomicity: 'atomicAll',
          actions: [action(collateralDelta)],
        }),
      ).toThrow()
    },
  )

  it('rejects zero and malformed lengths during decode', () => {
    const encoded = encodeExchangeActionBatchV2({
      atomicity: 'atomicAll',
      actions: [action(1n)],
    })
    const zero = `${encoded.slice(0, -64)}${'00'.repeat(32)}` as `0x${string}`
    expect(() => decodeExchangeActionBatchV2(zero)).toThrow(/nonzero/)
    const wrongLength =
      `${encoded.slice(0, 30)}53${encoded.slice(32)}` as `0x${string}`
    expect(() => decodeExchangeActionBatchV2(wrongLength)).toThrow()
    expect(() => decodeExchangeActionBatchV2(`${encoded}00`)).toThrow()
  })
})
