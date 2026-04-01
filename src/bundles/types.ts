import type { Hex } from 'viem'

export const ExecutionFlags = {
  STOP_ON_SUCCESS: 0x01,
  TOLERATE_INVALID: 0x02,
  HALT_ON_INVALID: 0x04,
  PARTIAL_REFUND: 0x08,
} as const

export const BUNDLE_ONLY_SENTINEL = '0x000000000000000000000000000000000A70B1C0' as const

export interface BundleResult { planHash: Hex; status: 'pending' | 'included' | 'dropped' | 'unknown' }
export interface PreparedBundle { planHash: Hex; version: number }
