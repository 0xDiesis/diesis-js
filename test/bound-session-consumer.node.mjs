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

test('built root and Exchange preserve DXS3 principal/generation and generated viem calldata', () => {
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
    const prepared = exchange.prepareBoundSessionActionsTransaction({
      ...parameters,
      book,
    })
    assert.equal(prepared.to, contract.address)
    assert.equal(prepared.value, 0n)
    assert.deepEqual(
      decodeFunctionData({ abi: contract.abi, data: prepared.data }),
      { functionName: 'submitBoundSessionActions', args: [encoded] },
    )
    const method = contract.abi.find(
      (item) =>
        item.type === 'function' && item.name === 'submitBoundSessionActions',
    )
    assert.equal(method.stateMutability, 'nonpayable')
    assert.deepEqual(
      method.outputs.map(({ type }) => type),
      ['bytes32', 'uint16', 'uint16'],
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
