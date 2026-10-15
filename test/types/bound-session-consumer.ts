import type { Address, Hex } from 'viem'
import {
  encodeBoundSessionBatch,
  decodeBoundSessionBatch,
  prepareBoundSessionActionsTransaction,
  type PrepareBoundSessionActionsParameters,
  type BoundSessionBatch,
} from '../../src/index.js'
import {
  encodeBoundSessionBatch as exchangeEncode,
  prepareBoundSessionActionsTransaction as exchangePrepare,
} from '../../src/exchange/index.js'

export function inspectBoundSession(
  parameters: PrepareBoundSessionActionsParameters,
) {
  const encoded: Hex = encodeBoundSessionBatch(parameters, parameters.limits)
  const decoded: BoundSessionBatch = decodeBoundSessionBatch(
    encoded,
    parameters.limits,
  )
  const generation: bigint = decoded.authorizationGeneration
  // Offline wrapper inspection stays typed without inventing native ABI params.
  const wrapper: { principal: Address; authorizationGeneration: bigint } =
    decoded
  const prepared: { to: Address; data: Hex; value: 0n } =
    prepareBoundSessionActionsTransaction(parameters)
  const sameEncode: typeof encodeBoundSessionBatch = exchangeEncode
  const samePrepare: typeof prepareBoundSessionActionsTransaction =
    exchangePrepare
  return { generation, wrapper, prepared, sameEncode, samePrepare }
}
