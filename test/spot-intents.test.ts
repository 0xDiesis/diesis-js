import { hashTypedData, recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  CANCEL_ALL_SPOT_INTENT_TYPES,
  buildSignedCancelAllSpotIntent,
  cancelAllDigest,
  getCancelAllSpotIntentTypedData,
  getCancelAllTypedData,
  signCancelAllSpotIntent,
  type CancelAllSpotIntent,
} from '../src/exchange/cancel-all.js'
import {
  assertStopOrderPrices,
  encodeTriggerSpotStops,
} from '../src/exchange/stops.js'
import { OrderType } from '../src/exchange/types.js'
import {
  ORDER_INTENT_TYPES,
  getOrderIntentDomain,
} from '../src/intents/signing.js'
import {
  CANCEL_INTENT_TYPES,
  buildSignedCancelIntent,
  getCancelIntentTypedData,
  signCancelIntent,
  type CancelIntent,
} from '../src/intents/cancel.js'
import { DIESIS_SPOT_BOOK } from '../src/addresses.js'
import * as exchangeBarrel from '../src/exchange/index.js'
import * as intentBarrel from '../src/intents/index.js'
import * as packageRoot from '../src/index.js'

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

  it('preserves the compatibility typed-data argument order and field order', () => {
    const verifyingContract =
      '0xd1e515000000000000000000000000000000590d' as const
    const intent: CancelAllSpotIntent = {
      trader: TRADER,
      marketId: MARKET_ID,
      expiry: 99_999_999_999n,
      nonce: 12n,
    }

    const typedData = getCancelAllSpotIntentTypedData(
      intent,
      verifyingContract,
      19_803,
    )

    expect(typedData.domain).toEqual({
      name: 'Diesis Exchange',
      version: '2',
      chainId: 19_803,
      verifyingContract,
    })
    expect(typedData.primaryType).toBe('CancelAllSpotIntent')
    expect(typedData.types).toBe(CANCEL_ALL_SPOT_INTENT_TYPES)
    expect(typedData.types.CancelAllSpotIntent).toEqual([
      { name: 'trader', type: 'address' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'expiry', type: 'uint64' },
      { name: 'nonce', type: 'uint256' },
    ])
    expect(typedData.message).toBe(intent)
  })

  it('builds and signs a validated cancel-all intent with a local account', async () => {
    const account = privateKeyToAccount(`0x${'ef'.repeat(32)}`)
    const verifyingContract =
      '0xd1e515000000000000000000000000000000590d' as const
    const intent: CancelAllSpotIntent = {
      trader: account.address,
      marketId: MARKET_ID,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: 4n,
    }

    const signed = await buildSignedCancelAllSpotIntent({
      account,
      intent,
      verifyingContract,
      chainId: 19_803,
    })
    const recovered = await recoverTypedDataAddress({
      ...getCancelAllSpotIntentTypedData(intent, verifyingContract, 19_803),
      signature: signed.signature,
    })

    expect(recovered).toBe(account.address)
    expect(signed).toEqual({
      intent,
      signature: signed.signature,
      signer: account.address,
    })
  })

  it.each([
    [
      'trader',
      {
        trader: 'not-an-address',
        marketId: MARKET_ID,
        expiry: 99_999_999_999n,
        nonce: 1n,
      },
    ],
    [
      'marketId',
      {
        trader: TRADER,
        marketId: '0x1234',
        expiry: 99_999_999_999n,
        nonce: 1n,
      },
    ],
    [
      'expiry',
      {
        trader: TRADER,
        marketId: MARKET_ID,
        nonce: 1n,
      },
    ],
    [
      'nonce',
      {
        trader: TRADER,
        marketId: MARKET_ID,
        expiry: 99_999_999_999n,
      },
    ],
  ])('rejects invalid cancel-all %s before signing', async (field, intent) => {
    const account = privateKeyToAccount(`0x${'ef'.repeat(32)}`)
    await expect(
      buildSignedCancelAllSpotIntent({
        account,
        // @ts-expect-error intentionally malformed compatibility input
        intent,
        verifyingContract: DIESIS_SPOT_BOOK,
      }),
    ).rejects.toThrow(new RegExp(field, 'i'))
  })

  it('rejects an already-expired cancel-all intent before signing', async () => {
    const account = privateKeyToAccount(`0x${'ef'.repeat(32)}`)
    await expect(
      buildSignedCancelAllSpotIntent({
        account,
        verifyingContract: DIESIS_SPOT_BOOK,
        intent: {
          trader: account.address,
          marketId: MARKET_ID,
          expiry: BigInt(Math.floor(Date.now() / 1000) - 60),
          nonce: 5n,
        },
      }),
    ).rejects.toThrow(/expired|past/i)
  })
})

