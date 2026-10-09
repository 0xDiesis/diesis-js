import {
  keccak256,
  hashTypedData,
  stringToHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem'

import { DIESIS_PERPS_BOOK } from '../addresses.js'

/**
 * Sponsored signed bounded V2 perpetual action envelope
 * (`submitSponsoredPerpActions(bytes)`).
 *
 * Mirrors `crates/exchange-wire/src/intent.rs::SignedPerpActionsV2`. The trader
 * signs `{trader, nonce, expiry, actionsHash}` as EIP-712 typed data under the
 * perps-book domain (chain id + perps-book address bound by the domain
 * separator, exactly like the spot `OrderIntent`). `actionsHash` commits to the
 * canonical `ExchangeActionBatch` bytes, so any mutation of the action bytes,
 * chain, contract, nonce, expiry, or trader invalidates the signature.
 */

export const SPONSORED_PERP_ACTIONS_TYPES = {
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

/** keccak256 commitment over the canonical `ExchangeActionBatch` bytes. */
export function computeActionsHash(actions: Hex): Hex {
  return keccak256(actions)
}

/** Exact JSON shape sent as the raw signed-perps payload to `diesis_submitIntent`. */
export interface SignedPerpRelayEnvelope {
  trader: Address
  nonce: string
  expiry: number
  chainId: number
  verifyingContract: Address
  actionsHash: Hex
  actions: Hex
  signature: { r: Hex; s: Hex; v: number }
}

function exactKeys(
  value: object,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== [...expected].sort()[index])
  ) {
    throw new Error(
      `${name} must have exactly the signed-perps envelope fields`,
    )
  }
}

function fixedHex(value: string, bytes: number, name: string): void {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  ) {
    throw new Error(`${name} must be ${bytes} hex bytes`)
  }
}

function safeNumber(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an unsigned safe JSON integer`)
  }
}

/**
 * Predict the node relayer's `actionHash` for this exact raw perps envelope.
 *
 * The inner strings are kept byte-for-byte. The outer nonce is parsed as a
 * uint256 and serialized in Alloy's minimal lowercase hex form, matching the
 * Rust `SignedExchangeAction` normalization. Send this same envelope unchanged.
 * This helper accepts string nonces and JSON integers within JavaScript's safe
 * range; other valid RPC representations are deliberately outside its contract.
 */
export function computePerpRelayActionHash(
  payload: SignedPerpRelayEnvelope,
): Hex {
  if (typeof payload !== 'object' || payload === null)
    throw new Error('signed perps payload must be an object')
  exactKeys(
    payload,
    [
      'trader',
      'nonce',
      'expiry',
      'chainId',
      'verifyingContract',
      'actionsHash',
      'actions',
      'signature',
    ],
    'payload',
  )
  if (typeof payload.signature !== 'object' || payload.signature === null)
    throw new Error('signature must be an object')
  exactKeys(payload.signature, ['r', 's', 'v'], 'signature')
  fixedHex(payload.trader, 20, 'trader')
  fixedHex(payload.verifyingContract, 20, 'verifyingContract')
  fixedHex(payload.actionsHash, 32, 'actionsHash')
  fixedHex(payload.signature.r, 32, 'signature.r')
  fixedHex(payload.signature.s, 32, 'signature.s')
  if (
    typeof payload.actions !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(payload.actions)
  )
    throw new Error('actions must be even-length hex bytes')
  if (
    typeof payload.nonce !== 'string' ||
    !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(payload.nonce)
  )
    throw new Error('nonce must be a uint256 string')
  const nonce = BigInt(payload.nonce)
  if (nonce < 0n || nonce >= 1n << 256n)
    throw new Error('nonce is outside uint256')
  safeNumber(payload.expiry, 'expiry', Number.MAX_SAFE_INTEGER)
  safeNumber(payload.chainId, 'chainId', Number.MAX_SAFE_INTEGER)
  safeNumber(payload.signature.v, 'signature.v', 0xff)

  // Insertion order is the recursive key order of serde_json::Value's map.
  const normalized = {
    action: {
      payload: {
        actions: payload.actions,
        actionsHash: payload.actionsHash,
        chainId: payload.chainId,
        expiry: payload.expiry,
        nonce: payload.nonce,
        signature: {
          r: payload.signature.r,
          s: payload.signature.s,
          v: payload.signature.v,
        },
        trader: payload.trader,
        verifyingContract: payload.verifyingContract,
      },
      type: 'diesis_submitIntent',
    },
    expiresAfter: null,
    nonce: `0x${nonce.toString(16)}`,
    signature: {
      r: payload.signature.r,
      s: payload.signature.s,
      v: payload.signature.v,
    },
    vaultAddress: null,
  }
  return keccak256(
    stringToHex(`diesis_submitIntent\0${JSON.stringify(normalized)}`),
  )
}

export interface SponsoredPerpActionsMessage {
  trader: Address
  nonce: bigint
  expiry: bigint
  /** keccak256 of the canonical action bytes ({@link computeActionsHash}). */
  actionsHash: Hex
}

export function getPerpActionsTypedData(
  message: SponsoredPerpActionsMessage,
  chainId = 1980,
  verifyingContract: Address = DIESIS_PERPS_BOOK,
) {
  return {
    domain: getPerpActionsDomain(chainId, verifyingContract),
    types: SPONSORED_PERP_ACTIONS_TYPES,
    primaryType: 'SignedPerpActionsV2' as const,
    message,
  }
}

/** The EIP-712 signing digest for a signed perp actions envelope. */
export function perpActionsDigest(
  message: SponsoredPerpActionsMessage,
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
  message: SponsoredPerpActionsMessage,
  chainId = 1980,
  verifyingContract: Address = DIESIS_PERPS_BOOK,
): Promise<Hex> {
  return account.signTypedData(
    getPerpActionsTypedData(message, chainId, verifyingContract),
  )
}
