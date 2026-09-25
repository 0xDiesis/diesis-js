import { encodeFunctionData, type Hex } from 'viem'

import { DiesisBundleEscrowAbi } from '../abi/index.js'
import { planHash } from './plan.js'
import type { BundlePlan } from './types.js'

/**
 * Bundle escrow reservation calldata.
 *
 * The bundle payment transaction must *be* the `reserveBundle` call whose
 * committed terms exactly equal the plan and whose native value equals
 * `maximumBuilderPayment + maximumRefund`. This helper builds that calldata
 * from the committed plan so a client cannot accidentally under-fund or
 * mis-bind the reservation.
 */
export function encodeReserveBundle(plan: BundlePlan): Hex {
  const { payment } = plan
  return encodeFunctionData({
    abi: DiesisBundleEscrowAbi,
    functionName: 'reserveBundle',
    args: [
      planHash(plan),
      payment.maximumBuilderPayment,
      payment.refundGasPrice,
      payment.maximumRefund,
      payment.escrowNonce,
      BigInt(plan.expiry),
    ],
  })
}

/** Native wei the reservation transaction must carry. */
export function reservationValue(plan: BundlePlan): bigint {
  return plan.payment.maximumBuilderPayment + plan.payment.maximumRefund
}
