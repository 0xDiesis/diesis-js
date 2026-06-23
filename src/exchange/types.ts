import type { Address, Hex } from 'viem'

export enum Side {
  Buy = 0,
  Sell = 1,
}
export enum OrderType {
  LimitGTC = 0,
  LimitGTD = 1,
  LimitIOC = 2,
  LimitFOK = 3,
  LimitPostOnly = 4,
  Market = 5,
  StopLimit = 6,
  StopMarket = 7,
}
export enum MarginType {
  Cross = 0,
  Isolated = 1,
  Unified = 2,
}
export enum MarketType {
  Spot = 0,
  Perp = 1,
}
export enum MarketStatus {
  Created = 0,
  Active = 1,
  Paused = 2,
  Delisted = 3,
}

export interface PriceLevel {
  price: bigint
  amount: bigint
  orders: number
}
export interface OrderBook {
  bids: PriceLevel[]
  asks: PriceLevel[]
}
export interface MarketInfo {
  marketId: Hex
  baseToken: Address
  quoteToken: Address
  marketType: MarketType
  status: MarketStatus
  tickSize: bigint
  lotSize: bigint
}
export interface TradingAccount {
  user?: Address
  balances?: TokenBalance[]
  open_order_count?: number
  open_position_count?: number
  available?: bigint
  lockedInOrders?: bigint
  lockedInMargin?: bigint
}
export interface Position {
  marketId: Hex
  owner: Address
  side: Side
  size: bigint
  entryPrice: bigint
  marginType: MarginType
  isolatedMargin: bigint
  realizedPnl: bigint
  lastFundingIndex: bigint
}
export interface Trade {
  marketId: Hex
  orderId: Hex
  trader: Address
  fillPrice: bigint
  fillAmount: bigint
  isMaker: boolean
  blockNumber: bigint
}
export interface FundingRate {
  marketId: Hex
  rate: bigint
  timestamp: bigint
}
export interface FundingRateInfo {
  market_id: Hex
  current_rate_bps: number
  cumulative_index: string | number | bigint
}
export interface InsuranceFundStatus {
  market_id: Hex
  market_balance: string | number | bigint
  global_balance: string | number | bigint
}
export interface TokenBalance {
  token: Address
  available: string | number | bigint
  locked: string | number | bigint
  total: string | number | bigint
}
export type MarkPrice = [marketId: Hex, price: string | number | bigint]
export interface FillEstimate {
  avgPrice: bigint
  totalCost: bigint
  fills: number
  slippageBps: number
}
