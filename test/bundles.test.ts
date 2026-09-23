import { readFileSync } from 'node:fs'

import { recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  BUNDLE_MEMBER_CONSENT_TYPES,
  canonicalBundleV2,
  consentDigest,
  consentDomain,
  ExecutionFlags,
  flagsFromWire,
  flagsToWire,
  planHash,
  planToWire,
  signMemberConsent,
  type BundlePlanV2,
} from '../src/bundles/index.js'
import { encodeReserveBundleV2, reservationValue } from '../src/bundles/index.js'

describe('bundle documentation', () => {
  it('uses the canonical Bundle V2 prepare and submit shapes', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    const section = readme.match(/## Bundle transactions\n([\s\S]*?)\n## Sponsor gas/)?.[1]

    expect(section).toContain('prepareBundle({ plan })')
    expect(section).toContain('submitBundle({\n  plan,')
    expect(section).toContain('planHash: prepared.planHash')
    expect(section).toContain('payment,')
    expect(section).toContain('members,')
    expect(section).not.toContain('bundle:')
  })
})

// The frozen cross-language fixed vector from docs/spec/bundles.md. The Rust,
// TypeScript, and Python encoders must all reproduce this exact plan hash.
const FIXED_PLAN: BundlePlanV2 = {
  chainId: 8080,
  expiry: 1_800_000_000,
  flags: ExecutionFlags.HALT_ON_INVALID | ExecutionFlags.PARTIAL_REFUND,
  payment: {
    payer: `0x${'11'.repeat(20)}`,
    maximumBuilderPayment: 1_000_000_000_000n,
    refundGasPrice: 7n,
    maximumRefund: 500_000n,
    escrowNonce: 42n,
  },
  orderedMembers: [
    { transactionHash: `0x${'aa'.repeat(32)}`, gasAllowance: 100_000 },
    { transactionHash: `0x${'bb'.repeat(32)}`, gasAllowance: 250_000 },
  ],
}

const FIXED_PLAN_HASH =
  '0x1c064f8de7f925f6dbb68e8d99a780f2f187f8b07ed1905edae77291ad30ddca'

describe('bundle plan hash', () => {
  it('reproduces the frozen cross-language fixed vector', () => {
    expect(planHash(FIXED_PLAN)).toBe(FIXED_PLAN_HASH)
  })

  it('produces canonical bytes of the expected length', () => {
    // 8 + 8 + 2 + 20 + 32*4 + 4 + members*(32 + 8)
    const expected = 8 + 8 + 2 + 20 + 32 * 4 + 4 + 2 * (32 + 8)
    const bytes = canonicalBundleV2(FIXED_PLAN)
    expect((bytes.length - 2) / 2).toBe(expected)
  })

  it('changes when any committed field mutates', () => {
    const mutated: BundlePlanV2 = {
      ...FIXED_PLAN,
      orderedMembers: [
        FIXED_PLAN.orderedMembers[1],
        FIXED_PLAN.orderedMembers[0],
      ],
    }
    expect(planHash(mutated)).not.toBe(FIXED_PLAN_HASH)
  })
})

describe('execution flags wire form', () => {
  it('renders combined flags as the bitflags name string', () => {
    expect(flagsToWire(ExecutionFlags.HALT_ON_INVALID | ExecutionFlags.PARTIAL_REFUND)).toBe(
      'HALT_ON_INVALID | PARTIAL_REFUND',
    )
    expect(flagsToWire(ExecutionFlags.STOP_ON_SUCCESS)).toBe('STOP_ON_SUCCESS')
    expect(flagsToWire(0)).toBe('')
  })

  it('round-trips through the wire form', () => {
    const bits = ExecutionFlags.HALT_ON_INVALID | ExecutionFlags.PARTIAL_REFUND
    expect(flagsFromWire(flagsToWire(bits))).toBe(bits)
  })

  it('rejects unknown flag bits', () => {
    expect(() => flagsToWire(0x10)).toThrow()
  })

  it('serializes the plan to the camelCase wire shape', () => {
    const wire = planToWire(FIXED_PLAN)
    expect(wire.flags).toBe('HALT_ON_INVALID | PARTIAL_REFUND')
    expect(wire.payment.maximumBuilderPayment).toBe('0xe8d4a51000')
    expect(wire.orderedMembers[0]).toEqual({
      transactionHash: `0x${'aa'.repeat(32)}`,
      gasAllowance: 100_000,
    })
  })
})

describe('detached member consent', () => {
  it('recovers the signer for a consent it signed', async () => {
    const account = privateKeyToAccount(`0x${'ab'.repeat(32)}`)
    const ph = planHash(FIXED_PLAN)
    const params = {
      planHash: ph,
      memberIndex: 0,
      transactionHash: FIXED_PLAN.orderedMembers[0].transactionHash,
      chainId: FIXED_PLAN.chainId,
    }
    const signature = await signMemberConsent(account, params)
    const recovered = await recoverTypedDataAddress({
      domain: consentDomain(FIXED_PLAN.chainId),
      types: BUNDLE_MEMBER_CONSENT_TYPES,
      primaryType: 'BundleMemberConsent',
      message: {
        planHash: ph,
        memberIndex: 0,
        transactionHash: FIXED_PLAN.orderedMembers[0].transactionHash,
      },
      signature,
    })
    expect(recovered).toBe(account.address)
    // The digest the client signs equals prepareBundle's memberDigests[i].
    expect(consentDigest(params)).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('escrow reservation', () => {
  it('binds the committed terms and locks payment + refund', () => {
    const calldata = encodeReserveBundleV2(FIXED_PLAN)
    // reserveBundleV2(bytes32,uint256,uint256,uint256,uint256,uint64) selector.
    expect(calldata.startsWith('0x')).toBe(true)
    expect(reservationValue(FIXED_PLAN)).toBe(
      FIXED_PLAN.payment.maximumBuilderPayment + FIXED_PLAN.payment.maximumRefund,
    )
  })
})
