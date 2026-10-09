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
    sendTransactionSync: (
      serializedTransactionHex: Hex,
    ) => Promise<SyncTransactionReceipt>
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
    sendTransactionSync: async (serializedTransactionHex) => {
      if (
        typeof serializedTransactionHex !== 'string' ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(serializedTransactionHex)
      )
        throw new Error(
          'Sync submission requires serialized signed transaction bytes',
        )
      return client.request({
        method: 'diesis_sendRawTransactionSync' as never,
        params: [serializedTransactionHex],
      } as never)
    },
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
  }
}

/** Node EIP-7966 response, not a fabricated hash/receipt wrapper. */
export interface SyncTransactionReceipt {
  transactionHash: Hash
  transactionIndex: number
  blockHash: Hex
  blockNumber: number
  from: Address
  to: Address | null
  gasUsed: number
  effectiveGasPrice: Hex
  contractAddress: Address | null
  logs: Array<{
    address: Address
    topics: Hex[]
    data: Hex
    blockHash: Hex
    blockNumber: number
    transactionHash: Hash
    transactionIndex: number
    logIndex: number
  }>
  logsBloom: Hex
  type: number
  status: number
}
