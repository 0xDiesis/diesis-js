import { describe, expect, it } from 'vitest'

import { IDiesisSettlementAbi } from '../src/abi/index.js'

import {
  ExchangeSessionKeysV2Abi,
  exchangeActionScopeV2,
  prepareAuthorizeSessionKeyV2Transaction,
  prepareRevokeSessionKeyV2Transaction,
} from '../src/exchange/index.js'

describe('canonical exchange session-key V2 transactions', () => {
  it('uses the generated settlement function entries', () => {
    expect(ExchangeSessionKeysV2Abi).toHaveLength(2)
    expect(ExchangeSessionKeysV2Abi[0]).toBe(
      IDiesisSettlementAbi.find(
        (item) => item.type === 'function' && item.name === 'authorizeSessionKeyV2',
      ),
    )
    expect(ExchangeSessionKeysV2Abi[1]).toBe(
      IDiesisSettlementAbi.find(
        (item) => item.type === 'function' && item.name === 'revokeSessionKeyV2',
      ),
    )
  })

  it('matches the Task 6 frozen settlement ABI exactly', () => {
    const sessionKey = '0x2222222222222222222222222222222222222222'
    const actionScope = exchangeActionScopeV2([
      'place',
      'cancelByClientOrderId',
      'cancelMarketChunk',
      'triggerCancelSchedule',
    ])
    expect(actionScope).toBe(0x22an)

    expect(
      prepareAuthorizeSessionKeyV2Transaction({
        sessionKey,
        actionScope,
        validUntil: 4_000n,
        maxNotionalOrSpend: 123_456n,
        allowedMarketsMask: `0x${'0f'.repeat(32)}`,
      }),
    ).toEqual({
      to: '0xd1e5150000000000000000000000000000005e71',
      value: 0n,
      data: '0xd1df736a0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000022a0000000000000000000000000000000000000000000000000000000000000fa0000000000000000000000000000000000000000000000000000000000001e2400f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f',
    })
    expect(prepareRevokeSessionKeyV2Transaction({ sessionKey })).toEqual({
      to: '0xd1e5150000000000000000000000000000005e71',
      value: 0n,
      data: '0xa81630700000000000000000000000002222222222222222222222222222222222222222',
    })
  })

  it('rejects empty/unknown scopes and malformed authorization bounds', () => {
    expect(() => exchangeActionScopeV2([])).toThrow(/nonempty/)
    expect(() => exchangeActionScopeV2(['unknown' as never])).toThrow(
      /unknown action/,
    )
    expect(() =>
      prepareAuthorizeSessionKeyV2Transaction({
        sessionKey: '0x0000000000000000000000000000000000000000',
        actionScope: 2n,
        validUntil: 4_000n,
        maxNotionalOrSpend: 0n,
        allowedMarketsMask: `0x${'00'.repeat(32)}`,
      }),
    ).toThrow(/sessionKey must be nonzero/)
    expect(() =>
      prepareAuthorizeSessionKeyV2Transaction({
        sessionKey: '0x2222222222222222222222222222222222222222',
        actionScope: 0n,
        validUntil: 4_000n,
        maxNotionalOrSpend: 0n,
        allowedMarketsMask: `0x${'00'.repeat(32)}`,
      }),
    ).toThrow(/actionScope must be nonzero/)
    expect(() =>
      prepareAuthorizeSessionKeyV2Transaction({
        sessionKey: '0x2222222222222222222222222222222222222222',
        actionScope: 2n,
        validUntil: 0n,
        maxNotionalOrSpend: 0n,
        allowedMarketsMask: `0x${'00'.repeat(32)}`,
      }),
    ).toThrow(/validUntil must be a nonzero uint64/)
  })
})
