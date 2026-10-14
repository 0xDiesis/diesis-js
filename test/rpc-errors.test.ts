import { custom, RpcRequestError, UnknownRpcError } from 'viem'
import { buildRequest } from 'viem/utils'
import { describe, expect, it } from 'vitest'
import { decodeSignedActionError } from '../src/rpc-errors.js'
const data = {
  version: 1,
  kind: 'signed-action-error',
  reason: 'exchange_principal_capacity',
  retryable: false,
  admission: 'unknown',
}
describe('signed action error decoder', () => {
  it('retains structured raw and wrapped errors without granting retry authority', () => {
    const raw = { code: -32016, message: 'diagnostic', data }
    const wrapped = { message: 'viem', cause: raw }
    expect(decodeSignedActionError(wrapped)).toMatchObject({
      status: 'known',
      code: -32016,
      message: 'diagnostic',
      data,
      reason: 'exchange_principal_capacity',
      retryable: false,
      admission: 'unknown',
      cause: raw,
      original: wrapped,
    })
  })
  it.each([
    undefined,
    { ...data, version: 2 },
    { ...data, reason: 'future_reason' },
    { ...data, retryable: true },
    { ...data, admission: 'not-admitted' },
    { ...data, extra: true },
  ])('preserves unknown/malformed data %j', (value) => {
    const raw = { code: -32016, message: 'retry now', data: value }
    expect(decodeSignedActionError(raw)).toMatchObject({
      status: 'unknown',
      original: raw,
      code: -32016,
      message: 'retry now',
      data: value,
      retryable: false,
      admission: 'unknown',
    })
  })
  it('preserves transport loss and does not infer from message text', () => {
    const lost = new Error('safe to retry')
    expect(decodeSignedActionError(lost)).toMatchObject({
      status: 'unknown',
      original: lost,
      retryable: false,
      admission: 'unknown',
    })
  })
})

it('refuses code/reason disagreement, accessor data and cause cycles', () => {
  expect(
    decodeSignedActionError({ code: -32017, message: 'opaque', data }),
  ).toMatchObject({ status: 'unknown' })
  let invoked = false
  const accessor = {
    ...data,
    get reason() {
      invoked = true
      return 'exchange_principal_capacity'
    },
  }
  expect(
    decodeSignedActionError({
      code: -32016,
      message: 'opaque',
      data: accessor,
    }),
  ).toMatchObject({ status: 'unknown' })
  expect(invoked).toBe(false)
  const cycle: { cause?: unknown } = {}
  cycle.cause = cycle
  expect(decodeSignedActionError(cycle)).toMatchObject({
    status: 'unknown',
    original: cycle,
  })
})

it('refuses hidden and symbolic data fields', () => {
  const hidden = { ...data }
  Object.defineProperty(hidden, 'hidden', { value: true })
  const symbolic = { ...data, [Symbol('extra')]: true }
  expect(
    decodeSignedActionError({ code: -32016, message: 'opaque', data: hidden })
      .status,
  ).toBe('unknown')
  expect(
    decodeSignedActionError({ code: -32016, message: 'opaque', data: symbolic })
      .status,
  ).toBe('unknown')
})

it('decodes real viem UnknownRpcError while preserving original and cause', () => {
  const raw = { code: -32016, message: 'opaque diagnostic', data }
  const wrapped = new UnknownRpcError(raw as unknown as Error)
  expect(wrapped.code).toBe(-1)
  expect(decodeSignedActionError(wrapped)).toMatchObject({
    status: 'known',
    original: wrapped,
    cause: raw,
    code: raw.code,
    message: raw.message,
    data,
    reason: 'exchange_principal_capacity',
    retryable: false,
    admission: 'unknown',
  })
})

it('decodes provider rejections through custom transport and buildRequest', async () => {
  const raw = { code: -32016, message: 'opaque diagnostic', data }
  const provider = {
    request: async () => {
      throw raw
    },
  }
  const requests = [
    custom(provider, { retryCount: 0 })({}).request,
    buildRequest(provider.request, { retryCount: 0 }),
  ]
  for (const request of requests) {
    const wrapped = await request({ method: 'eth_chainId' }).catch(
      (error: unknown) => error,
    )
    expect(wrapped).toBeInstanceOf(UnknownRpcError)
    expect(decodeSignedActionError(wrapped)).toMatchObject({
      status: 'known',
      original: wrapped,
      cause: raw,
      code: raw.code,
      message: raw.message,
      data,
      reason: 'exchange_principal_capacity',
      retryable: false,
      admission: 'unknown',
    })
  }
})

it('keeps unrelated coded and malformed wrappers unknown', () => {
  const raw = { code: -32016, message: 'opaque', data }
  for (const wrapped of [
    { code: -1, message: 'unknown', cause: raw },
    { code: -32016, message: 'legacy', cause: raw },
    Object.assign(new UnknownRpcError(raw as unknown as Error), {
      data: { ...data, version: 2 },
    }),
  ]) {
    expect(decodeSignedActionError(wrapped)).toMatchObject({
      status: 'unknown',
      original: wrapped,
      code: wrapped.code,
      message: wrapped.message,
    })
  }
})

it('bounds nested viem wrappers and refuses cycles', () => {
  const raw = { code: -32016, message: 'opaque', data }
  let nested: unknown = raw
  for (let depth = 0; depth < 15; depth++)
    nested = new UnknownRpcError(nested as Error)
  expect(decodeSignedActionError(nested).status).toBe('known')
  nested = new UnknownRpcError(nested as Error)
  expect(decodeSignedActionError(nested).status).toBe('unknown')
  const cycle = new UnknownRpcError(new Error('opaque'))
  Object.defineProperty(cycle, 'cause', { value: cycle })
  expect(decodeSignedActionError(cycle)).toMatchObject({
    status: 'unknown',
    original: cycle,
    cause: cycle,
  })
})

it('decodes HTTP errors and viem wrappers with copied provider codes', () => {
  const raw = { code: -32016, message: 'opaque', data }
  const http = new RpcRequestError({
    body: { method: 'diesis_submitIntent' },
    error: raw,
    url: 'https://rpc.example',
  })
  const wrapped = new UnknownRpcError(http)
  expect(wrapped.code).toBe(raw.code)
  expect(decodeSignedActionError(http)).toMatchObject({
    status: 'known',
    original: http,
    cause: raw,
    code: raw.code,
    data,
  })
  expect(decodeSignedActionError(wrapped)).toMatchObject({
    status: 'known',
    original: wrapped,
    cause: http,
    code: raw.code,
    message: http.message,
    data,
  })
})

it('preserves unknown errors with hostile prototypes', () => {
  const raw = new Proxy(
    { code: -32016, message: 'opaque', data },
    {
      getPrototypeOf() {
        throw new Error('prototype unavailable')
      },
    },
  )
  expect(() => decodeSignedActionError(raw)).not.toThrow()
})
