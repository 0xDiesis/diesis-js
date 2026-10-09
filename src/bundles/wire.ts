import { numberToHex, type Hex } from 'viem'

import {
  ExecutionFlags,
  type BundleManifestEntry,
  type BundleMemberConsent,
  type BundlePaymentTerms,
  type BundlePlan,
} from './types.js'

/**
 * Wire (JSON-RPC) serialization for bundle plans and consent.
 *
 * The node deserializes `BundlePlan` with serde `rename_all = "camelCase"`.
 * Two encoding caveats are reproduced here:
 *
 * - `flags` serialize as a string of set `ExecutionFlags` names joined by
 *   `" | "` (the bitflags serde form), e.g. `"HALT_ON_INVALID | PARTIAL_REFUND"`.
 * - `U256` payment fields serialize as ruint quantity hex strings (`"0x…"`).
 */

// Declaration order, matching the Rust `bitflags!` definition.
const FLAG_NAMES: ReadonlyArray<readonly [string, number]> = [
  ['STOP_ON_SUCCESS', ExecutionFlags.STOP_ON_SUCCESS],
  ['TOLERATE_INVALID', ExecutionFlags.TOLERATE_INVALID],
  ['HALT_ON_INVALID', ExecutionFlags.HALT_ON_INVALID],
  ['PARTIAL_REFUND', ExecutionFlags.PARTIAL_REFUND],
]

const KNOWN_FLAG_BITS =
  ExecutionFlags.STOP_ON_SUCCESS |
  ExecutionFlags.TOLERATE_INVALID |
  ExecutionFlags.HALT_ON_INVALID |
  ExecutionFlags.PARTIAL_REFUND

/** Encode `ExecutionFlags` bits as the bitflags serde name string. */
export function flagsToWire(flags: number): string {
  if (flags & ~KNOWN_FLAG_BITS) {
    throw new Error(`flags contains unsupported bits: ${flags}`)
  }
  return FLAG_NAMES.filter(([, bit]) => flags & bit)
    .map(([name]) => name)
    .join(' | ')
}

/** Decode a bitflags serde name string back to raw bits. */
export function flagsFromWire(value: string): number {
  const lookup = new Map(FLAG_NAMES)
  let bits = 0
  for (const token of value.split('|').map((t) => t.trim())) {
    if (token === '') continue
    const bit = lookup.get(token)
    if (bit === undefined)
      throw new Error(`unknown ExecutionFlags name: ${token}`)
    bits |= bit
  }
  return bits
}

export interface BundlePaymentTermsWire {
  payer: Hex
  maximumBuilderPayment: Hex
  refundGasPrice: Hex
  maximumRefund: Hex
  escrowNonce: Hex
}

export function paymentToWire(
  payment: BundlePaymentTerms,
): BundlePaymentTermsWire {
  return {
    payer: payment.payer,
    maximumBuilderPayment: numberToHex(payment.maximumBuilderPayment),
    refundGasPrice: numberToHex(payment.refundGasPrice),
    maximumRefund: numberToHex(payment.maximumRefund),
    escrowNonce: numberToHex(payment.escrowNonce),
  }
}

export interface BundleManifestEntryWire {
  transactionHash: Hex
  gasAllowance: number
}

export function memberToWire(
  member: BundleManifestEntry,
): BundleManifestEntryWire {
  return {
    transactionHash: member.transactionHash,
    gasAllowance: Number(member.gasAllowance),
  }
}

export interface BundlePlanWire {
  chainId: number
  expiry: number
  flags: string
  payment: BundlePaymentTermsWire
  orderedMembers: BundleManifestEntryWire[]
}

/** Serialize a `BundlePlan` to its camelCase JSON-RPC form. */
export function planToWire(plan: BundlePlan): BundlePlanWire {
  return {
    chainId: plan.chainId,
    expiry: Number(plan.expiry),
    flags: flagsToWire(plan.flags),
    payment: paymentToWire(plan.payment),
    orderedMembers: plan.orderedMembers.map(memberToWire),
  }
}

export interface BundleMemberConsentWire {
  planHash: Hex
  memberIndex: number
  transactionHash: Hex
  signer: Hex
  signature: Hex
}

export function consentToWire(
  consent: BundleMemberConsent,
): BundleMemberConsentWire {
  return {
    planHash: consent.planHash,
    memberIndex: consent.memberIndex,
    transactionHash: consent.transactionHash,
    signer: consent.signer,
    signature: consent.signature,
  }
}
