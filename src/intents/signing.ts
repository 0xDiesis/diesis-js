import type { WalletClient, Account, Transport, Chain, Hex } from 'viem'
import type { OrderIntent, SignedOrderIntent, TradingKeyAuthorization } from './types.js'

const ORDER_INTENT_TYPES = {
  OrderIntent: [
    { name: 'marketId', type: 'bytes32' },
    { name: 'side', type: 'uint8' },
    { name: 'price', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'orderType', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'reduceOnly', type: 'bool' },
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

function getDomain(chainId: number) {
  return {
    name: 'Diesis Exchange',
    version: '1',
    chainId,
  } as const
}

/** Sign a gasless order intent using EIP-712 typed data. */
export async function signOrderIntent<TTransport extends Transport, TChain extends Chain, TAccount extends Account>(
  client: WalletClient<TTransport, TChain, TAccount>,
  intent: OrderIntent,
): Promise<SignedOrderIntent> {
  const chainId = client.chain?.id ?? 1980
  const signature = await client.signTypedData({
    account: client.account,
    domain: getDomain(chainId),
    types: ORDER_INTENT_TYPES,
    primaryType: 'OrderIntent',
    message: {
      marketId: intent.marketId,
      side: intent.side,
      price: intent.price,
      amount: intent.amount,
      orderType: intent.orderType,
      nonce: intent.nonce,
      expiry: intent.expiry,
      reduceOnly: intent.reduceOnly,
    },
  })
  return { intent, signature, signer: client.account.address }
}

/** Sign a trading key authorization using EIP-712 typed data. */
export async function signTradingKeyAuthorization<TTransport extends Transport, TChain extends Chain, TAccount extends Account>(
  client: WalletClient<TTransport, TChain, TAccount>,
  auth: TradingKeyAuthorization,
): Promise<Hex> {
  const chainId = client.chain?.id ?? 1980
  return client.signTypedData({
    account: client.account,
    domain: getDomain(chainId),
    types: TRADING_KEY_TYPES,
    primaryType: 'TradingKeyAuthorization',
    message: auth,
  })
}
