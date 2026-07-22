import {
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  keccak256,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem'

import { DiesisPatronAbi } from '../abi/index.js'
import { DIESIS_PATRON } from '../addresses.js'

/**
 * Self-service bounded campaign onboarding helpers.
 *
 * Mirrors `crates/contracts/src/diesis_patron.rs` and `DiesisPatron.sol`: a
 * campaign owner signs an EIP-712 {@link CampaignVoucherV1} authorizing one
 * exact, bounded onboarding route; a beneficiary claims it to bootstrap gas and
 * install the route without a per-user governance transaction.
 */

/** One exact, bounded onboarding authorization signed by a campaign owner. */
export interface CampaignVoucherV1 {
  campaignId: Hex
  beneficiary: Address
  target: Address
  /** 4-byte function selector the route authorizes. */
  selector: Hex
  maxTransactions: number
  maxLifetimeSpend: bigint
  expiry: bigint | number
  nonce: bigint
}

/**
 * Deterministic, owner-bound campaign id for a `(owner, salt)` pair.
 *
 * `keccak256(abi.encode(address owner, bytes32 salt))` — reproduces
 * `DiesisPatron.campaignIdFor` so a client can derive the id a registration
 * will own before submitting it and bind vouchers to it.
 */
export function campaignIdFor(owner: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }],
      [owner, salt],
    ),
  )
}

/** EIP-712 types for the `CampaignVoucherV1` struct. */
export const CAMPAIGN_VOUCHER_TYPES = {
  CampaignVoucherV1: [
    { name: 'campaignId', type: 'bytes32' },
    { name: 'beneficiary', type: 'address' },
    { name: 'target', type: 'address' },
    { name: 'selector', type: 'bytes4' },
    { name: 'maxTransactions', type: 'uint32' },
    { name: 'maxLifetimeSpend', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

/**
 * EIP-712 domain for campaign vouchers, bound to the chain and Patron address
 * so a signature cannot be replayed across chains or a redeployed contract.
 */
export function campaignVoucherDomain(
  chainId: number | bigint,
  patron: Address = DIESIS_PATRON,
): TypedDataDomain {
  return {
    name: 'DiesisPatron',
    version: '1',
    chainId: Number(chainId),
    verifyingContract: patron,
  }
}

function voucherMessage(voucher: CampaignVoucherV1) {
  return {
    campaignId: voucher.campaignId,
    beneficiary: voucher.beneficiary,
    target: voucher.target,
    selector: voucher.selector,
    maxTransactions: voucher.maxTransactions,
    maxLifetimeSpend: voucher.maxLifetimeSpend,
    expiry: BigInt(voucher.expiry),
    nonce: voucher.nonce,
  }
}

/**
 * The EIP-712 signing digest a campaign owner signs to authorize a voucher.
 * Byte-identical to `DiesisPatron.campaignVoucherDigest`.
 */
export function campaignVoucherDigest(
  voucher: CampaignVoucherV1,
  chainId: number | bigint,
  patron: Address = DIESIS_PATRON,
): Hex {
  return hashTypedData({
    domain: campaignVoucherDomain(chainId, patron),
    types: CAMPAIGN_VOUCHER_TYPES,
    primaryType: 'CampaignVoucherV1',
    message: voucherMessage(voucher),
  })
}

export interface CampaignVoucherAccount {
  address: Address
  signTypedData: (typedData: {
    domain: TypedDataDomain
    types: typeof CAMPAIGN_VOUCHER_TYPES
    primaryType: 'CampaignVoucherV1'
    message: ReturnType<typeof voucherMessage>
  }) => Promise<Hex>
}

/** Sign a campaign voucher with a local or wallet-backed account. */
export async function signCampaignVoucher(
  account: CampaignVoucherAccount,
  voucher: CampaignVoucherV1,
  chainId: number | bigint,
  patron: Address = DIESIS_PATRON,
): Promise<Hex> {
  return account.signTypedData({
    domain: campaignVoucherDomain(chainId, patron),
    types: CAMPAIGN_VOUCHER_TYPES,
    primaryType: 'CampaignVoucherV1',
    message: voucherMessage(voucher),
  })
}

// ── Calldata encoders ───────────────────────────────────────────────────────

/** Build `registerCampaignV1(salt)` calldata; the contract owns the derived id. */
export function encodeRegisterCampaign(salt: Hex): Hex {
  return encodeFunctionData({
    abi: DiesisPatronAbi,
    functionName: 'registerCampaignV1',
    args: [salt],
  })
}

/** Build `claimCampaignVoucherV1(voucher, signature)` calldata. */
export function encodeClaimCampaignVoucher(
  voucher: CampaignVoucherV1,
  signature: Hex,
): Hex {
  return encodeFunctionData({
    abi: DiesisPatronAbi,
    functionName: 'claimCampaignVoucherV1',
    args: [
      {
        campaignId: voucher.campaignId,
        beneficiary: voucher.beneficiary,
        target: voucher.target,
        selector: voucher.selector,
        maxTransactions: voucher.maxTransactions,
        maxLifetimeSpend: voucher.maxLifetimeSpend,
        expiry: BigInt(voucher.expiry),
        nonce: voucher.nonce,
      },
      signature,
    ],
  })
}

/** Build `setCampaignRevokedV1(campaignId, revoked)` calldata. */
export function encodeSetCampaignRevoked(
  campaignId: Hex,
  revoked: boolean,
): Hex {
  return encodeFunctionData({
    abi: DiesisPatronAbi,
    functionName: 'setCampaignRevokedV1',
    args: [campaignId, revoked],
  })
}

/** Build `revokeCampaignVoucherV1(campaignId, beneficiary, nonce)` calldata. */
export function encodeRevokeCampaignVoucher(
  campaignId: Hex,
  beneficiary: Address,
  nonce: bigint,
): Hex {
  return encodeFunctionData({
    abi: DiesisPatronAbi,
    functionName: 'revokeCampaignVoucherV1',
    args: [campaignId, beneficiary, nonce],
  })
}

/** Build `rotateCampaignOwnerV1(campaignId, newOwner)` calldata. */
export function encodeRotateCampaignOwner(
  campaignId: Hex,
  newOwner: Address,
): Hex {
  return encodeFunctionData({
    abi: DiesisPatronAbi,
    functionName: 'rotateCampaignOwnerV1',
    args: [campaignId, newOwner],
  })
}
