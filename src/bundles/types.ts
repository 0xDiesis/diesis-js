import type { Hex } from 'viem'

export const ExecutionFlags = {
  STOP_ON_SUCCESS: 0x01,
  TOLERATE_INVALID: 0x02,
  HALT_ON_INVALID: 0x04,
  PARTIAL_REFUND: 0x08,
} as const

export const BUNDLE_ONLY_SENTINEL =
  '0x000000000000000000000000000000000A70B1C0' as const

export type BundleStatus = 'pending' | 'included' | 'dropped' | 'unknown'
export type BundleMemberRole = 'payment' | 'bundled'

export interface PreparedBundle {
  planHash: Hex
  version: number
}
export interface SubmitBundleResult {
  planHash: Hex
  status: BundleStatus
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
