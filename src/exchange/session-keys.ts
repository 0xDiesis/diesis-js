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
  IDiesisSettlementAuthorizeSessionKeyParams,
  IDiesisSettlementRevokeSessionKeyParams,
} from '../abi/bindings/viem/index.js'
import type { ExchangeAction } from './actions-v2.js'

/** Settlement function definitions come from the generated contract ABI. */
export const ExchangeSessionKeysAbi = [
  IDiesisSettlementAbi.find(
    (item) => item.type === 'function' && item.name === 'authorizeSessionKey',
  )!,
  IDiesisSettlementAbi.find(
    (item) => item.type === 'function' && item.name === 'revokeSessionKey',
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

export type AuthorizeSessionKeyParameters =
  IDiesisSettlementAuthorizeSessionKeyParams

export type RevokeSessionKeyParameters = IDiesisSettlementRevokeSessionKeyParams

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

function validateSessionKey(sessionKey: Address): void {
  if (!isAddress(sessionKey, { strict: true })) {
    throw new Error('sessionKey must be a canonical address')
  }
  if (sessionKey.toLowerCase() === zeroAddress) {
    throw new Error('sessionKey must be nonzero')
  }
}

/** Build the exact principal-called settlement authorization transaction. */
export function prepareAuthorizeSessionKeyTransaction(
  parameters: AuthorizeSessionKeyParameters,
): { to: Address; data: Hex; value: 0n } {
  validateSessionKey(parameters.sessionKey)
  if (
    parameters.actionScope <= 0n ||
    parameters.actionScope > UINT256_MAX ||
    (parameters.actionScope & ~ALL_ACTION_SCOPE_V2) !== 0n
  ) {
    throw new Error(
      'actionScope must be nonzero and contain only V2 action bits',
    )
  }
  if (parameters.validUntil <= 0n || parameters.validUntil > UINT64_MAX) {
    throw new Error('validUntil must be a nonzero uint64')
  }
  if (
    parameters.maxNotionalOrSpend < 0n ||
    parameters.maxNotionalOrSpend > UINT256_MAX
  ) {
    throw new Error('maxNotionalOrSpend must be a uint256')
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(parameters.allowedMarketsMask)) {
    throw new Error('allowedMarketsMask must be 32 bytes')
  }
  return {
    to: DIESIS_SETTLEMENT,
    value: 0n,
    data: encodeFunctionData({
      abi: ExchangeSessionKeysAbi,
      functionName: 'authorizeSessionKey',
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

/** Build the exact principal-called settlement revocation transaction. */
export function prepareRevokeSessionKeyTransaction(
  parameters: RevokeSessionKeyParameters,
): { to: Address; data: Hex; value: 0n } {
  validateSessionKey(parameters.sessionKey)
  return {
    to: DIESIS_SETTLEMENT,
    value: 0n,
    data: encodeFunctionData({
      abi: ExchangeSessionKeysAbi,
      functionName: 'revokeSessionKey',
      args: [parameters.sessionKey],
    }),
  }
}
