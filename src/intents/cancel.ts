import type { Address, Hex, TypedDataDomain } from 'viem'

import { DIESIS_SPOT_BOOK } from '../addresses.js'

// Mirrors the on-chain `CancelIntent` struct (single-order cancel by signed
// nonce). Field order is canonical and must not be reordered (it determines
// the EIP-712 typeHash).
export interface CancelIntent {
  trader: Address
  nonce: bigint
}

export interface SignedCancelIntent {
  intent: CancelIntent
  signature: Hex
  signer: Address
}

export const CANCEL_INTENT_TYPES = {
  CancelIntent: [
    { name: 'trader', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

/** EIP-712 domain for a single-order cancellation intent. */
export function getCancelIntentDomain(
  chainId = 1980,
  verifyingContract: Address = DIESIS_SPOT_BOOK,
): TypedDataDomain {
  return {
    name: 'Diesis Exchange',
    version: '2',
    chainId,
    verifyingContract,
  }
}

export function getCancelIntentTypedData(
  intent: CancelIntent,
  chainId = 1980,
  verifyingContract: Address = DIESIS_SPOT_BOOK,
) {
  return {
    domain: getCancelIntentDomain(chainId, verifyingContract),
    types: CANCEL_INTENT_TYPES,
    primaryType: 'CancelIntent' as const,
    message: intent,
  }
}

export interface CancelIntentAccount {
  address: Address
  signTypedData: (
    typedData: ReturnType<typeof getCancelIntentTypedData>,
  ) => Promise<Hex>
}

/** Sign a single-order cancel intent for submission to the spot book. */
export async function signCancelIntent(
  account: CancelIntentAccount,
  intent: CancelIntent,
  chainId = 1980,
  verifyingContract: Address = DIESIS_SPOT_BOOK,
): Promise<SignedCancelIntent> {
  const signature = await account.signTypedData(
    getCancelIntentTypedData(intent, chainId, verifyingContract),
  )
  return { intent, signature, signer: account.address }
}
