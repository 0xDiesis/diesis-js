import type { Client, Transport, Chain, Hex, Address } from 'viem'
import type { OrderBook, MarketInfo, TradingAccount, Trade, FundingRate, FillEstimate } from './types.js'

export type ExchangePublicActions = {
  exchange: {
    getOrderBook: (params: { marketId: Hex; depth?: number }) => Promise<OrderBook>
    getMarkets: () => Promise<MarketInfo[]>
    getMarket: (params: { marketId: Hex }) => Promise<MarketInfo>
    getAccount: (params: { address: Address }) => Promise<TradingAccount>
    getTrades: (params: { marketId: Hex; limit?: number }) => Promise<Trade[]>
    getFundingRates: (params: { marketId: Hex }) => Promise<FundingRate[]>
    estimateFill: (params: { marketId: Hex; side: number; amount: bigint }) => Promise<FillEstimate>
  }
}

export function exchangePublicActions<TTransport extends Transport, TChain extends Chain | undefined>(
  client: Client<TTransport, TChain>,
): ExchangePublicActions {
  return {
    exchange: {
      getOrderBook: (params) => client.request({ method: 'exchange_getOrderBook' as any, params: [params] } as any),
      getMarkets: () => client.request({ method: 'exchange_getMarkets' as any, params: [] } as any),
      getMarket: (params) => client.request({ method: 'exchange_getMarket' as any, params: [params.marketId] } as any),
      getAccount: (params) => client.request({ method: 'exchange_getAccount' as any, params: [params.address] } as any),
      getTrades: (params) => client.request({ method: 'exchange_getTrades' as any, params: [params] } as any),
      getFundingRates: (params) => client.request({ method: 'exchange_getFundingRates' as any, params: [params.marketId] } as any),
      estimateFill: (params) => client.request({ method: 'exchange_estimateFill' as any, params: [params] } as any),
    },
  }
}
