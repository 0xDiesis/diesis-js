import type { Hex, Address } from 'viem'

/**
 * EIP-712 v2 OrderIntent payload.
 *
 * Mirrors `crates/exchange/src/intents/order_intent.rs::OrderIntent` exactly,
 * including field order and on-chain types. The canonical typeHash string is:
 *
 * ```
 * OrderIntent(address trader,bytes32 marketId,uint8 side,uint8 orderType,
 *   uint256 price,uint256 amount,uint256 triggerPrice,uint64 expiry,
 *   uint256 nonce,uint8 flags,address conductor,uint16 conductorFeeBps,
 *   uint256 maxConductorFee)
 * ```
 *
 * The Rust regression fixture
 * `order_intent_v2_struct_hash_canonical_regression` pins the struct hash
 * for `OrderIntent::default()`-equivalent values; TS-side signatures must
 * produce the same hash for the same inputs.
 */
export interface OrderIntent {
  /** Trader address (the economic actor whose balances move). */
  trader: Address
  /** Market identifier (bytes32). */
  marketId: Hex
  /** 0 = Buy, 1 = Sell. */
  side: number
  /** Order type tag — Limit, Market, etc. See Rust `OrderType`. */
  orderType: number
  /** Limit price in ticks; 0 for market orders. */
  price: bigint
  /** Quantity in base lots. */
  amount: bigint
  /** Trigger price for stop orders; 0 if not a stop. */
  triggerPrice: bigint
  /** Expiry timestamp (uint64); 0 means default max lifetime. */
  expiry: bigint
  /** Bitmap nonce for replay protection. */
  nonce: bigint
  /** Order flag bits (POST_ONLY, REDUCE_ONLY, IOC, FOK). See {@link OrderFlags}. */
  flags: number
  /** Conductor address (zero address = no conductor attribution). */
  conductor: Address
  /** Requested conductor add-on fee in basis points, capped by tier at fill time. */
  conductorFeeBps: number
  /** Absolute per-order maximum conductor fee in the fill fee asset. */
  maxConductorFee: bigint
}

/** Bit values for {@link OrderIntent.flags}, mirroring Rust `OrderFlags`. */
export const OrderFlags = {
  NONE: 0,
  POST_ONLY: 1 << 0,
  REDUCE_ONLY: 1 << 1,
  IOC: 1 << 2,
  FOK: 1 << 3,
} as const

export interface SignedOrderIntent {
  intent: OrderIntent
  signature: Hex
  signer: Address
}

export interface TradingKeyAuthorization {
  tradingKey: Address
  expiry: bigint
  maxNotional: bigint
  markets: Hex[]
  canWithdraw: boolean
}
