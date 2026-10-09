import { createPublicClient, custom } from 'viem'
import { describe, expect, it } from 'vitest'
import { exchangePublicActions } from '../src/exchange/index.js'

const user = '0x1111111111111111111111111111111111111111' as const
const marketId = `0x${'22'.repeat(32)}` as const

describe('canonical position collateral capability read', () => {
  it('requests the owner and market and preserves unavailable amounts', async () => {
    const requests: unknown[] = []
    const unavailable = {
      capabilityVersion: 1,
      active: false,
      eligible: false,
      user,
      marketId,
      quoteToken: user,
      side: null,
      size: null,
      currentClaim: null,
      addableCollateral: null,
      withdrawableCollateral: null,
      unavailableReason: 'runtime_inactive',
    }
    const client = createPublicClient({
      transport: custom({
        request: async (request) => {
          requests.push(request)
          return unavailable
        },
      }),
    }).extend(exchangePublicActions)
    await expect(
      client.exchange.getPositionCollateral({ user, marketId }),
    ).resolves.toEqual(unavailable)
    expect(requests).toEqual([
      { method: 'exchange_getPositionCollateral', params: [user, marketId] },
    ])
  })
  it('propagates unsupported runtime errors without manufacturing a balance', async () => {
    const client = createPublicClient({
      transport: custom(
        {
          request: async () => {
            throw new Error('method unavailable')
          },
        },
        { retryCount: 0 },
      ),
    }).extend(exchangePublicActions)
    await expect(
      client.exchange.getPositionCollateral({ user, marketId }),
    ).rejects.toThrow('method unavailable')
  })
})
