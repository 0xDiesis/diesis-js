import type { Address, Hex } from 'viem'

/**
 * Bundle execution control flags (a `u16` bitmask).
 *
 * Rendered onto the JSON-RPC wire as the bitflags name string (see
 * {@link flagsToWire}), not as a number — the "flags-as-string" wire caveat.
 */
export const ExecutionFlags = {
  STOP_ON_SUCCESS: 0x01,
  TOLERATE_INVALID: 0x02,
  HALT_ON_INVALID: 0x04,
  PARTIAL_REFUND: 0x08,
} as const

/** Committed escrow payment and skipped-work refund terms. */
export interface BundlePaymentTerms {
  payer: Address
  maximumBuilderPayment: bigint
  refundGasPrice: bigint
  maximumRefund: bigint
  escrowNonce: bigint
}

/** One ordered member of a plan: its committed hash and gas allowance. */
export interface BundleManifestEntry {
  transactionHash: Hex
  gasAllowance: bigint | number
}

/** The ordered plan every member's detached consent commits to. */
export interface BundlePlan {
  chainId: number
  expiry: number | bigint
  flags: number
  payment: BundlePaymentTerms
  orderedMembers: BundleManifestEntry[]
}

/** A member's detached EIP-712 consent over the plan hash and its own slot. */
export interface BundleMemberConsent {
  planHash: Hex
  memberIndex: number
  transactionHash: Hex
  signer: Address
  signature: Hex
}

/** Submission/lifecycle status echoed by submit and status RPCs. */
export type BundleStatus =
  | 'pending'
  | 'included'
  | 'payment_failed'
  | 'payment_consumed'
  | 'dropped'
  | 'unknown'

/** Canonical `BundleLifecycle` label surfaced by `diesis_getBundleStatus`. */
export type BundleLifecycle =
  | 'admitted'
  | 'disseminating'
  | 'ready'
  | 'proposed'
  | 'canonical'
  | 'reverted'
  | 'expired'
  | 'dropped'
  | 'unknown'

export type BundleMemberRole = 'payment' | 'bundled'

export interface PreparedBundle {
  planHash: Hex
  version: number
  /** Per-member EIP-712 signing digests, aligned with `plan.orderedMembers`. */
  memberDigests: Hex[]
}

export interface SubmitBundleResult {
  planHash: Hex
  status: BundleStatus
}

/** Committed escrow terms surfaced by `diesis_getBundleStatus` (U256 as hex). */
export interface BundlePaymentOutcome {
  payer: Address
  maximumBuilderPayment: Hex
  refundGasPrice: Hex
  maximumRefund: Hex
  escrowNonce: Hex
}

export interface BundleMember {
  txHash: Hex | null
  index: number
  role: BundleMemberRole
  status: BundleStatus
  failureReason: string | null
}

export interface BundleFailure {
  code: string | null
  reason: string
  failedTxHash: Hex | null
  stage: string | null
}

export interface BundleOrdering {
  window: number | null
  batchIndex: number | null
  positionInBatch: number | null
}

export interface BundleStatusResult {
  planHash: Hex
  bundleHash: Hex
  status: BundleStatus
  lifecycle: BundleLifecycle
  generation: number
  payment: BundlePaymentOutcome | null
  submittedAt: number | null
  updatedAt: number | null
  includedBlockNumber: number | null
  includedBlockHash: Hex | null
  transactionHashes: Hex[]
  members: BundleMember[]
  failure: BundleFailure | null
  ordering: BundleOrdering | null
  error: string | null
}
