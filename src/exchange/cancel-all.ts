import {
  hashTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem'

import { DIESIS_SPOT_BOOK } from '../addresses.js'

/**
 * Typed signed cancel-all-orders intent
 * (`submitSignedCancelAllSpotIntent(bytes)`).
 *
 * Mirrors the Rust `CancelAllSpotIntent` wire hasher and the Solidity
 * `_cancelAllDigest` in `contracts/test/exchange/ExchangePrecompileInterfaces.t.sol`.
 * One signature cancels every open order for `trader` on `marketId`.
 */

export const CANCEL_ALL_SPOT_INTENT_TYPES = {
  CancelAllSpotIntent: [
    { name: 'trader', type: 'address' },
    { name: 'marketId', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

export interface CancelAllSpotIntent {
  trader: Address
  marketId: Hex
  /** Expiry timestamp (uint64); 0 means no expiry. */
  expiry: bigint
  nonce: bigint
}

export interface SignedCancelAllSpotIntent {
  intent: CancelAllSpotIntent
  signature: Hex
  signer: Address
}

/** EIP-712 domain for a cancel-all intent (the spot book domain). */
export function getCancelAllDomain(
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

export function getCancelAllTypedData(
  intent: CancelAllSpotIntent,
  chainId = 1980,
  verifyingContract: Address = DIESIS_SPOT_BOOK,
) {
  return {
    domain: getCancelAllDomain(chainId, verifyingContract),
    types: CANCEL_ALL_SPOT_INTENT_TYPES,
    primaryType: 'CancelAllSpotIntent' as const,
    message: intent,
  }
}

/** The EIP-712 signing digest for a cancel-all intent. */
export function cancelAllDigest(
  intent: CancelAllSpotIntent,
  chainId = 1980,
  verifyingContract: Address = DIESIS_SPOT_BOOK,
): Hex {
  return hashTypedData(
    getCancelAllTypedData(intent, chainId, verifyingContract),
  )
}

export interface CancelAllAccount {
  address: Address
  signTypedData: (
    typedData: ReturnType<typeof getCancelAllTypedData>,
  ) => Promise<Hex>
}

/**
 * Sign a cancel-all intent. The wire envelope submitted to the node is the
 * `{ intent, signature }` pair returned here.
 */
export async function signCancelAllSpotIntent(
  account: CancelAllAccount,
  intent: CancelAllSpotIntent,
  chainId = 1980,
  verifyingContract: Address = DIESIS_SPOT_BOOK,
): Promise<SignedCancelAllSpotIntent> {
  const signature = await account.signTypedData(
    getCancelAllTypedData(intent, chainId, verifyingContract),
  )
  return { intent, signature, signer: account.address }
}
