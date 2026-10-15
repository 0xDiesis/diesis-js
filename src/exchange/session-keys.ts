import {
  encodeFunctionData,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'

import { DIESIS_SETTLEMENT } from '../addresses.js'
import { IDiesisSettlementAbi } from '../abi/index.js'
import type {
  IDiesisSettlementAcceptSessionKeyV2Params,
  IDiesisSettlementAuthorizeSessionKeyV2Params,
  IDiesisSettlementRevokeSessionKeyV2Params,
} from '../abi/bindings/viem/index.js'
import type { ExchangeAction } from './actions-v2.js'

/** Settlement function definitions come from the generated contract ABI. */
export const ExchangeSessionKeysAbi = [
  IDiesisSettlementAbi.find(
    (item) => item.type === 'function' && item.name === 'acceptSessionKeyV2',
  )!,
  IDiesisSettlementAbi.find(
    (item) => item.type === 'function' && item.name === 'authorizeSessionKeyV2',
  )!,
  IDiesisSettlementAbi.find(
    (item) => item.type === 'function' && item.name === 'revokeSessionKeyV2',
  )!,
] as const

export type ExchangeActionKind = ExchangeAction['kind']

const ACTION_TAG: Readonly<Record<ExchangeActionKind, number>> = {
  place: 1,
  cancelByOrderId: 2,
  cancelByClientOrderId: 3,
  cancelReplace: 4,
  cancelMarketChunk: 5,
  armCancelSchedule: 6,
  renewCancelSchedule: 7,
  disarmCancelSchedule: 8,
  triggerCancelSchedule: 9,
  adjustPositionCollateral: 10,
}
const ALL_ACTION_SCOPE_V2 = 0x7fen
const UINT64_MAX = (1n << 64n) - 1n
const UINT256_MAX = (1n << 256n) - 1n

export type AcceptSessionKeyV2Parameters =
  IDiesisSettlementAcceptSessionKeyV2Params
export type AuthorizeSessionKeyV2Parameters =
  IDiesisSettlementAuthorizeSessionKeyV2Params
export type RevokeSessionKeyV2Parameters =
  IDiesisSettlementRevokeSessionKeyV2Params

/** @deprecated Use AuthorizeSessionKeyV2Parameters. */
export type AuthorizeSessionKeyParameters = AuthorizeSessionKeyV2Parameters
/** @deprecated Use RevokeSessionKeyV2Parameters. */
export type RevokeSessionKeyParameters = RevokeSessionKeyV2Parameters

/** Construct the canonical action-tag bitmap for one session authorization. */
export function exchangeActionScope(
  actions: readonly ExchangeActionKind[],
): bigint {
  if (actions.length === 0) throw new Error('action scope must be nonempty')
  let scope = 0n
  for (const action of actions) {
    const tag = ACTION_TAG[action]
    if (tag === undefined) throw new Error(`unknown action ${String(action)}`)
    scope |= 1n << BigInt(tag)
  }
  return scope
}

/** Explicit V2 name for the canonical action-tag bitmap. */
export const exchangeActionScopeV2 = exchangeActionScope

function validateAddress(address: Address, field: string): void {
  if (!isAddress(address, { strict: true })) {
    throw new Error(`${field} must be a canonical address`)
  }
  if (address.toLowerCase() === zeroAddress) {
    throw new Error(`${field} must be nonzero`)
  }
}

function validateTerms(
  parameters: Omit<AcceptSessionKeyV2Parameters, 'principal'>,
): void {
  if (
    typeof parameters.actionScope !== 'bigint' ||
    parameters.actionScope <= 0n ||
    parameters.actionScope > UINT256_MAX ||
    (parameters.actionScope & ~ALL_ACTION_SCOPE_V2) !== 0n
  ) {
    throw new Error(
      'actionScope must be nonzero and contain only V2 action bits',
    )
  }
  if (
    typeof parameters.validUntil !== 'bigint' ||
    parameters.validUntil <= 0n ||
    parameters.validUntil > UINT64_MAX
  ) {
    throw new Error('validUntil must be a nonzero uint64')
  }
  if (
    typeof parameters.maxNotionalOrSpend !== 'bigint' ||
    parameters.maxNotionalOrSpend < 0n ||
    parameters.maxNotionalOrSpend > UINT256_MAX
  ) {
    throw new Error('maxNotionalOrSpend must be a uint256')
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(parameters.allowedMarketsMask)) {
    throw new Error('allowedMarketsMask must be 32 bytes')
  }
}

/**
 * Prepare key-called one-use consent. Send from the intended session key.
 * This does not activate a binding or consume the principal's capacity.
 */
export function prepareAcceptSessionKeyV2Transaction(
  parameters: AcceptSessionKeyV2Parameters,
): { to: Address; data: Hex; value: 0n } {
  validateAddress(parameters.principal, 'principal')
  validateTerms(parameters)
  return {
    to: DIESIS_SETTLEMENT,
    value: 0n,
    data: encodeFunctionData({
      abi: ExchangeSessionKeysAbi,
      functionName: 'acceptSessionKeyV2',
      args: [
        parameters.principal,
        parameters.actionScope,
        parameters.validUntil,
        parameters.maxNotionalOrSpend,
        parameters.allowedMarketsMask,
      ],
    }),
  }
}

/**
 * Prepare principal-called activation after the key accepted identical terms.
 * Native execution checks consent, expiry, market ordinals and capacity.
 */
export function prepareAuthorizeSessionKeyV2Transaction(
  parameters: AuthorizeSessionKeyV2Parameters,
): { to: Address; data: Hex; value: 0n } {
  validateAddress(parameters.sessionKey, 'sessionKey')
  validateTerms(parameters)
  return {
    to: DIESIS_SETTLEMENT,
    value: 0n,
    data: encodeFunctionData({
      abi: ExchangeSessionKeysAbi,
      functionName: 'authorizeSessionKeyV2',
      args: [
        parameters.sessionKey,
        parameters.actionScope,
        parameters.validUntil,
        parameters.maxNotionalOrSpend,
        parameters.allowedMarketsMask,
      ],
    }),
  }
}

/**
 * Prepare revocation from the bound principal or the session key. It also clears
 * pending consent and advances the generation. A key can cancel pending consent
 * before activation by calling this same method with its own address.
 */
export function prepareRevokeSessionKeyV2Transaction(
  parameters: RevokeSessionKeyV2Parameters,
): { to: Address; data: Hex; value: 0n } {
  validateAddress(parameters.sessionKey, 'sessionKey')
  return {
    to: DIESIS_SETTLEMENT,
    value: 0n,
    data: encodeFunctionData({
      abi: ExchangeSessionKeysAbi,
      functionName: 'revokeSessionKeyV2',
      args: [parameters.sessionKey],
    }),
  }
}

/**
 * Prepare key-called cancellation using revokeSessionKeyV2(sessionKey).
 * Send from that key. If a binding is active, this also revokes it.
 */
export const prepareCancelSessionKeyConsentV2Transaction =
  prepareRevokeSessionKeyV2Transaction

/** @deprecated Use prepareAuthorizeSessionKeyV2Transaction after key consent. */
export const prepareAuthorizeSessionKeyTransaction =
  prepareAuthorizeSessionKeyV2Transaction

/** @deprecated Use prepareRevokeSessionKeyV2Transaction. */
export const prepareRevokeSessionKeyTransaction =
  prepareRevokeSessionKeyV2Transaction
