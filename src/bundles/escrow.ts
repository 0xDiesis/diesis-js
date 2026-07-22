import { encodeFunctionData, type Hex } from 'viem'

import { DiesisBundleEscrowAbi } from '../abi/index.js'
import { planHash } from './plan.js'
import type { BundlePlanV2 } from './types.js'

/**
 * Bundle escrow reservation calldata.
 *
 * The bundle payment transaction must *be* the `reserveBundleV2` call whose
 * committed terms exactly equal the plan and whose native value equals
 * `maximumBuilderPayment + maximumRefund`. This helper builds that calldata
 * from the committed plan so a client cannot accidentally under-fund or
 * mis-bind the reservation.
 */
export function encodeReserveBundleV2(plan: BundlePlanV2): Hex {
  const { payment } = plan
  return encodeFunctionData({
    abi: DiesisBundleEscrowAbi,
    functionName: 'reserveBundleV2',
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
export function reservationValue(plan: BundlePlanV2): bigint {
  return plan.payment.maximumBuilderPayment + plan.payment.maximumRefund
}
