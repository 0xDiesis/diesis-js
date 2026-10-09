import { bytesToHex, hexToBytes, keccak256, type Hex } from 'viem'

import {
  decodeExchangeActionBatch,
  EXCHANGE_ACTION_LIMITS,
} from './actions-v2.js'
import { fixedBytes, Reader, Writer } from './wire-bytes.js'

export type ActionOutcome =
  | {
      accepted: true
      actionIndex: number
      actionTag: number
      resultId: Hex
    }
  | {
      accepted: false
      actionIndex: number
      actionTag: number
      reasonCode: number
      context: Hex
    }

export type ExchangeActionsResult = {
  resultHash: Hex
  acceptedCount: number
  rejectedCount: number
}

export const ExchangeReasonCode = {
  MarketNotFound: 0x0001,
  MarketNotActive: 0x0002,
  Unauthorized: 0x0003,
  AuthorizationExpired: 0x0004,
  InsufficientBalance: 0x0005,
  OrderNotFound: 0x0006,
  OwnershipMismatch: 0x0007,
  PostOnlyWouldCross: 0x0008,
  FokNotFillable: 0x0009,
  NoLiquidity: 0x000a,
  InvalidPrice: 0x000b,
  InvalidQuantity: 0x000c,
  ReduceOnlyViolation: 0x000d,
  ProtectionMode: 0x000e,
  StaleRenewalCounter: 0x000f,
  ScheduleNotReady: 0x0010,
  ScheduleComplete: 0x0011,
  DuplicateClientOrderId: 0x0012,
  CapacityExceeded: 0x0013,
  PerpetualV2Inactive: 0x0014,
} as const

const RESULT_DOMAIN = new TextEncoder().encode(
  'DIESIS\0EXCHANGE_ACTION_RESULT\0V2',
)

/** Decode the fixed 96-byte Solidity return tuple. */
export function decodeExchangeActionsResult(
  data: Hex,
  expectedActionCount: number,
): ExchangeActionsResult {
  if (
    !Number.isInteger(expectedActionCount) ||
    expectedActionCount < 1 ||
    expectedActionCount > EXCHANGE_ACTION_LIMITS.maxActions
  ) {
    throw new Error('expected action count must be between 1 and 32')
  }
  if (typeof data !== 'string' || data.length !== 2 + 96 * 2) {
    throw new Error('exchange V2 result must be 96 bytes')
  }
  const reader = new Reader(fixedBytes(data, 96, 'exchange V2 result'))
  const resultHash = bytesToHex(reader.take(32, 'result hash'))
  const acceptedWord = reader.take(32, 'accepted count')
  const rejectedWord = reader.take(32, 'rejected count')
  if (
    acceptedWord.slice(0, 30).some((byte) => byte !== 0) ||
    rejectedWord.slice(0, 30).some((byte) => byte !== 0)
  ) {
    throw new Error('noncanonical exchange V2 result count')
  }
  const acceptedCount = acceptedWord[30]! * 0x100 + acceptedWord[31]!
  const rejectedCount = rejectedWord[30]! * 0x100 + rejectedWord[31]!
  const total = acceptedCount + rejectedCount
  if (total > EXCHANGE_ACTION_LIMITS.maxActions) {
    throw new Error('exchange V2 result reports more than 32 actions')
  }
  if (total !== expectedActionCount) {
    throw new Error(
      `result count mismatch: expected ${expectedActionCount}, got ${total}`,
    )
  }
  return { resultHash, acceptedCount, rejectedCount }
}

/** Recompute the domain-separated result commitment from ordered outcomes. */
export function computeExchangeResultHash(
  encodedActions: Hex,
  outcomes: readonly ActionOutcome[],
): Hex {
  if (outcomes.length === 0 || outcomes.length > 0xffff) {
    throw new Error('outcomes must be a nonempty uint16 count')
  }
  const decoded = decodeExchangeActionBatch(encodedActions)
  const batch = hexToBytes(encodedActions)
  if (decoded.actions.length !== outcomes.length) {
    throw new Error(
      `outcome count mismatch: expected ${decoded.actions.length}, got ${outcomes.length}`,
    )
  }
  if (batch.length > 0xffff_ffff) throw new Error('encoded batch is too long')
  const writer = new Writer()
  writer.u16(RESULT_DOMAIN.length, 'result domain length')
  writer.push(RESULT_DOMAIN)
  writer.u32(batch.length, 'batch length')
  writer.push(batch)
  writer.u16(outcomes.length, 'outcome count')
  outcomes.forEach((outcome, index) => {
    if (typeof outcome.accepted !== 'boolean') {
      throw new Error('accepted must be a boolean')
    }
    if (outcome.actionIndex !== index) {
      throw new Error('noncanonical outcome index')
    }
    if (outcome.actionTag < 1 || outcome.actionTag > 10) {
      throw new Error('unknown action tag')
    }
    writer.u16(outcome.actionIndex, 'action index')
    writer.u8(outcome.actionTag, 'action tag')
    writer.u8(outcome.accepted ? 0 : 1, 'outcome kind')
    if (
      !outcome.accepted &&
      (outcome.reasonCode < ExchangeReasonCode.MarketNotFound ||
        outcome.reasonCode > ExchangeReasonCode.PerpetualV2Inactive)
    ) {
      throw new Error(`unknown reason code ${outcome.reasonCode}`)
    }
    writer.u16(outcome.accepted ? 0 : outcome.reasonCode, 'reason code')
    writer.push(
      fixedBytes(
        outcome.accepted ? outcome.resultId : outcome.context,
        32,
        'result/context',
      ),
    )
  })
  return keccak256(writer.output())
}
