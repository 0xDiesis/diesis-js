import { describe, expect, it } from 'vitest'
import { decodeFunctionData, type Hex } from 'viem'
import {
  encodeBoundSessionBatch,
  decodeBoundSessionBatch,
  prepareBoundSessionActionsTransaction,
  type PrepareBoundSessionActionsParameters,
} from '../src/index.js'
import { IDiesisSpotBookAbi } from '../src/abi/bindings/viem/index.js'

const parameters: PrepareBoundSessionActionsParameters = {
  principal: `0x${'11'.repeat(20)}`,
  sessionKey: `0x${'22'.repeat(20)}`,
  authorizationGeneration: 7n,
  book: 'spot',
  limits: { version: 3, maxEncodedBytes: 16384n, bindingCheckGas: 1000n },
  batch: {
    atomicity: 'atomicAll',
    actions: [
      {
        kind: 'cancelByOrderId',
        clientActionId: `0x${'33'.repeat(16)}`,
        marketId: `0x${'44'.repeat(32)}`,
        orderId: `0x${'55'.repeat(32)}`,
      },
    ],
  },
}

describe('bound-session source consumers', () => {
  it('encodes exact principal and big-endian generation before canonical DXA2', () => {
    const encoded = encodeBoundSessionBatch(parameters, parameters.limits)
    expect(encoded.slice(0, 74)).toBe(
      `0x44585333${'11'.repeat(20)}000000000000000744584132`,
    )
    expect(decodeBoundSessionBatch(encoded, parameters.limits)).toEqual({
      principal: parameters.principal,
      authorizationGeneration: 7n,
      batch: parameters.batch,
    })
    const prepared = prepareBoundSessionActionsTransaction(parameters)
    expect(
      decodeFunctionData({ abi: IDiesisSpotBookAbi, data: prepared.data }),
    ).toEqual({ functionName: 'submitBoundSessionActions', args: [encoded] })
  })

  it('refuses oversized wrappers and malformed or unbound headers', () => {
    const encoded = encodeBoundSessionBatch(parameters, parameters.limits)
    expect(() =>
      encodeBoundSessionBatch(parameters, {
        ...parameters.limits,
        maxEncodedBytes: 32n,
      }),
    ).toThrow(/byte limit/)
    for (const invalid of [
      '0x',
      '0x0',
      `0x44584132${encoded.slice(10)}`,
      `0x44585333${'00'.repeat(20)}${encoded.slice(50)}`,
    ])
      expect(() =>
        decodeBoundSessionBatch(invalid as Hex, parameters.limits),
      ).toThrow()
    for (const authorizationGeneration of [0n, 1n << 64n])
      expect(() =>
        encodeBoundSessionBatch(
          { ...parameters, authorizationGeneration },
          parameters.limits,
        ),
      ).toThrow(/positive uint64/)
  })

  it('keeps pricing version one behind native qualification', () => {
    const priced: PrepareBoundSessionActionsParameters = {
      ...parameters,
      batch: {
        atomicity: 'atomicAll',
        actions: [
          {
            kind: 'place',
            clientActionId: `0x${'33'.repeat(16)}`,
            marketId: `0x${'44'.repeat(32)}`,
            side: 'buy',
            orderKind: 'limit',
            timeInForce: { kind: 'gtc' },
            postOnly: false,
            reduceOnly: false,
            pricingVersion: 1,
            marginType: 'cross',
            priceTicks: 10n,
            quantityLots: 1n,
            maxFills: 1,
            maxPriceLevels: 1,
          },
        ],
      },
    }
    expect(() => prepareBoundSessionActionsTransaction(priced)).toThrow(
      /qualified native admission/,
    )
  })
})