describe('single-order cancel intent', () => {
  it('preserves the canonical EIP-712 field order and recovers its signer', async () => {
    const account = privateKeyToAccount(`0x${'ab'.repeat(32)}`)
    const intent: CancelIntent = {
      trader: account.address,
      nonce: 3n,
    }

    expect(CANCEL_INTENT_TYPES.CancelIntent).toEqual([
      { name: 'trader', type: 'address' },
      { name: 'nonce', type: 'uint256' },
    ])

    const signed = await signCancelIntent(account, intent)
    const recovered = await recoverTypedDataAddress({
      ...getCancelIntentTypedData(intent),
      signature: signed.signature,
    })

    expect(recovered).toBe(account.address)
    expect(signed).toEqual({
      intent,
      signature: signed.signature,
      signer: account.address,
    })
  })

  it('builds and signs a validated cancel intent with a local account', async () => {
    const account = privateKeyToAccount(`0x${'ab'.repeat(32)}`)
    const verifyingContract =
      '0xd1e515000000000000000000000000000000590d' as const
    const intent: CancelIntent = { trader: account.address, nonce: 7n }

    const signed = await buildSignedCancelIntent({
      account,
      intent,
      verifyingContract,
      chainId: 19_803,
    })
    const recovered = await recoverTypedDataAddress({
      ...getCancelIntentTypedData(intent, 19_803, verifyingContract),
      signature: signed.signature,
    })

    expect(recovered).toBe(account.address)
    expect(signed).toEqual({
      intent,
      signature: signed.signature,
      signer: account.address,
    })
  })

  it.each([
    ['trader', { nonce: 1n }],
    ['nonce', { trader: TRADER }],
  ])(
    'rejects invalid single-cancel %s before signing',
    async (field, intent) => {
      const account = privateKeyToAccount(`0x${'ab'.repeat(32)}`)
      await expect(
        buildSignedCancelIntent({
          account,
          // @ts-expect-error intentionally malformed compatibility input
          intent,
          verifyingContract: DIESIS_SPOT_BOOK,
        }),
      ).rejects.toThrow(new RegExp(field, 'i'))
    },
  )
})

describe('cancel compatibility exports', () => {
  it('forwards builders through their barrels without replacing canonical signers', () => {
    expect(intentBarrel.buildSignedCancelIntent).toBe(buildSignedCancelIntent)
    expect(exchangeBarrel.buildSignedCancelAllSpotIntent).toBe(
      buildSignedCancelAllSpotIntent,
    )
    expect(exchangeBarrel.getCancelAllSpotIntentTypedData).toBe(
      getCancelAllSpotIntentTypedData,
    )
    expect(packageRoot.buildSignedCancelIntent).toBe(buildSignedCancelIntent)
    expect(packageRoot.buildSignedCancelAllSpotIntent).toBe(
      buildSignedCancelAllSpotIntent,
    )
    expect(packageRoot.getCancelAllSpotIntentTypedData).toBe(
      getCancelAllSpotIntentTypedData,
    )
    expect(packageRoot.signCancelIntent).toBe(signCancelIntent)
    expect(packageRoot.signCancelAllSpotIntent).toBe(signCancelAllSpotIntent)
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
    expect(() =>
      assertStopOrderPrices(OrderType.StopLimit, 0n, 4900n),
    ).toThrow()
    expect(() =>
      assertStopOrderPrices(OrderType.StopLimit, 5000n, 0n),
    ).toThrow()
    expect(() => assertStopOrderPrices(OrderType.Limit, 5000n, 4900n)).toThrow()
    expect(() =>
      assertStopOrderPrices(OrderType.StopMarket, 0n, 4900n),
    ).not.toThrow()
  })

  it('builds triggerSpotStops calldata', () => {
    const calldata = encodeTriggerSpotStops(MARKET_ID, 16)
    expect(calldata.startsWith('0x')).toBe(true)
    expect(calldata.length).toBeGreaterThan(10)
  })
})
