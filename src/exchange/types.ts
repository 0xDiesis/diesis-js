import type { Address, Hex } from 'viem'

export enum Side {
  Buy = 0,
  Sell = 1,
}
export enum OrderType {
  Limit = 0,
  Market = 1,
  StopLimit = 2,
  StopMarket = 3,
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
  marketId: Hex
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
  user: Address
  balances: TokenBalance[]
  open_order_count: number
  open_position_count: number
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
/** Native recent fills contain no order ID, trader address, or maker flag. */
export interface Trade {
  marketId: Hex
  price: bigint
  quantity: bigint
  side: Side
  blockNumber: bigint
}
export interface FundingRate {
  marketId: Hex
  rate: bigint
  timestamp: bigint
}
export interface FundingRateInfo {
  market_id: Hex
  current_rate_bps: bigint
  cumulative_index: bigint
}
export interface InsuranceFundStatus {
  market_id: Hex
  market_balance: bigint
  global_balance: bigint
}
export interface TokenBalance {
  token: Address
  available: bigint
  locked: bigint
  total: bigint
}
export type MarkPrice = [marketId: Hex, price: bigint]
export interface FillEstimate {
  avgPrice: bigint
  totalCost: bigint
  fills: number
  slippageBps: number
}
/** Versioned canonical claim-transfer capability. Amounts are quote atomic-unit decimal strings. */
export type PositionCollateralCapability = {
  capabilityVersion: 1
  active: boolean
  eligible: boolean
  user: import('viem').Address
  marketId: import('viem').Hex
  quoteToken: import('viem').Address
  side: number | null
  size: string | null
  currentClaim: string | null
  addableCollateral: string | null
  withdrawableCollateral: string | null
  unavailableReason: string | null
}

/** Canonical anchor retained after exact quantity decoding. */
export interface IndexedResponse<T> {
  blockNumber: bigint
  blockHash: Hex
  indexDigest: Hex
  data: T
}

/** Rust integer fields are JSON numbers. String forms allow exact transports. */
export type ExchangeRpcInteger = number | string
/** Alloy U256 fields are JSON quantity strings, never JavaScript bigints. */
export type ExchangeRpcQuantity = string
export interface ExchangeRpcIndexedResponse<T> {
  blockNumber: ExchangeRpcInteger
  blockHash: Hex
  indexDigest: Hex
  data: T
}
export interface ExchangeRpcPriceLevel {
  price: ExchangeRpcInteger
  quantity: ExchangeRpcInteger
  order_count: number
}
export interface ExchangeRpcOrderBook {
  market_id: Hex
  bids: ExchangeRpcPriceLevel[]
  asks: ExchangeRpcPriceLevel[]
}
export interface ExchangeRpcMarket {
  market_id: Hex
  base_token: Address
  quote_token: Address
  market_type: number
  state: number
  tick_size: ExchangeRpcInteger
  lot_size: ExchangeRpcInteger
}
export interface ExchangeRpcTokenBalance {
  token: Address
  available: ExchangeRpcQuantity
  locked: ExchangeRpcQuantity
  total: ExchangeRpcQuantity
}
export interface ExchangeRpcAccount {
  user: Address
  balances: ExchangeRpcTokenBalance[]
  open_order_count: number
  open_position_count: number
}
export interface ExchangeRpcTrade {
  market_id: Hex
  price: ExchangeRpcInteger
  quantity: ExchangeRpcInteger
  side: number
  block_number: ExchangeRpcInteger
}
export interface ExchangeRpcFillEstimate {
  avgPrice: ExchangeRpcQuantity
  totalCost: ExchangeRpcQuantity
  fills: number
  slippageBps: number
}
export interface ExchangeRpcFundingRateInfo {
  market_id: Hex
  current_rate_bps: ExchangeRpcInteger
  cumulative_index: ExchangeRpcInteger
}
export interface ExchangeRpcInsuranceFundStatus {
  market_id: Hex
  market_balance: ExchangeRpcQuantity
  global_balance: ExchangeRpcQuantity
}
export type ExchangeRpcMarkPrice = [marketId: Hex, price: ExchangeRpcInteger]

export interface FeeEpochStatus {
  marketId: Hex
  epoch: bigint
  policyRevision: bigint
  backstopTopupBps: number
  burn: Address
  treasury: Address
  validators: Address
  residualSplitBps: [number, number, number]
  snapshotHash: Hex
  accruedTotal: bigint
  distributionId: Hex
  finalized: boolean
}
export interface PerpFeeBalances {
  marketId: Hex
  quoteToken: Address
  protocolFee: bigint
  marketInsurance: bigint
  globalInsuranceReserve: bigint
  backstopCollateral: bigint
}
export interface PerpFeeRecipientAllocation {
  recipient: Address
  amount: bigint
}
export interface PerpFeeDistributionAllocation {
  quoteToken: Address
  policyRevision: bigint
  backstopTopupBps: number
  residualSplitBps: [number, number, number]
  snapshotHash: Hex
  accruedTotal: bigint
  distributionId: Hex | null
  marketInsuranceTopup: bigint
  burn: PerpFeeRecipientAllocation
  treasury: PerpFeeRecipientAllocation
  validators: PerpFeeRecipientAllocation
}
export interface PerpFeeDistributionRead {
  marketId: Hex
  epoch: bigint
  state: 'absent' | 'projected' | 'finalized'
  allocation: PerpFeeDistributionAllocation | null
}
export interface FeeEpochHistoryCursor {
  marketId: Hex
  fromEpoch: bigint
  toEpoch: bigint
  nextEpoch: bigint
  anchorBlockNumber: bigint
  anchorBlockHash: Hex
}
export interface GetFeeEpochHistoryParams {
  marketId: Hex
  fromEpoch: bigint
  toEpoch: bigint
  cursor?: FeeEpochHistoryCursor | null
  limit?: number
  scanBudget?: number
}
export interface FeeEpochHistoryPage {
  rows: FeeEpochStatus[]
  next: FeeEpochHistoryCursor | null
}
export type PerpHistoryKind = 'trade' | 'funding' | 'liquidation'
export interface PerpHistoryCursor {
  marketId: Hex
  kind: PerpHistoryKind
  fromBlock: bigint
  toBlock: bigint
  nextBlockNumber: bigint
  nextLogIndex: bigint
  anchorBlockNumber: bigint
  anchorBlockHash: Hex
  generation: bigint
}
export interface GetPerpHistoryParams {
  marketId: Hex
  kind: PerpHistoryKind
  fromBlock: bigint
  toBlock: bigint
  cursor?: PerpHistoryCursor | null
  limit?: number
  scanBudget?: number
}
export interface PerpHistoryRow {
  kind: PerpHistoryKind
  eventTag: number
  blockNumber: bigint
  blockHash: Hex
  transactionHash: Hex
  transactionIndex: number
  logIndex: bigint
  emitter: Address
  topics: Hex[]
  /** Exact native Vec<u8> receipt bytes, retained without ABI interpretation. */
  data: number[]
}
export interface PerpHistoryPage {
  rows: PerpHistoryRow[]
  next: PerpHistoryCursor | null
}
export interface OracleStatusInfo {
  marketId: Hex
  accepted: boolean
  round: bigint
  observedAt: bigint
  indexPrice: bigint
  markPrice: bigint
  sourceSetHash: Hex
  evidenceHash: Hex
  status: number
  divergenceCount: bigint
  recoveryCount: bigint
}
export interface PerpProtectionInfo {
  marketId: Hex
  continuationKind: number
  side: number
  boundary: bigint
  target: bigint
  backstopCollateral: bigint
}
export interface CanonicalPerpPosition {
  user: Address
  marketId: Hex
  side: Side
  size: bigint
  storedClaim: bigint
  currentClaim: bigint
  priceIndex: bigint
  fundingIndex: bigint
}
export interface OpeningAuctionSummary {
  marketId: Hex
  startBlock: bigint
  endBlock: bigint
  referencePrice: bigint
  finalized: boolean
  clearingPrice: bigint
  totalVolume: bigint
}
export interface GenerateSeedLiquidityPlanParams {
  marketId: Hex
  referencePrice: bigint
  levels: number
  baseQuantity: bigint
  tickSpacing: bigint
}
export interface SeedLiquidityOrderTemplate {
  marketId: Hex
  side: Side
  price: bigint
  quantity: bigint
}
export interface SeedLiquidityPlan {
  marketId: Hex
  referencePrice: bigint
  orders: SeedLiquidityOrderTemplate[]
}
/** Native u64 fields use JSON integers; U256 overrides below use quantities. */
type ExchangeRpcIntegerFields<T> = {
  [K in keyof T]: T[K] extends bigint ? ExchangeRpcInteger : T[K]
}
export type ExchangeRpcFeeEpochStatus = Omit<
  ExchangeRpcIntegerFields<FeeEpochStatus>,
  'accruedTotal'
> & { accruedTotal: ExchangeRpcQuantity }
export type ExchangeRpcPerpFeeBalances = Omit<
  PerpFeeBalances,
  | 'protocolFee'
  | 'marketInsurance'
  | 'globalInsuranceReserve'
  | 'backstopCollateral'
> & {
  protocolFee: ExchangeRpcQuantity
  marketInsurance: ExchangeRpcQuantity
  globalInsuranceReserve: ExchangeRpcQuantity
  backstopCollateral: ExchangeRpcQuantity
}
export type ExchangeRpcFeeEpochHistoryCursor =
  ExchangeRpcIntegerFields<FeeEpochHistoryCursor>
export type ExchangeRpcFeeEpochHistoryPage = {
  rows: ExchangeRpcFeeEpochStatus[]
  next: ExchangeRpcFeeEpochHistoryCursor | null
}
export type ExchangeRpcPerpHistoryCursor =
  ExchangeRpcIntegerFields<PerpHistoryCursor>
export type ExchangeRpcPerpHistoryRow = ExchangeRpcIntegerFields<PerpHistoryRow>
export type ExchangeRpcPerpHistoryPage = {
  rows: ExchangeRpcPerpHistoryRow[]
  next: ExchangeRpcPerpHistoryCursor | null
}
export type ExchangeRpcPerpFeeRecipientAllocation = {
  recipient: Address
  amount: ExchangeRpcQuantity
}
export type ExchangeRpcPerpFeeDistributionAllocation = Omit<
  ExchangeRpcIntegerFields<PerpFeeDistributionAllocation>,
  'accruedTotal' | 'marketInsuranceTopup' | 'burn' | 'treasury' | 'validators'
> & {
  accruedTotal: ExchangeRpcQuantity
  marketInsuranceTopup: ExchangeRpcQuantity
  burn: ExchangeRpcPerpFeeRecipientAllocation
  treasury: ExchangeRpcPerpFeeRecipientAllocation
  validators: ExchangeRpcPerpFeeRecipientAllocation
}
export type ExchangeRpcPerpFeeDistributionRead = Omit<
  ExchangeRpcIntegerFields<PerpFeeDistributionRead>,
  'allocation'
> & { allocation: ExchangeRpcPerpFeeDistributionAllocation | null }
export type ExchangeRpcOracleStatusInfo =
  ExchangeRpcIntegerFields<OracleStatusInfo>
export type ExchangeRpcPerpProtectionInfo = Omit<
  PerpProtectionInfo,
  'boundary' | 'target' | 'backstopCollateral'
> & {
  boundary: ExchangeRpcQuantity
  target: ExchangeRpcQuantity
  backstopCollateral: ExchangeRpcQuantity
}
export type ExchangeRpcCanonicalPerpPosition = Omit<
  CanonicalPerpPosition,
  'size' | 'storedClaim' | 'currentClaim' | 'priceIndex' | 'fundingIndex'
> & {
  size: ExchangeRpcQuantity
  storedClaim: ExchangeRpcQuantity
  currentClaim: ExchangeRpcQuantity
  priceIndex: ExchangeRpcQuantity
  fundingIndex: ExchangeRpcQuantity
}
export type ExchangeRpcOpeningAuctionSummary = Omit<
  ExchangeRpcIntegerFields<OpeningAuctionSummary>,
  'referencePrice' | 'clearingPrice' | 'totalVolume'
> & {
  referencePrice: ExchangeRpcQuantity
  clearingPrice: ExchangeRpcQuantity
  totalVolume: ExchangeRpcQuantity
}
export type ExchangeRpcSeedLiquidityOrderTemplate =
  ExchangeRpcIntegerFields<SeedLiquidityOrderTemplate>
export type ExchangeRpcSeedLiquidityPlan = Omit<
  ExchangeRpcIntegerFields<SeedLiquidityPlan>,
  'orders'
> & { orders: ExchangeRpcSeedLiquidityOrderTemplate[] }
/** Bare Rust u64 request fields are JSON numbers and cannot accept quantity strings. */
type ExchangeRpcRequestIntegerFields<T> = {
  [K in keyof T]: T[K] extends bigint ? number : T[K]
}
export type ExchangeRpcGetFeeEpochHistoryParams = Omit<
  ExchangeRpcRequestIntegerFields<GetFeeEpochHistoryParams>,
  'cursor'
> & { cursor?: ExchangeRpcRequestIntegerFields<FeeEpochHistoryCursor> | null }
export type ExchangeRpcGetPerpHistoryParams = Omit<
  ExchangeRpcRequestIntegerFields<GetPerpHistoryParams>,
  'cursor'
> & { cursor?: ExchangeRpcRequestIntegerFields<PerpHistoryCursor> | null }
export type ExchangeRpcGenerateSeedLiquidityPlanParams =
  ExchangeRpcRequestIntegerFields<GenerateSeedLiquidityPlanParams>
