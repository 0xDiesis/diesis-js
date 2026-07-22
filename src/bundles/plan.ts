import {
  concat,
  hashTypedData,
  keccak256,
  numberToHex,
  stringToHex,
  type Hex,
  type Address,
  type TypedDataDomain,
} from 'viem'

import { DIESIS_BUNDLE_ESCROW } from '../addresses.js'
import type { BundlePlanV2 } from './types.js'

/**
 * Domain-separation tag prepended to the canonical plan bytes before hashing.
 *
 * Mirrors the Rust `PLAN_HASH_TAG` in `crates/bundles/src/types.rs`. Changing
 * this string changes every plan hash and invalidates all consent.
 */
export const BUNDLE_PLAN_TAG = 'DIESIS_BUNDLE_PLAN_V2'

function bytes32(value: Hex, name: string): Hex {
  const raw = value.startsWith('0x') ? value.slice(2) : value
  if (raw.length !== 64) throw new Error(`${name} must be 32 bytes`)
  return `0x${raw}` as Hex
}

function address20(value: Address, name: string): Hex {
  const raw = value.startsWith('0x') ? value.slice(2) : value
  if (raw.length !== 40) throw new Error(`${name} must be a 20-byte address`)
  return `0x${raw}` as Hex
}

/**
 * The explicit, big-endian, length-prefixed canonical encoding of a plan.
 *
 * Field order and widths mirror the Rust `canonical_bundle_v2` exactly:
 * `chainId` (8), `expiry` (8), `flags` (2), `payer` (20),
 * `maximumBuilderPayment` (32), `refundGasPrice` (32), `maximumRefund` (32),
 * `escrowNonce` (32), member count (4), then each ordered
 * `(transactionHash[32], gasAllowance[8])` entry. The member index is implicit
 * in ordering and is not encoded.
 */
export function canonicalBundleV2(plan: BundlePlanV2): Hex {
  const { payment } = plan
  const parts: Hex[] = [
    numberToHex(BigInt(plan.chainId), { size: 8 }),
    numberToHex(BigInt(plan.expiry), { size: 8 }),
    numberToHex(BigInt(plan.flags), { size: 2 }),
    address20(payment.payer, 'payer'),
    numberToHex(payment.maximumBuilderPayment, { size: 32 }),
    numberToHex(payment.refundGasPrice, { size: 32 }),
    numberToHex(payment.maximumRefund, { size: 32 }),
    numberToHex(payment.escrowNonce, { size: 32 }),
    numberToHex(plan.orderedMembers.length, { size: 4 }),
  ]
  for (const member of plan.orderedMembers) {
    parts.push(bytes32(member.transactionHash, 'transactionHash'))
    parts.push(numberToHex(BigInt(member.gasAllowance), { size: 8 }))
  }
  return concat(parts)
}

/**
 * The domain-separated canonical plan hash every member signs consent over.
 *
 * `keccak256("DIESIS_BUNDLE_PLAN_V2" || canonicalBundleV2(plan))` — the exact
 * commitment the node recomputes at `diesis_submitBundle` admission.
 */
export function planHash(plan: BundlePlanV2): Hex {
  return keccak256(
    concat([stringToHex(BUNDLE_PLAN_TAG), canonicalBundleV2(plan)]),
  )
}

/** EIP-712 types for the detached bundle-member consent struct. */
export const BUNDLE_MEMBER_CONSENT_TYPES = {
  BundleMemberConsent: [
    { name: 'planHash', type: 'bytes32' },
    { name: 'memberIndex', type: 'uint16' },
    { name: 'transactionHash', type: 'bytes32' },
  ],
} as const

/**
 * EIP-712 domain for a detached bundle-member consent.
 *
 * `chainId` is the plan's committed chain id and `verifyingContract` is the
 * reserved bundle escrow, so every language derives one identical domain.
 */
export function consentDomain(
  chainId: number | bigint,
  verifyingContract: Address = DIESIS_BUNDLE_ESCROW,
): TypedDataDomain {
  return {
    name: 'Diesis Bundle',
    version: '2',
    chainId: Number(chainId),
    verifyingContract,
  }
}

export interface ConsentDigestParams {
  planHash: Hex
  memberIndex: number
  transactionHash: Hex
  chainId: number | bigint
  verifyingContract?: Address
}

/**
 * The EIP-712 consent signing digest for one ordered member.
 *
 * Equals the `memberDigests[i]` value `diesis_prepareBundle` returns; clients
 * may sign that value directly (low-S, `v ∈ {27,28}`) instead of rebuilding it.
 */
export function consentDigest(params: ConsentDigestParams): Hex {
  return hashTypedData({
    domain: consentDomain(params.chainId, params.verifyingContract),
    types: BUNDLE_MEMBER_CONSENT_TYPES,
    primaryType: 'BundleMemberConsent',
    message: {
      planHash: params.planHash,
      memberIndex: params.memberIndex,
      transactionHash: params.transactionHash,
    },
  })
}

export interface BundleConsentAccount {
  address: Address
  signTypedData: (typedData: {
    domain: TypedDataDomain
    types: typeof BUNDLE_MEMBER_CONSENT_TYPES
    primaryType: 'BundleMemberConsent'
    message: {
      planHash: Hex
      memberIndex: number
      transactionHash: Hex
    }
  }) => Promise<Hex>
}

/**
 * Sign a detached member consent with a local or wallet-backed account.
 *
 * Prefer signing the `memberDigests` returned by `diesis_prepareBundle`
 * directly; this helper reproduces the same EIP-712 digest for offline
 * construction and verification.
 */
export async function signMemberConsent(
  account: BundleConsentAccount,
  params: ConsentDigestParams,
): Promise<Hex> {
  return account.signTypedData({
    domain: consentDomain(params.chainId, params.verifyingContract),
    types: BUNDLE_MEMBER_CONSENT_TYPES,
    primaryType: 'BundleMemberConsent',
    message: {
      planHash: params.planHash,
      memberIndex: params.memberIndex,
      transactionHash: params.transactionHash,
    },
  })
}
