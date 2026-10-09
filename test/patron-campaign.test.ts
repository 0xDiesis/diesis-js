import { recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  CAMPAIGN_VOUCHER_TYPES,
  campaignIdFor,
  campaignVoucherDigest,
  campaignVoucherDomain,
  encodeClaimCampaignVoucher,
  encodeRegisterCampaign,
  signCampaignVoucher,
  type CampaignVoucherV1,
} from '../src/patronage/campaign.js'
import { DIESIS_PATRON } from '../src/addresses.js'

const OWNER = '0x00000000000000000000000000000000000000aa' as const
const SALT = `0x${'5c'.repeat(32)}` as const

describe('campaign id derivation', () => {
  it('is deterministic and owner-bound', () => {
    const id = campaignIdFor(OWNER, SALT)
    expect(id).toMatch(/^0x[0-9a-f]{64}$/)
    expect(campaignIdFor(OWNER, SALT)).toBe(id)
    // A different owner front-running the same salt derives a different id.
    expect(campaignIdFor('0x00000000000000000000000000000000000000bb', SALT)).not.toBe(id)
  })
})

describe('campaign voucher signing', () => {
  it('recovers the campaign owner from a voucher it signed', async () => {
    const owner = privateKeyToAccount(`0x${'a1'.repeat(32)}`)
    const voucher: CampaignVoucherV1 = {
      campaignId: campaignIdFor(owner.address, SALT),
      beneficiary: '0x00000000000000000000000000000000000000cd',
      target: '0x00000000000000000000000000000000000000de',
      selector: '0xdeadbeef',
      maxTransactions: 5,
      maxLifetimeSpend: 1_000_000n,
      expiry: 1_900_000_000n,
      nonce: 1n,
    }
    const signature = await signCampaignVoucher(owner, voucher, 1980)
    const recovered = await recoverTypedDataAddress({
      domain: campaignVoucherDomain(1980, DIESIS_PATRON),
      types: CAMPAIGN_VOUCHER_TYPES,
      primaryType: 'CampaignVoucherV1',
      message: {
        campaignId: voucher.campaignId,
        beneficiary: voucher.beneficiary,
        target: voucher.target,
        selector: voucher.selector,
        maxTransactions: voucher.maxTransactions,
        maxLifetimeSpend: voucher.maxLifetimeSpend,
        expiry: voucher.expiry,
        nonce: voucher.nonce,
      },
      signature,
    })
    expect(recovered).toBe(owner.address)
    expect(campaignVoucherDigest(voucher, 1980)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('builds register and claim calldata', () => {
    expect(encodeRegisterCampaign(SALT).startsWith('0x')).toBe(true)
    const voucher: CampaignVoucherV1 = {
      campaignId: campaignIdFor(OWNER, SALT),
      beneficiary: '0x00000000000000000000000000000000000000cd',
      target: '0x00000000000000000000000000000000000000de',
      selector: '0xdeadbeef',
      maxTransactions: 5,
      maxLifetimeSpend: 1_000_000n,
      expiry: 1_900_000_000n,
      nonce: 1n,
    }
    const claim = encodeClaimCampaignVoucher(voucher, `0x${'00'.repeat(65)}`)
    expect(claim.startsWith('0x')).toBe(true)
  })
})
