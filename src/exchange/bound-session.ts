import {
  bytesToHex,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  type Address,
  type Chain,
  type Client,
  type Hash,
  type Hex,
  type LocalAccount,
  type Transport,
} from 'viem'

import { IDiesisPerpsBookAbi, IDiesisSpotBookAbi } from '../abi/index.js'
import type {
  IDiesisPerpsBookSubmitBoundSessionActionsParams,
  IDiesisSpotBookSubmitBoundSessionActionsParams,
} from '../abi/bindings/viem/index.js'
import { DIESIS_PERPS_BOOK, DIESIS_SPOT_BOOK } from '../addresses.js'
import {
  decodeExchangeActionBatch,
  encodeExchangeActionBatch,
  EXCHANGE_ACTION_LIMITS,
  type ExchangeActionBatch,
  type ExchangeBook,
} from './actions-v2.js'
import {
  computeExchangeResultHash,
  type ActionOutcome,
} from './actions-v2-results.js'
import {
  fixedBytes,
  nonzeroBytes,
  Reader,
  UINT64_MAX,
  Writer,
} from './wire-bytes.js'

/** Explicit bounds from the separately accepted signed V3 resource policy. */
export type BoundSessionLimits = {
  version: 3
  maxEncodedBytes: bigint
  bindingCheckGas: bigint
}

/** Expectations authenticated by the ordinary transaction's session-key caller. */
export type BoundSessionBatch = {
  principal: Address
  authorizationGeneration: bigint
  batch: ExchangeActionBatch
}

export type PrepareBoundSessionActionsParameters = BoundSessionBatch & {
  book: ExchangeBook
  sessionKey: Address
  limits: BoundSessionLimits
}

export type BoundSessionTransaction = {
  nonce: number
  gas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

export type SendBoundSessionActionsParameters =
  PrepareBoundSessionActionsParameters & {
    transaction: BoundSessionTransaction
  }

function byteLimit(limits: BoundSessionLimits): number {
  if (
    limits.version !== 3 ||
    typeof limits.maxEncodedBytes !== 'bigint' ||
    limits.maxEncodedBytes <= 0n ||
    limits.maxEncodedBytes > UINT64_MAX ||
    typeof limits.bindingCheckGas !== 'bigint' ||
    limits.bindingCheckGas <= 0n ||
    limits.bindingCheckGas > UINT64_MAX
  )
    throw new Error('invalid selected bound-session V3 limits')
  return Number(
    limits.maxEncodedBytes < BigInt(EXCHANGE_ACTION_LIMITS.maxEncodedBytes)
      ? limits.maxEncodedBytes
      : BigInt(EXCHANGE_ACTION_LIMITS.maxEncodedBytes),
  )
}

function validateBinding(value: BoundSessionBatch): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value.principal)) {
    throw new Error('principal must be exactly twenty hexadecimal bytes')
  }
  nonzeroBytes(value.principal, 20, 'principal')
  if (
    typeof value.authorizationGeneration !== 'bigint' ||
    value.authorizationGeneration <= 0n ||
    value.authorizationGeneration > UINT64_MAX
  )
    throw new Error('authorizationGeneration must be a positive uint64')
}

function checkLength(length: number, limits: BoundSessionLimits): void {
  if (length > byteLimit(limits)) {
    throw new Error('whole DXS3 wrapper exceeds selected byte limit')
  }
}

/** Encode DXS3 principal20/generation8 BE followed by unchanged canonical DXA2. */
export function encodeBoundSessionBatch(
  value: BoundSessionBatch,
  limits: BoundSessionLimits,
): Hex {
  validateBinding(value)
  const inner = hexToBytes(encodeExchangeActionBatch(value.batch))
  checkLength(32 + inner.length, limits)
  const writer = new Writer()
  writer.push(new Uint8Array([0x44, 0x58, 0x53, 0x33]))
  writer.push(nonzeroBytes(value.principal, 20, 'principal'))
  writer.u64(value.authorizationGeneration, 'authorizationGeneration')
  writer.push(inner)
  return bytesToHex(writer.output())
}

