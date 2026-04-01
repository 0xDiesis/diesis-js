import type { Client, Transport, Chain, Account, Hex } from 'viem'
import { signOrderIntent, signTradingKeyAuthorization } from '../intents/signing.js'
import type { OrderIntent, SignedOrderIntent, TradingKeyAuthorization } from '../intents/types.js'

export type DiesisWalletActions = {
  sendTransactionSync: (params: { to: `0x${string}`; value?: bigint; data?: Hex }) => Promise<{ hash: Hex; receipt: Record<string, unknown> }>
  signOrderIntent: (intent: OrderIntent) => Promise<SignedOrderIntent>
  signTradingKeyAuthorization: (auth: TradingKeyAuthorization) => Promise<Hex>
  submitIntent: (params: { intent: SignedOrderIntent }) => Promise<Hex>
  sendStealthBundle: (params: { fundingTx: Hex; announceTx: Hex }) => Promise<{ planHash: Hex; status: string }>
}

export function diesisWalletActions<TTransport extends Transport, TChain extends Chain, TAccount extends Account>(
  client: Client<TTransport, TChain, TAccount>,
): DiesisWalletActions {
  return {
    sendTransactionSync: (params) => client.request({ method: 'diesis_sendRawTransactionSync' as any, params: [params] } as any),
    signOrderIntent: (intent) => signOrderIntent(client as any, intent),
    signTradingKeyAuthorization: (auth) => signTradingKeyAuthorization(client as any, auth),
    submitIntent: (params) => client.request({ method: 'diesis_submitIntent' as any, params: [params.intent] } as any),
    sendStealthBundle: (params) => client.request({ method: 'diesis_sendStealthBundle' as any, params: [params] } as any),
  }
}
