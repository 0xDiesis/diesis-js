import { createPublicClient, custom, type Address, type Hex } from 'viem'
import {
  createPerpLifecycle,
  exchangePublicActions,
  type IndexedResponse,
  type MarketInfo,
  type PerpLifecycleContext,
} from '@diesis/sdk'
import {
  createPerpLifecycle as createExchangeLifecycle,
  exchangePublicActions as exchangeEntryActions,
  type PerpRegistrationV1,
} from '@diesis/sdk/exchange'

// Compile the actual package declarations as an ordinary consumer would.
export async function inspectMarket(marketId: Hex, operator: Address) {
  const client = createPublicClient({
    transport: custom({
      request: async () => {
        throw new Error('type fixture only')
      },
    }),
  }).extend(exchangePublicActions)
  const result: IndexedResponse<MarketInfo[]> =
    await client.exchange.getMarkets()
  const observedBlock: bigint = result.blockNumber
  const firstMarket = result.data[0]
  if (!firstMarket) return { markets: result.data, observedBlock }
  const firstMarketId: Hex = firstMarket.marketId
  const book = await client.exchange.getOrderBook({
    marketId: firstMarketId,
    depth: 20,
  })
  const market: MarketInfo | null = await client.exchange.getMarket({
    marketId,
  })
  const balance: bigint = await client.exchange.getOperatorBalance({ operator })
  const state = await client.exchange.getMarketDeploymentState({ marketId })
  const deadline: bigint | undefined = state?.deadlineOrLiveBlock
  return {
    markets: result.data,
    observedBlock,
    market,
    balance,
    deadline,
    book: book.data,
  }
}

export function ordinaryListing(
  context: PerpLifecycleContext,
  registration: PerpRegistrationV1,
) {
  const rootLifecycle = createPerpLifecycle(context)
  const subpathLifecycle = createExchangeLifecycle(context)
  const rootCall: Promise<Hex> = rootLifecycle.bidPerpListingV1({
    registration,
  })
  const subpathCall: Promise<Hex> = subpathLifecycle.postBond({
    marketId: registration.marketId,
  })
  const sameDecorator: typeof exchangePublicActions = exchangeEntryActions
  return { rootCall, subpathCall, sameDecorator }
}