/** Decode the distinct bounded wrapper; legacy DXA2 never supplies a fallback. */
export function decodeBoundSessionBatch(
  encoded: Hex,
  limits: BoundSessionLimits,
): BoundSessionBatch {
  if (typeof encoded !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(encoded)) {
    throw new Error('DXS3 wrapper must contain complete hex bytes')
  }
  checkLength((encoded.length - 2) / 2, limits)
  const bytes = hexToBytes(encoded)
  if (bytes.length < 32) throw new Error('truncated DXS3 header')
  if (bytesToHex(bytes.slice(0, 4)) !== '0x44585333') {
    throw new Error('invalid DXS3 magic')
  }
  const reader = new Reader(bytes.slice(4, 32))
  const principal = bytesToHex(reader.take(20, 'principal'))
  const authorizationGeneration = reader.u64('authorizationGeneration')
  const value = {
    principal,
    authorizationGeneration,
    batch: decodeExchangeActionBatch(bytesToHex(bytes.slice(32))),
  }
  validateBinding(value)
  return value
}

function validateSessionKey(
  parameters: PrepareBoundSessionActionsParameters,
): void {
  validateBinding(parameters)
  if (!/^0x[0-9a-fA-F]{40}$/.test(parameters.sessionKey)) {
    throw new Error('sessionKey must be exactly twenty hexadecimal bytes')
  }
  nonzeroBytes(parameters.sessionKey, 20, 'sessionKey')
  if (
    parameters.sessionKey.toLowerCase() === parameters.principal.toLowerCase()
  ) {
    throw new Error('sessionKey must be distinct from principal')
  }
}

/**
 * Prepare the separately generated V3 method. The caller must select an accepted
 * signed resource policy and runtime boundary; authorization reads do not activate
 * V3. Priced actions retain their separate native qualification gate.
 */
export function prepareBoundSessionActionsTransaction(
  parameters: PrepareBoundSessionActionsParameters,
): { to: Address; data: Hex; value: 0n } {
  validateSessionKey(parameters)
  const encodedWrapper = encodeBoundSessionBatch(parameters, parameters.limits)
  if (
    parameters.batch.actions.some(
      (action) =>
        (action.kind === 'place' && action.pricingVersion === 1) ||
        (action.kind === 'cancelReplace' &&
          action.replacementPricingVersion === 1),
    )
  )
    throw new Error('Pricing version 1 requires qualified native admission')
  const generated:
    | IDiesisSpotBookSubmitBoundSessionActionsParams
    | IDiesisPerpsBookSubmitBoundSessionActionsParams = { encodedWrapper }
  if (parameters.book === 'spot') {
    return {
      to: DIESIS_SPOT_BOOK,
      value: 0n,
      data: encodeFunctionData({
        abi: IDiesisSpotBookAbi,
        functionName: 'submitBoundSessionActions',
        args: [generated.encodedWrapper],
      }),
    }
  }
  if (parameters.book === 'perpetual') {
    return {
      to: DIESIS_PERPS_BOOK,
      value: 0n,
      data: encodeFunctionData({
        abi: IDiesisPerpsBookAbi,
        functionName: 'submitBoundSessionActions',
        args: [generated.encodedWrapper],
      }),
    }
  }
  throw new Error(`unknown exchange book ${String(parameters.book)}`)
}

function parametersFingerprint(
  parameters: SendBoundSessionActionsParameters,
): string {
  validateSessionKey(parameters)
  return JSON.stringify([
    encodeBoundSessionBatch(parameters, parameters.limits),
    parameters.sessionKey.toLowerCase(),
    parameters.book,
    parameters.limits.version,
    parameters.limits.maxEncodedBytes.toString(),
    parameters.limits.bindingCheckGas.toString(),
    parameters.transaction.nonce,
    parameters.transaction.gas.toString(),
    parameters.transaction.maxFeePerGas.toString(),
    parameters.transaction.maxPriorityFeePerGas.toString(),
  ])
}

function assertUnchanged(check: () => boolean): void {
  try {
    if (check()) return
  } catch {
    // A malformed mutated input also invalidates the captured signing context.
  }
  throw new Error('bound V3 signing context changed before submission')
}

