import type { Client, Transport, Chain, Hex, Address } from 'viem'
import type {
  OrderBook,
  MarketInfo,
  TradingAccount,
  Trade,
  FundingRate,
  FillEstimate,
} from './types.js'

/**
 * Cycle A2.1 — perp-deployment state, mirrors
 * `crates/exchange/src/markets/perp_deployment.rs::PerpDeploymentState`.
 */
export type PerpDeploymentState =
  | { tag: 'awaitingDeployment'; deadlineBlock: bigint }
  | { tag: 'cooling'; liveAtBlock: bigint }
  | { tag: 'live' }
  | { tag: 'delisting'; windowCloseBlock: bigint }
  | {
      tag: 'slashed'
      reason: 'backstopFunding' | 'abandonment'
      claimWindowClose: bigint
    }
  | { tag: 'closed' }

/**
 * Cycle A2.1 — payload for `exchange_deployPerp`.
 *
 * Mirrors `IDiesisPerpDeploy.activate` plus the operator-signed source list
 * and metadata blobs. The validator set never consults `sigs` for price
 * computation; they're stored as evidence for slashing inputs.
 */
export type DeployPerpParams = {
  slotId: Hex
  sourceList: { sources: Array<{ id: Hex; weightTenths: number }> }
  metadata: {
    maxLeverage: number
    backstopTopupBps: number
    marginTiers: Array<{ notionalCap: bigint; maintenanceMarginBps: number }>
  }
  sigs: Array<{ signer: Address; r: Hex; s: Hex; v: number }>
}

/** Cycle A2.1 — payload for `exchange_proposeMetadataUpdate`. */
export type ProposeMetadataUpdateParams = {
  marketId: Hex
  newMetadata: DeployPerpParams['metadata']
  sigs: DeployPerpParams['sigs']
}

export type ExchangePublicActions = {
  exchange: {
    getOrderBook: (params: {
      marketId: Hex
      depth?: number
    }) => Promise<OrderBook>
    getMarkets: () => Promise<MarketInfo[]>
    getMarket: (params: { marketId: Hex }) => Promise<MarketInfo>
    getAccount: (params: { address: Address }) => Promise<TradingAccount>
    getTrades: (params: { marketId: Hex; limit?: number }) => Promise<Trade[]>
    getFundingRates: (params: { marketId: Hex }) => Promise<FundingRate[]>
    estimateFill: (params: {
      marketId: Hex
      side: number
      amount: bigint
    }) => Promise<FillEstimate>
    // Cycle A2.1 — operator-deployed perp markets.
    deployPerp: (params: DeployPerpParams) => Promise<{ marketId: Hex }>
    getMarketDeploymentState: (params: {
      marketId: Hex
    }) => Promise<PerpDeploymentState>
    getOperatorBalance: (params: { operator: Address }) => Promise<bigint>
    proposeMetadataUpdate: (
      params: ProposeMetadataUpdateParams,
    ) => Promise<{ unlockBlock: bigint }>
  }
}

export function exchangePublicActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): ExchangePublicActions {
  return {
    exchange: {
      getOrderBook: (params) =>
        client.request({
          method: 'exchange_getOrderBook' as never,
          params: [params],
        } as never),
      getMarkets: () =>
        client.request({
          method: 'exchange_getMarkets' as never,
          params: [],
        } as never),
      getMarket: (params) =>
        client.request({
          method: 'exchange_getMarket' as never,
          params: [params.marketId],
        } as never),
      getAccount: (params) =>
        client.request({
          method: 'exchange_getAccount' as never,
          params: [params.address],
        } as never),
      getTrades: (params) =>
        client.request({
          method: 'exchange_getTrades' as never,
          params: [params],
        } as never),
      getFundingRates: (params) =>
        client.request({
          method: 'exchange_getFundingRates' as never,
          params: [params.marketId],
        } as never),
      estimateFill: (params) =>
        client.request({
          method: 'exchange_estimateFill' as never,
          params: [params],
        } as never),
      deployPerp: (params) =>
        client.request({
          method: 'exchange_deployPerp' as never,
          params: [params],
        } as never),
      getMarketDeploymentState: (params) =>
        client.request({
          method: 'exchange_getMarketDeploymentState' as never,
          params: [params.marketId],
        } as never),
      getOperatorBalance: (params) =>
        client.request({
          method: 'exchange_getOperatorBalance' as never,
          params: [params.operator],
        } as never),
      proposeMetadataUpdate: (params) =>
        client.request({
          method: 'exchange_proposeMetadataUpdate' as never,
          params: [params],
        } as never),
    },
  }
}
