import type {
  WalletClient,
  Account,
  Transport,
  Chain,
  Hex,
  Address,
} from 'viem'
import type {
  OrderIntent,
  SignedOrderIntent,
  TradingKeyAuthorization,
} from './types.js'

/**
 * EIP-712 v2 type for the OrderIntent struct.
 *
 * Field order and types mirror `crates/exchange/src/intents/order_intent.rs`
 * exactly. Any reordering or renaming will change the struct hash and break
 * signature verification on-chain.
 */
const ORDER_INTENT_TYPES = {
  OrderIntent: [
    { name: 'trader', type: 'address' },
    { name: 'marketId', type: 'bytes32' },
    { name: 'side', type: 'uint8' },
    { name: 'orderType', type: 'uint8' },
    { name: 'price', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'triggerPrice', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
    { name: 'flags', type: 'uint8' },
    { name: 'conductor', type: 'address' },
    { name: 'conductorFeeBps', type: 'uint16' },
    { name: 'maxConductorFee', type: 'uint256' },
  ],
} as const

const TRADING_KEY_TYPES = {
  TradingKeyAuthorization: [
    { name: 'tradingKey', type: 'address' },
    { name: 'expiry', type: 'uint256' },
    { name: 'maxNotional', type: 'uint256' },
    { name: 'markets', type: 'bytes32[]' },
    { name: 'canWithdraw', type: 'bool' },
  ],
} as const

/**
 * Build the EIP-712 domain for an OrderIntent.
 *
 * Mirrors `crates/exchange/src/intents/order_intent.rs::IntentDomain`. The
 * `verifyingContract` must be the address of the spot or perp book precompile
 * the intent is routed to — same address the on-chain side verifies against.
 */
function getOrderIntentDomain(chainId: number, verifyingContract: Address) {
  return {
    name: 'Diesis Exchange',
    version: '2',
    chainId,
    verifyingContract,
  } as const
}

/** Sign a gasless order intent using EIP-712 typed data (v2). */
export async function signOrderIntent<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account,
>(
  client: WalletClient<TTransport, TChain, TAccount>,
  intent: OrderIntent,
  verifyingContract: Address,
): Promise<SignedOrderIntent> {
  const chainId = client.chain?.id ?? 1980
  const signature = await client.signTypedData({
    account: client.account,
    domain: getOrderIntentDomain(chainId, verifyingContract),
    types: ORDER_INTENT_TYPES,
    primaryType: 'OrderIntent',
    message: {
      trader: intent.trader,
      marketId: intent.marketId,
      side: intent.side,
      orderType: intent.orderType,
      price: intent.price,
      amount: intent.amount,
      triggerPrice: intent.triggerPrice,
      expiry: intent.expiry,
      nonce: intent.nonce,
      flags: intent.flags,
      conductor: intent.conductor,
      conductorFeeBps: intent.conductorFeeBps,
      maxConductorFee: intent.maxConductorFee,
    },
  })
  return { intent, signature, signer: client.account.address }
}

/** Sign a trading key authorization using EIP-712 typed data. */
export async function signTradingKeyAuthorization<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account,
>(
  client: WalletClient<TTransport, TChain, TAccount>,
  auth: TradingKeyAuthorization,
): Promise<Hex> {
  const chainId = client.chain?.id ?? 1980
  return client.signTypedData({
    account: client.account,
    domain: {
      name: 'Diesis Exchange',
      version: '2',
      chainId,
    } as const,
    types: TRADING_KEY_TYPES,
    primaryType: 'TradingKeyAuthorization',
    message: auth,
  })
}
