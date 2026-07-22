import { hashTypedData, recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  cancelAllDigest,
  getCancelAllTypedData,
  signCancelAllSpotIntent,
  type CancelAllSpotIntent,
} from '../src/exchange/cancel-all.js'
import { assertStopOrderPrices, encodeTriggerSpotStops } from '../src/exchange/stops.js'
import { OrderType } from '../src/exchange/types.js'
import { ORDER_INTENT_TYPES, getOrderIntentDomain } from '../src/intents/signing.js'
import { DIESIS_SPOT_BOOK } from '../src/addresses.js'

const TRADER = '0x00000000000000000000000000000000000000AA' as const
const MARKET_ID = `0x${'22'.repeat(32)}` as const

describe('cancel-all spot intent', () => {
  it('reproduces the shared EIP-712 digest vector', () => {
    const intent: CancelAllSpotIntent = {
      trader: TRADER,
      marketId: MARKET_ID,
      expiry: 0n,
      nonce: 10n,
    }
    expect(cancelAllDigest(intent, 1980, DIESIS_SPOT_BOOK)).toBe(
      '0xb255e856ada29ff3027cc87677dec35a7fc56ede829135704f186c8f30177ad4',
    )
  })

  it('signs into an { intent, signature } envelope the signer recovers from', async () => {
    const account = privateKeyToAccount(`0x${'cd'.repeat(32)}`)
    const intent: CancelAllSpotIntent = {
      trader: account.address,
      marketId: MARKET_ID,
      expiry: 0n,
      nonce: 3n,
    }
    const signed = await signCancelAllSpotIntent(account, intent)
    const recovered = await recoverTypedDataAddress({
      ...getCancelAllTypedData(intent),
      signature: signed.signature,
    })
    expect(recovered).toBe(account.address)
    expect(signed.intent).toBe(intent)
  })
})

describe('stop orders', () => {
  it('reproduces the shared stop-limit OrderIntent digest vector', () => {
    const digest = hashTypedData({
      domain: getOrderIntentDomain(1980, DIESIS_SPOT_BOOK),
      types: ORDER_INTENT_TYPES,
      primaryType: 'OrderIntent',
      message: {
        trader: TRADER,
        marketId: MARKET_ID,
        side: 0,
        orderType: OrderType.StopLimit,
        price: 5000n,
        amount: 100n,
        triggerPrice: 4900n,
        expiry: 0n,
        nonce: 10n,
        flags: 0,
        conductor: '0x0000000000000000000000000000000000000000',
        conductorFeeBps: 0,
        maxConductorFee: 0n,
      },
    })
    expect(digest).toBe(
      '0x17f4cc7860e79c25ed2dbc729a33002c04428bb45739ff5f4758bbae079f67a9',
    )
  })

  it('enforces the protected-stop nonzero-price rule', () => {
    expect(() => assertStopOrderPrices(OrderType.StopLimit, 0n, 4900n)).toThrow()
    expect(() => assertStopOrderPrices(OrderType.StopLimit, 5000n, 0n)).toThrow()
    expect(() => assertStopOrderPrices(OrderType.Limit, 5000n, 4900n)).toThrow()
    expect(() => assertStopOrderPrices(OrderType.StopMarket, 0n, 4900n)).not.toThrow()
  })

  it('builds triggerSpotStops calldata', () => {
    const calldata = encodeTriggerSpotStops(MARKET_ID, 16)
    expect(calldata.startsWith('0x')).toBe(true)
    expect(calldata.length).toBeGreaterThan(10)
  })
})
