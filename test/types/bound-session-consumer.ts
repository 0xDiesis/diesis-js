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
import type {
  IDiesisSpotBookSubmitBoundSessionActionsParams,
  IDiesisPerpsBookSubmitBoundSessionActionsParams,
} from '../../src/abi/bindings/viem/index.js'

export function inspectBoundSession(
  parameters: PrepareBoundSessionActionsParameters,
) {
  const encoded: Hex = encodeBoundSessionBatch(parameters, parameters.limits)
  const decoded: BoundSessionBatch = decodeBoundSessionBatch(
    encoded,
    parameters.limits,
  )
  const generation: bigint = decoded.authorizationGeneration
  const spot: IDiesisSpotBookSubmitBoundSessionActionsParams = {
    encodedWrapper: encoded,
  }
  const perpetual: IDiesisPerpsBookSubmitBoundSessionActionsParams = spot
  const prepared: { to: Address; data: Hex; value: 0n } =
    prepareBoundSessionActionsTransaction(parameters)
  const sameEncode: typeof encodeBoundSessionBatch = exchangeEncode
  const samePrepare: typeof prepareBoundSessionActionsTransaction =
    exchangePrepare
  return { generation, spot, perpetual, prepared, sameEncode, samePrepare }
}
