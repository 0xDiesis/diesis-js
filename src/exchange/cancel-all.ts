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

/**
 * Compatibility wrapper for callers that supply the verifying contract before
 * the optional chain ID.
 */
export function getCancelAllSpotIntentTypedData(
  intent: CancelAllSpotIntent,
  verifyingContract: Address,
  chainId = 1980,
) {
  return getCancelAllTypedData(intent, chainId, verifyingContract)
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

export interface CancelAllSpotIntentAccount {
  address: Address
  signTypedData: (
    typedData: ReturnType<typeof getCancelAllSpotIntentTypedData>,
  ) => Promise<Hex>
}

export interface BuildSignedCancelAllSpotIntentArgs {
  account: CancelAllSpotIntentAccount
  intent: CancelAllSpotIntent
  verifyingContract: Address
  chainId?: number
}

function assertCancelAllSpotIntent(
  intent: unknown,
): asserts intent is CancelAllSpotIntent {
  if (!intent || typeof intent !== 'object') {
    throw new Error('cancel-all intent must be an object')
  }
  const candidate = intent as Partial<CancelAllSpotIntent>
  if (
    typeof candidate.trader !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(candidate.trader)
  ) {
    throw new Error(
      'cancel-all intent: trader must be a 0x-prefixed 20-byte address',
    )
  }
  if (
    typeof candidate.marketId !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(candidate.marketId)
  ) {
    throw new Error('cancel-all intent: marketId must be a 0x-prefixed bytes32')
  }
  if (
    typeof candidate.expiry !== 'bigint' &&
    typeof candidate.expiry !== 'number'
  ) {
    throw new Error('cancel-all intent: expiry is required')
  }
  if (
    typeof candidate.nonce !== 'bigint' &&
    typeof candidate.nonce !== 'number' &&
    typeof candidate.nonce !== 'string'
  ) {
    throw new Error('cancel-all intent: nonce is required')
  }
}

function assertNotExpired(expiry: bigint): void {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
  if (expiry <= nowSeconds) {
    throw new Error(
      `cancel-all intent: expiry ${expiry} is already in the past (now ${nowSeconds})`,
    )
  }
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

/** Validate and sign a market-scoped cancel-all intent. */
export async function buildSignedCancelAllSpotIntent(
  args: BuildSignedCancelAllSpotIntentArgs,
): Promise<SignedCancelAllSpotIntent> {
  assertCancelAllSpotIntent(args.intent)
  const normalized = {
    ...args.intent,
    expiry: BigInt(args.intent.expiry),
  }
  assertNotExpired(normalized.expiry)
  return signCancelAllSpotIntent(
    args.account,
    normalized,
    args.chainId ?? 1980,
    args.verifyingContract,
  )
}
