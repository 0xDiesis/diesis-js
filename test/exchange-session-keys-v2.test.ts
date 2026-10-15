import { describe, expect, it } from 'vitest'
import { decodeFunctionData, type Hex } from 'viem'

import { IDiesisSettlementAbi } from '../src/abi/index.js'
import * as exchange from '../src/exchange/index.js'

const principal = '0x1111111111111111111111111111111111111111'
const sessionKey = '0x2222222222222222222222222222222222222222'
const terms = {
  actionScope: 0x22an,
  validUntil: 4_000n,
  maxNotionalOrSpend: 123_456n,
  allowedMarketsMask: `0x${'0f'.repeat(32)}` as Hex,
}
const words =
  '000000000000000000000000000000000000000000000000000000000000022a' +
  '0000000000000000000000000000000000000000000000000000000000000fa0' +
  '000000000000000000000000000000000000000000000000000000000001e240' +
  '0f'.repeat(32)

function expected(data: Hex) {
  return { to: '0xd1e5150000000000000000000000000000005e71', value: 0n, data }
}

describe('canonical exchange session-key V2 consent transactions', () => {
  it('uses only the three current generated settlement entries', () => {
    const names = [
      'acceptSessionKeyV2',
      'authorizeSessionKeyV2',
      'revokeSessionKeyV2',
    ]
    expect(exchange.ExchangeSessionKeysAbi).toHaveLength(names.length)
    for (const [index, name] of names.entries()) {
      const generated = IDiesisSettlementAbi.find(
        (item) => item.type === 'function' && item.name === name,
      )
      expect(generated).toBeDefined()
      expect(exchange.ExchangeSessionKeysAbi[index]).toBe(generated)
    }
  })

  it('encodes key-called acceptance for the exact principal and terms', () => {
    const request = exchange.prepareAcceptSessionKeyV2Transaction({
      principal,
      ...terms,
    })
    expect(request).toEqual(
      expected(`0xca2bba63${'0'.repeat(24)}${principal.slice(2)}${words}`),
    )
    expect(
      decodeFunctionData({ abi: IDiesisSettlementAbi, data: request.data }),
    ).toEqual({
      functionName: 'acceptSessionKeyV2',
      args: [principal, ...Object.values(terms)],
    })
  })

  it('encodes principal-called activation with identical terms', () => {
    expect(
      exchange.prepareAuthorizeSessionKeyV2Transaction({
        sessionKey,
        ...terms,
      }),
    ).toEqual(
      expected(`0xd1df736a${'0'.repeat(24)}${sessionKey.slice(2)}${words}`),
    )
  })

  it('encodes principal or key revocation and key consent cancellation with the same current selector', () => {
    const request = expected(
      `0xa8163070${'0'.repeat(24)}${sessionKey.slice(2)}`,
    )
    expect(
      exchange.prepareRevokeSessionKeyV2Transaction({ sessionKey }),
    ).toEqual(request)
    expect(
      exchange.prepareCancelSessionKeyConsentV2Transaction({ sessionKey }),
    ).toEqual(request)
  })

  it('routes existing unversioned helpers to the hardened V2 selectors', () => {
    expect(
      exchange.prepareAuthorizeSessionKeyTransaction({ sessionKey, ...terms }),
    ).toEqual(
      expected(`0xd1df736a${'0'.repeat(24)}${sessionKey.slice(2)}${words}`),
    )
    expect(exchange.prepareRevokeSessionKeyTransaction({ sessionKey })).toEqual(
      expected(`0xa8163070${'0'.repeat(24)}${sessionKey.slice(2)}`),
    )
  })

  it('retains the canonical action bitmap under both exported scope names', () => {
    const actions = [
      'place',
      'cancelByClientOrderId',
      'cancelMarketChunk',
      'triggerCancelSchedule',
    ] as const
    expect(exchange.exchangeActionScope(actions)).toBe(terms.actionScope)
    expect(exchange.exchangeActionScopeV2(actions)).toBe(terms.actionScope)
    expect(exchange.exchangeActionScope(['adjustPositionCollateral'])).toBe(
      1n << 10n,
    )
    expect(() => exchange.exchangeActionScope([])).toThrow(/nonempty/)
    expect(() => exchange.exchangeActionScope(['unknown' as never])).toThrow(
      /unknown action/,
    )
  })

  it.each([
    ['actionScope', 0n, /actionScope/],
    ['actionScope', 1n, /actionScope/],
    ['actionScope', 1n << 11n, /actionScope/],
    ['actionScope', 1n << 256n, /actionScope/],
    ['actionScope', 2, /actionScope/],
    ['validUntil', 0n, /validUntil/],
    ['validUntil', 1n << 64n, /validUntil/],
    ['validUntil', 4000, /validUntil/],
    ['maxNotionalOrSpend', -1n, /maxNotionalOrSpend/],
    ['maxNotionalOrSpend', 1n << 256n, /maxNotionalOrSpend/],
    ['maxNotionalOrSpend', 0, /maxNotionalOrSpend/],
    ['allowedMarketsMask', '0x00', /allowedMarketsMask/],
    ['allowedMarketsMask', `0x${'gg'.repeat(32)}`, /allowedMarketsMask/],
  ])(
    'rejects malformed %s %s in acceptance and activation',
    (field, value, message) => {
      const invalid = { ...terms, [field]: value }
      expect(() =>
        exchange.prepareAcceptSessionKeyV2Transaction({
          principal,
          ...invalid,
        } as never),
      ).toThrow(message)
      expect(() =>
        exchange.prepareAuthorizeSessionKeyV2Transaction({
          sessionKey,
          ...invalid,
        } as never),
      ).toThrow(message)
    },
  )

  it('rejects invalid principal and key addresses before preparing calldata', () => {
    for (const address of [
      '0x00',
      `0x${'00'.repeat(20)}`,
      `0x${'gg'.repeat(20)}`,
    ] as const) {
      expect(() =>
        exchange.prepareAcceptSessionKeyV2Transaction({
          principal: address,
          ...terms,
        }),
      ).toThrow(/principal/)
      expect(() =>
        exchange.prepareAuthorizeSessionKeyV2Transaction({
          sessionKey: address,
          ...terms,
        }),
      ).toThrow(/sessionKey/)
      expect(() =>
        exchange.prepareRevokeSessionKeyV2Transaction({ sessionKey: address }),
      ).toThrow(/sessionKey/)
      expect(() =>
        exchange.prepareCancelSessionKeyConsentV2Transaction({
          sessionKey: address,
        }),
      ).toThrow(/sessionKey/)
    }
  })

  it('accepts uncapped spend, empty market grants and maximum ABI bounds', () => {
    const boundaryTerms = {
      actionScope: 0x7fen,
      validUntil: (1n << 64n) - 1n,
      maxNotionalOrSpend: 0n,
      allowedMarketsMask: `0x${'00'.repeat(32)}` as Hex,
    }
    expect(() =>
      exchange.prepareAcceptSessionKeyV2Transaction({
        principal,
        ...boundaryTerms,
      }),
    ).not.toThrow()
    expect(() =>
      exchange.prepareAuthorizeSessionKeyV2Transaction({
        sessionKey,
        ...boundaryTerms,
      }),
    ).not.toThrow()
    expect(() =>
      exchange.prepareAuthorizeSessionKeyV2Transaction({
        sessionKey,
        ...boundaryTerms,
        maxNotionalOrSpend: (1n << 256n) - 1n,
        allowedMarketsMask: `0x${'ff'.repeat(32)}`,
      }),
    ).not.toThrow()
  })
})
