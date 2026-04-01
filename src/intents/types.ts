import type { Hex, Address } from 'viem'

export interface OrderIntent {
  marketId: Hex
  side: number
  price: bigint
  amount: bigint
  orderType: number
  nonce: bigint
  expiry: bigint
  reduceOnly: boolean
}

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
