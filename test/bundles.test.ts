import { readFileSync } from 'node:fs'

import { recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  BUNDLE_MEMBER_CONSENT_TYPES,
  canonicalBundle,
  consentDigest,
  consentDomain,
  ExecutionFlags,
  flagsFromWire,
  flagsToWire,
  planHash,
  planToWire,
  signMemberConsent,
  type BundlePlan,
} from '../src/bundles/index.js'
import { encodeReserveBundle, reservationValue } from '../src/bundles/index.js'

describe('bundle documentation', () => {
  it('uses the canonical bundle prepare and submit shapes', () => {
    const readme = readFileSync(
      new URL('../README.md', import.meta.url),
      'utf8',
    )
    const section = readme.match(
      /## Bundle transactions\n([\s\S]*?)\n## Sponsor gas/,
    )?.[1]

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
const FIXED_PLAN: BundlePlan = {
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
  '0x98aed8516819bcacc928cdd7ce39ba1e9b5385457518ad000c0f2580c6f628be'

describe('bundle plan hash', () => {
  it('reproduces the frozen cross-language fixed vector', () => {
    expect(planHash(FIXED_PLAN)).toBe(FIXED_PLAN_HASH)
  })

  it('produces canonical bytes of the expected length', () => {
    // 8 + 8 + 2 + 20 + 32*4 + 4 + members*(32 + 8)
    const expected = 8 + 8 + 2 + 20 + 32 * 4 + 4 + 2 * (32 + 8)
    const bytes = canonicalBundle(FIXED_PLAN)
    expect((bytes.length - 2) / 2).toBe(expected)
  })

  it('changes when any committed field mutates', () => {
    const mutated: BundlePlan = {
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
    expect(
      flagsToWire(
        ExecutionFlags.HALT_ON_INVALID | ExecutionFlags.PARTIAL_REFUND,
      ),
    ).toBe('HALT_ON_INVALID | PARTIAL_REFUND')
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
  it('matches the initial signing-domain fixed vector', () => {
    expect(consentDomain(8080).version).toBe('1')
    expect(
      consentDigest({
        chainId: 8080,
        planHash: FIXED_PLAN_HASH,
        memberIndex: 0,
        transactionHash: FIXED_PLAN.orderedMembers[0].transactionHash,
      }),
    ).toBe('0x8310139648d01f069b8af2430a4c923df023334114e874ea00688876a97b1438')
  })

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
    const calldata = encodeReserveBundle(FIXED_PLAN)
    // reserveBundle(bytes32,uint256,uint256,uint256,uint256,uint64) selector.
    expect(calldata.slice(0, 10)).toBe('0x793baef2')
    expect(reservationValue(FIXED_PLAN)).toBe(
      FIXED_PLAN.payment.maximumBuilderPayment +
        FIXED_PLAN.payment.maximumRefund,
    )
  })
})
