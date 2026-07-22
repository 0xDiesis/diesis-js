import {
  keccak256,
  hashTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem'

import { DIESIS_PERPS_BOOK } from '../addresses.js'

/**
 * Sponsored signed bounded V2 perpetual action envelope
 * (`submitSignedPerpActionsV2(bytes)`).
 *
 * Mirrors `crates/exchange-wire/src/intent.rs::SignedPerpActionsV2`. The trader
 * signs `{trader, nonce, expiry, actionsHash}` as EIP-712 typed data under the
 * perps-book domain (chain id + perps-book address bound by the domain
 * separator, exactly like the spot `OrderIntent`). `actionsHash` commits to the
 * canonical `ExchangeActionBatchV2` bytes, so any mutation of the action bytes,
 * chain, contract, nonce, expiry, or trader invalidates the signature.
 */

export const SIGNED_PERP_ACTIONS_V2_TYPES = {
  SignedPerpActionsV2: [
    { name: 'trader', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'actionsHash', type: 'bytes32' },
  ],
} as const

/** EIP-712 domain for the perps book (the `IntentDomain::perps` domain). */
export function getPerpActionsDomain(
  chainId: number,
  verifyingContract: Address = DIESIS_PERPS_BOOK,
): TypedDataDomain {
  return {
    name: 'Diesis Exchange',
    version: '2',
    chainId,
    verifyingContract,
  }
}

/** keccak256 commitment over the canonical `ExchangeActionBatchV2` bytes. */
export function computeActionsHash(actions: Hex): Hex {
  return keccak256(actions)
}

export interface SignedPerpActionsV2Message {
  trader: Address
  nonce: bigint
  expiry: bigint
  /** keccak256 of the canonical action bytes ({@link computeActionsHash}). */
  actionsHash: Hex
}

export function getPerpActionsTypedData(
  message: SignedPerpActionsV2Message,
  chainId = 1980,
  verifyingContract: Address = DIESIS_PERPS_BOOK,
) {
  return {
    domain: getPerpActionsDomain(chainId, verifyingContract),
    types: SIGNED_PERP_ACTIONS_V2_TYPES,
    primaryType: 'SignedPerpActionsV2' as const,
    message,
  }
}

/** The EIP-712 signing digest for a signed perp actions envelope. */
export function perpActionsDigest(
  message: SignedPerpActionsV2Message,
  chainId = 1980,
  verifyingContract: Address = DIESIS_PERPS_BOOK,
): Hex {
  return hashTypedData(
    getPerpActionsTypedData(message, chainId, verifyingContract),
  )
}

export interface PerpActionsAccount {
  address: Address
  signTypedData: (
    typedData: ReturnType<typeof getPerpActionsTypedData>,
  ) => Promise<Hex>
}

/** Sign a signed perp actions envelope with a local or wallet-backed account. */
export async function signPerpActions(
  account: PerpActionsAccount,
  message: SignedPerpActionsV2Message,
  chainId = 1980,
  verifyingContract: Address = DIESIS_PERPS_BOOK,
): Promise<Hex> {
  return account.signTypedData(
    getPerpActionsTypedData(message, chainId, verifyingContract),
  )
}
