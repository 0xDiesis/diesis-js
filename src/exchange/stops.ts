import { encodeFunctionData, type Hex } from 'viem'

import { IDiesisSpotBookAbi } from '../abi/index.js'
import { OrderType } from './types.js'

/**
 * Bounded signed stop orders and the permissionless stop-trigger continuation.
 *
 * Stop orders are ordinary EIP-712 `OrderIntent`s (see `intents/signing.ts`)
 * with `orderType` set to {@link OrderType.StopLimit} or
 * {@link OrderType.StopMarket} and a nonzero `triggerPrice`. A protected stop
 * limit must additionally carry a nonzero `price` — a resting protected stop
 * with a zero limit price is rejected. When the market's mark crosses a stop's
 * trigger, anyone may continue the book by calling
 * `triggerSpotStops(marketId, maxTriggers)`, which promotes eligible stops and
 * emits `StopOrderTriggered(marketId, orderId, trader, triggerPrice, markPrice)`.
 */

/**
 * Enforce the protected-stop nonzero-price rule for a stop order.
 *
 * A {@link OrderType.StopLimit} requires a nonzero `price`; both stop types
 * require a nonzero `triggerPrice`. Throws if the rule is violated.
 */
export function assertStopOrderPrices(
  orderType: number,
  price: bigint,
  triggerPrice: bigint,
): void {
  if (orderType !== OrderType.StopLimit && orderType !== OrderType.StopMarket) {
    throw new Error('orderType must be StopLimit or StopMarket')
  }
  if (triggerPrice <= 0n) {
    throw new Error('a stop order requires a nonzero triggerPrice')
  }
  if (orderType === OrderType.StopLimit && price <= 0n) {
    throw new Error('a protected stop limit requires a nonzero price')
  }
}

/**
 * Build `triggerSpotStops(marketId, maxTriggers)` calldata — the permissionless
 * bounded continuation that promotes stops whose trigger the mark has crossed.
 * `maxTriggers` bounds the work performed in one call.
 */
export function encodeTriggerSpotStops(
  marketId: Hex,
  maxTriggers: number,
): Hex {
  return encodeFunctionData({
    abi: IDiesisSpotBookAbi,
    functionName: 'triggerSpotStops',
    args: [marketId, maxTriggers],
  })
}
