import type {
  Client,
  Transport,
  Chain,
  Account,
  Hex,
  Hash,
  Address,
} from 'viem'
import {
  exchangeWalletActions,
  type ExchangeWalletActions,
} from '../exchange/actions.js'
import {
  signOrderIntent,
  signTradingKeyAuthorization,
} from '../intents/signing.js'
import type {
  OrderIntent,
  SignedOrderIntent,
  TradingKeyAuthorization,
} from '../intents/types.js'
import {
  privacyWriteActions,
  type PrivacyWriteActions,
} from '../privacy/actions.js'

export type DiesisWalletActions = ExchangeWalletActions &
  PrivacyWriteActions & {
    sendTransactionSync: (params: {
      to: `0x${string}`
      value?: bigint
      data?: Hex
    }) => Promise<{ hash: Hex; receipt: Record<string, unknown> }>
    /**
     * Nonblocking gated raw submission: applies the reserved-cancel admission
     * gate then submits the serialized transaction to the pool, returning the
     * hash without waiting for inclusion. Usable on the strict trading endpoint,
     * which refuses to co-expose `eth_sendRawTransaction`.
     */
    sendRawTransactionGated: (serializedTransactionHex: Hex) => Promise<Hash>
    /**
     * Sign a v2 order intent.
     *
     * `verifyingContract` must be the address of the spot or perp book precompile
     * the intent is routed to (see `DIESIS_SPOT_BOOK` / `DIESIS_PERPS_BOOK` in
     * `../addresses`). Mismatch causes on-chain signature rejection.
     */
    signOrderIntent: (
      intent: OrderIntent,
      verifyingContract: Address,
    ) => Promise<SignedOrderIntent>
    signTradingKeyAuthorization: (auth: TradingKeyAuthorization) => Promise<Hex>
    submitIntent: (params: { intent: SignedOrderIntent }) => Promise<Hex>
    sendStealthBundle: (params: {
      fundingTx: Hex
      announceTx: Hex
    }) => Promise<{ planHash: Hex; status: string }>
  }

export function diesisWalletActions<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account,
>(client: Client<TTransport, TChain, TAccount>): DiesisWalletActions {
  const exchange = exchangeWalletActions(client)
  const privacy = privacyWriteActions(client)
  return {
    ...exchange,
    ...privacy,
    sendTransactionSync: (params) =>
      client.request({
        method: 'diesis_sendRawTransactionSync' as never,
        params: [params],
      } as never),
    sendRawTransactionGated: (serializedTransactionHex) =>
      client.request({
        method: 'diesis_sendRawTransaction' as never,
        params: [serializedTransactionHex],
      } as never),
    signOrderIntent: (intent, verifyingContract) =>
      signOrderIntent(client as never, intent, verifyingContract),
    signTradingKeyAuthorization: (auth) =>
      signTradingKeyAuthorization(client as never, auth),
    submitIntent: (params) =>
      client.request({
        method: 'diesis_submitIntent' as never,
        params: [params.intent],
      } as never),
    sendStealthBundle: (params) =>
      client.request({
        method: 'diesis_sendStealthBundle' as never,
        params: [params],
      } as never),
  }
}
