import {
  encodeFunctionData,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'

import { DIESIS_SETTLEMENT } from '../addresses.js'
import type { ExchangeActionV2 } from './actions-v2.js'

/**
 * Frozen by `diesis-contracts` commit db8c45f. Keep this local until that
 * contracts child is merged and the SDK dependency is regenerated from it.
 */
export const ExchangeSessionKeysV2Abi = [
  {
    type: 'function',
    name: 'authorizeSessionKeyV2',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionKey', type: 'address' },
      { name: 'actionScope', type: 'uint256' },
      { name: 'validUntil', type: 'uint64' },
      { name: 'maxNotionalOrSpend', type: 'uint256' },
      { name: 'allowedMarketsMask', type: 'bytes32' },
    ],
    outputs: [{ name: 'generation', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'revokeSessionKeyV2',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionKey', type: 'address' }],
    outputs: [{ name: 'generation', type: 'uint64' }],
  },
] as const

export type ExchangeActionKindV2 = ExchangeActionV2['kind']

const ACTION_TAG: Readonly<Record<ExchangeActionKindV2, number>> = {
  place: 1,
  cancelByOrderId: 2,
  cancelByClientOrderId: 3,
  cancelReplace: 4,
  cancelMarketChunk: 5,
  armCancelSchedule: 6,
  renewCancelSchedule: 7,
  disarmCancelSchedule: 8,
  triggerCancelSchedule: 9,
}
const ALL_ACTION_SCOPE_V2 = 0x3fen
const UINT64_MAX = (1n << 64n) - 1n
const UINT256_MAX = (1n << 256n) - 1n

export type AuthorizeSessionKeyV2Parameters = {
  sessionKey: Address
  /** Bits 1..=9 map exactly to the frozen DXA2 action tags. */
  actionScope: bigint
  /** Unix timestamp in seconds. Runtime additionally requires it to be future. */
  validUntil: bigint
  /** Zero means uncapped. */
  maxNotionalOrSpend: bigint
  /** Zero means no markets; all ones is the explicit all-markets sentinel. */
  allowedMarketsMask: Hex
}

export type RevokeSessionKeyV2Parameters = { sessionKey: Address }

/** Construct the canonical action-tag bitmap for one session authorization. */
export function exchangeActionScopeV2(
  actions: readonly ExchangeActionKindV2[],
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
export function prepareAuthorizeSessionKeyV2Transaction(
  parameters: AuthorizeSessionKeyV2Parameters,
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
      abi: ExchangeSessionKeysV2Abi,
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

/** Build the exact principal-called settlement revocation transaction. */
export function prepareRevokeSessionKeyV2Transaction(
  parameters: RevokeSessionKeyV2Parameters,
): { to: Address; data: Hex; value: 0n } {
  validateSessionKey(parameters.sessionKey)
  return {
    to: DIESIS_SETTLEMENT,
    value: 0n,
    data: encodeFunctionData({
      abi: ExchangeSessionKeysV2Abi,
      functionName: 'revokeSessionKeyV2',
      args: [parameters.sessionKey],
    }),
  }
}
