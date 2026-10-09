import { createPublicClient, custom, type Address, type Hex } from 'viem'
import {
  exchangePublicActions,
  type IndexedResponse,
  type ControlRead,
  type SessionControlRead,
  type GetOrderExpiryParams,
  type GetSessionAuthorizationParams,
  type OrderExpiry,
  type SessionAuthorizationRead,
} from '../../src/index.js'
import {
  exchangePublicActions as exchangeEntryActions,
  type SessionMarketOrdinal,
  type SessionAuthorizationStatus,
} from '../../src/exchange/index.js'

// Prospective app call shape. This fixture reads the candidate source directly;
// published dist declarations and an app SDK pin are separate owner gates.
export async function inspectControlFacts(
  order: GetOrderExpiryParams,
  session: GetSessionAuthorizationParams,
) {
  const client = createPublicClient({
    transport: custom({
      request: async () => {
        throw new Error('type fixture only')
      },
    }),
  }).extend(exchangePublicActions)
  const expiry: IndexedResponse<ControlRead<OrderExpiry | null>> =
    await client.exchange.getOrderExpiry(order)
  const authorization: IndexedResponse<
    SessionControlRead<SessionAuthorizationRead>
  > = await client.exchange.getSessionAuthorization(session)
  const blockNumber: bigint = expiry.blockNumber
  const blockHash: Hex = expiry.blockHash
  const indexDigest: Hex = expiry.indexDigest
  const deadline: bigint | null = expiry.data.value?.expirySeconds ?? null
  const sessionIndexGeneration: bigint = authorization.data.indexGeneration
  const authorizationGeneration: bigint =
    authorization.data.value.authorizationGeneration
  const timestamp: bigint = authorization.data.value.blockTimestampSeconds
  const status: SessionAuthorizationStatus = authorization.data.value.status
  const principal: Address = authorization.data.value.principal
  const ordinals: SessionMarketOrdinal[] =
    authorization.data.value.marketOrdinals
  const scope: bigint | null = authorization.data.value.actionScope
  const ceiling: bigint | null = authorization.data.value.maxNotionalOrSpend
  const sameDecorator: typeof exchangePublicActions = exchangeEntryActions
  // Consumers retain and compare complete anchors before joining these reads.
  return {
    expiry,
    authorization,
    blockNumber,
    blockHash,
    indexDigest,
    deadline,
    sessionIndexGeneration,
    authorizationGeneration,
    timestamp,
    status,
    principal,
    ordinals,
    scope,
    ceiling,
    sameDecorator,
  }
}