/** Sign an immutable ordinary EIP-1559 request using the expected session key. */
export function signBoundSessionActionsTransaction(
  account: Pick<LocalAccount, 'address' | 'signTransaction'>,
  parameters: SendBoundSessionActionsParameters & { chainId: number },
): Promise<Hex> {
  validateSessionKey(parameters)
  if (account.address.toLowerCase() !== parameters.sessionKey.toLowerCase()) {
    throw new Error('signing account must match sessionKey')
  }
  if (!Number.isSafeInteger(parameters.chainId) || parameters.chainId <= 0) {
    throw new Error('chainId must be a positive safe integer')
  }
  const prepared = prepareBoundSessionActionsTransaction(parameters)
  const fingerprint = parametersFingerprint(parameters)
  const address = account.address
  const signer = account.signTransaction
  const chainId = parameters.chainId
  const transaction = Object.freeze({
    nonce: parameters.transaction.nonce,
    gas: parameters.transaction.gas,
    maxFeePerGas: parameters.transaction.maxFeePerGas,
    maxPriorityFeePerGas: parameters.transaction.maxPriorityFeePerGas,
    type: 'eip1559' as const,
    chainId,
    ...prepared,
  })
  return signer.call(account, transaction).then((serializedTransaction) => {
    assertUnchanged(
      () =>
        account.address === address &&
        account.signTransaction === signer &&
        parameters.chainId === chainId &&
        parametersFingerprint(parameters) === fingerprint,
    )
    return serializedTransaction
  })
}

/**
 * Submit through strict admission only after rechecking the captured signer,
 * chain, request owner and complete binding/batch/bounds/ordinary transaction.
 * Selection changes during signing are terminal; no fallback is substituted.
 */
export async function sendBoundSessionActionsTransaction(
  client: Client<Transport, Chain, LocalAccount>,
  parameters: SendBoundSessionActionsParameters,
): Promise<Hash> {
  const account = client.account
  const address = account.address
  const accountType = account.type
  const signer = account.signTransaction
  const chain = client.chain
  const chainId = chain.id
  const request = client.request
  const fingerprint = parametersFingerprint(parameters)
  const serializedTransaction = await signBoundSessionActionsTransaction(
    account,
    { ...parameters, chainId },
  )
  assertUnchanged(
    () =>
      client.account === account &&
      account.address === address &&
      account.type === accountType &&
      account.signTransaction === signer &&
      client.chain === chain &&
      chain.id === chainId &&
      client.request === request &&
      parametersFingerprint(parameters) === fingerprint,
  )
  return request({
    method: 'diesis_sendRawTransaction' as never,
    params: [serializedTransaction] as never,
  } as never)
}

/** Verify the inherited V2 outcome commitment over the complete DXS3 wrapper. */
export function computeBoundSessionResultHash(
  encodedWrapper: Hex,
  outcomes: readonly ActionOutcome[],
  limits: BoundSessionLimits,
): Hex {
  const decoded = decodeBoundSessionBatch(encodedWrapper, limits)
  // Reuse strict existing outcome/index/count/reason validation against inner DXA2.
  computeExchangeResultHash(encodeExchangeActionBatch(decoded.batch), outcomes)
  const domain = new TextEncoder().encode('DIESIS\0EXCHANGE_ACTION_RESULT\0V2')
  const wrapper = hexToBytes(encodedWrapper)
  const writer = new Writer()
  writer.u16(domain.length, 'result domain length')
  writer.push(domain)
  writer.u32(wrapper.length, 'wrapper length')
  writer.push(wrapper)
  writer.u16(outcomes.length, 'outcome count')
  for (const outcome of outcomes) {
    writer.u16(outcome.actionIndex, 'action index')
    writer.u8(outcome.actionTag, 'action tag')
    writer.u8(outcome.accepted ? 0 : 1, 'outcome kind')
    writer.u16(outcome.accepted ? 0 : outcome.reasonCode, 'reason code')
    writer.push(
      fixedBytes(
        outcome.accepted ? outcome.resultId : outcome.context,
        32,
        'result/context',
      ),
    )
  }
  return keccak256(writer.output())
}
