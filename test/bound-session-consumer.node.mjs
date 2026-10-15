import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeFunctionData } from 'viem'
import * as root from '@diesis/sdk'
import * as exchange from '@diesis/sdk/exchange'
import * as viem from '@diesis/sdk/abi/viem'

const principal = `0x${'11'.repeat(20)}`
const sessionKey = `0x${'22'.repeat(20)}`
const limits = { version: 3, maxEncodedBytes: 16384n, bindingCheckGas: 1000n }
const batch = {
  atomicity: 'atomicAll',
  actions: [
    {
      kind: 'cancelByOrderId',
      clientActionId: `0x${'33'.repeat(16)}`,
      marketId: `0x${'44'.repeat(32)}`,
      orderId: `0x${'55'.repeat(32)}`,
    },
  ],
}
const parameters = {
  principal,
  sessionKey,
  authorizationGeneration: 7n,
  batch,
  limits,
}

test('built root and Exchange preserve offline DXS3 principal/generation and refuse unavailable submission', () => {
  for (const name of [
    'encodeBoundSessionBatch',
    'decodeBoundSessionBatch',
    'prepareBoundSessionActionsTransaction',
  ])
    assert.equal(root[name], exchange[name])
  const encoded = root.encodeBoundSessionBatch(parameters, limits)
  assert.equal(
    encoded.slice(0, 66),
    `0x44585333${principal.slice(2)}0000000000000007`,
  )
  assert.deepEqual(exchange.decodeBoundSessionBatch(encoded, limits), {
    principal,
    authorizationGeneration: 7n,
    batch,
  })
  for (const [book, contract] of [
    ['spot', viem.diesisContracts.spotBook],
    ['perpetual', viem.diesisContracts.perpsBook],
  ]) {
    assert.equal(
      contract.abi.some(
        (item) =>
          item.type === 'function' && item.name === 'submitBoundSessionActions',
      ),
      false,
    )
    assert.throws(
      () =>
        exchange.prepareBoundSessionActionsTransaction({ ...parameters, book }),
      /bound-session submission is unavailable/,
    )
  }
})

test('built consumers refuse invalid binding and legacy wire without signing or transport', () => {
  for (const generation of [0n, 1n << 64n])
    assert.throws(
      () =>
        root.encodeBoundSessionBatch(
          { ...parameters, authorizationGeneration: generation },
          limits,
        ),
      /positive uint64/,
    )
  assert.throws(
    () =>
      root.encodeBoundSessionBatch(
        { ...parameters, principal: `0x${'00'.repeat(20)}` },
        limits,
      ),
    /nonzero/,
  )
  assert.throws(
    () =>
      root.decodeBoundSessionBatch(
        root.encodeExchangeActionBatch(batch),
        limits,
      ),
    /DXS3 magic/,
  )
  assert.throws(
    () =>
      root.encodeBoundSessionBatch(parameters, {
        ...limits,
        maxEncodedBytes: 32n,
      }),
    /byte limit/,
  )
  assert.throws(
    () =>
      root.prepareBoundSessionActionsTransaction({
        ...parameters,
        book: 'spot',
        sessionKey: principal,
      }),
    /distinct/,
  )
})

test('built root and Exchange expose the complete V2 consent lifecycle without retired selectors', () => {
  const terms = {
    actionScope: exchange.exchangeActionScopeV2(['cancelByOrderId']),
    validUntil: 4_000n,
    maxNotionalOrSpend: 0n,
    allowedMarketsMask: `0x${'ff'.repeat(32)}`,
  }
  for (const [name, parameters, method, args, selector] of [
    [
      'prepareAcceptSessionKeyV2Transaction',
      { principal, ...terms },
      'acceptSessionKeyV2',
      [principal, ...Object.values(terms)],
      '0xca2bba63',
    ],
    [
      'prepareAuthorizeSessionKeyV2Transaction',
      { sessionKey, ...terms },
      'authorizeSessionKeyV2',
      [sessionKey, ...Object.values(terms)],
      '0xd1df736a',
    ],
    [
      'prepareRevokeSessionKeyV2Transaction',
      { sessionKey },
      'revokeSessionKeyV2',
      [sessionKey],
      '0xa8163070',
    ],
    [
      'prepareCancelSessionKeyConsentV2Transaction',
      { sessionKey },
      'revokeSessionKeyV2',
      [sessionKey],
      '0xa8163070',
    ],
    [
      'prepareAuthorizeSessionKeyTransaction',
      { sessionKey, ...terms },
      'authorizeSessionKeyV2',
      [sessionKey, ...Object.values(terms)],
      '0xd1df736a',
    ],
    [
      'prepareRevokeSessionKeyTransaction',
      { sessionKey },
      'revokeSessionKeyV2',
      [sessionKey],
      '0xa8163070',
    ],
  ]) {
    assert.equal(typeof root[name], 'function', name)
    assert.equal(root[name], exchange[name])
    const request = root[name](parameters)
    assert.equal(request.to, viem.diesisContracts.settlement.address)
    assert.equal(request.value, 0n)
    assert.equal(request.data.slice(0, 10), selector)
    assert.deepEqual(
      decodeFunctionData({
        abi: viem.diesisContracts.settlement.abi,
        data: request.data,
      }),
      { functionName: method, args },
    )
  }
})
