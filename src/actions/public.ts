import type { Client, Transport, Chain, Hex } from 'viem'
import {
  exchangePublicActions,
  type ExchangePublicActions,
} from '../exchange/actions.js'
import { bundleActions, type BundleActions } from '../bundles/actions.js'
import {
  patronageActions,
  type PatronageActions,
} from '../patronage/actions.js'

export interface NetworkRules {
  [key: string]: unknown
}

export interface PipelineStatus {
  consensusHead: bigint
  executionHead: bigint
  publicationHead: bigint
  executionLag: bigint
  publicationLag: bigint
  backpressure: boolean
}

export interface TransactionStatus {
  status: 'submitted' | 'preconfirmed' | 'committed' | 'executed' | 'unknown'
  hash: Hex
  timestamps: Record<string, bigint>
}

export type DiesisPublicActions = ExchangePublicActions &
  BundleActions &
  PatronageActions & {
    getRules: () => Promise<NetworkRules>
    getPipelineStatus: () => Promise<PipelineStatus>
    getTransactionStatus: (params: { hash: Hex }) => Promise<TransactionStatus>
    getBlockWitness: (params: { blockHash: Hex }) => Promise<Hex>
    getBlockMetadata: (params: {
      blockNumber: bigint
    }) => Promise<Record<string, unknown> | null>
    getConsensusCommitStatus: (params: {
      round: bigint
    }) => Promise<Record<string, unknown> | null>
  }

export function diesisPublicActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): DiesisPublicActions {
  const exchange = exchangePublicActions(client)
  const bundles = bundleActions(client)
  const patronage = patronageActions(client)
  return {
    ...exchange,
    ...bundles,
    ...patronage,
    getRules: () =>
      client.request({
        method: 'diesis_getRules' as never,
        params: [],
      } as never),
    getPipelineStatus: () =>
      client.request({
        method: 'diesis_getPipelineStatus' as never,
        params: [],
      } as never),
    getTransactionStatus: (params) =>
      client.request({
        method: 'diesis_getTransactionStatus' as never,
        params: [params.hash],
      } as never),
    getBlockWitness: (params) =>
      client.request({
        method: 'diesis_getBlockWitness' as never,
        params: [params.blockHash],
      } as never),
    getBlockMetadata: (params) =>
      client.request({
        method: 'diesis_getBlockMetadata' as never,
        params: [params.blockNumber],
      } as never),
    getConsensusCommitStatus: (params) =>
      client.request({
        method: 'diesis_getConsensusCommitStatus' as never,
        params: [params.round],
      } as never),
  }
}
