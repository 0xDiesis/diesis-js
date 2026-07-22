import { encodeFunctionData, type Address, type Hex } from 'viem'

import { DiesisSettlementRouterAbi } from '../abi/index.js'
import { DIESIS_SETTLEMENT_ROUTER } from '../addresses.js'

/**
 * Generic ERC-20 settlement router calldata.
 *
 * `DiesisSettlementRouter` holds standard-token custody and drives the
 * settlement precompile ledger through two caller-authorized selectors. Deposits
 * credit and withdrawals debit the settlement balance of `to`.
 */

/** The reserved settlement router address (genesis code-only deployment). */
export { DIESIS_SETTLEMENT_ROUTER } from '../addresses.js'

/** Build `deposit(token, amount, to)` calldata. */
export function encodeRouterDeposit(
  token: Address,
  amount: bigint,
  to: Address,
): Hex {
  return encodeFunctionData({
    abi: DiesisSettlementRouterAbi,
    functionName: 'deposit',
    args: [token, amount, to],
  })
}

/** Build `withdraw(token, amount, to)` calldata. */
export function encodeRouterWithdraw(
  token: Address,
  amount: bigint,
  to: Address,
): Hex {
  return encodeFunctionData({
    abi: DiesisSettlementRouterAbi,
    functionName: 'withdraw',
    args: [token, amount, to],
  })
}

/** Build `setTokenAllowed(token, allowed)` calldata (owner-only allowlist). */
export function encodeSetTokenAllowed(token: Address, allowed: boolean): Hex {
  return encodeFunctionData({
    abi: DiesisSettlementRouterAbi,
    functionName: 'setTokenAllowed',
    args: [token, allowed],
  })
}

/** Convenience: the router calldata builders keyed by call. */
export const settlementRouter = {
  address: DIESIS_SETTLEMENT_ROUTER,
  encodeRouterDeposit,
  encodeRouterWithdraw,
  encodeSetTokenAllowed,
}
