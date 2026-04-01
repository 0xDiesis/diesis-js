import type { Client, Transport, Chain, Hex } from 'viem'
import { exchangePublicActions, type ExchangePublicActions } from '../exchange/actions.js'
import { bundleActions, type BundleActions } from '../bundles/actions.js'
import { patronageActions, type PatronageActions } from '../patronage/actions.js'

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

export type DiesisPublicActions = ExchangePublicActions & BundleActions & PatronageActions & {
  getRules: () => Promise<NetworkRules>
  getPipelineStatus: () => Promise<PipelineStatus>
  getTransactionStatus: (params: { hash: Hex }) => Promise<TransactionStatus>
  getBlockWitness: (params: { blockHash: Hex }) => Promise<Hex>
  getBlockMetadata: (params: { blockNumber: bigint }) => Promise<Record<string, unknown> | null>
  getConsensusCommitStatus: (params: { round: bigint }) => Promise<Record<string, unknown> | null>
}

export function diesisPublicActions<TTransport extends Transport, TChain extends Chain | undefined>(
  client: Client<TTransport, TChain>,
): DiesisPublicActions {
  const exchange = exchangePublicActions(client)
  const bundles = bundleActions(client)
  const patronage = patronageActions(client)
  return {
    ...exchange,
    ...bundles,
    ...patronage,
    getRules: () => client.request({ method: 'diesis_getRules' as any, params: [] } as any),
    getPipelineStatus: () => client.request({ method: 'diesis_getPipelineStatus' as any, params: [] } as any),
    getTransactionStatus: (params) => client.request({ method: 'diesis_getTransactionStatus' as any, params: [params.hash] } as any),
    getBlockWitness: (params) => client.request({ method: 'diesis_getBlockWitness' as any, params: [params.blockHash] } as any),
    getBlockMetadata: (params) => client.request({ method: 'diesis_getBlockMetadata' as any, params: [params.blockNumber] } as any),
    getConsensusCommitStatus: (params) => client.request({ method: 'diesis_getConsensusCommitStatus' as any, params: [params.round] } as any),
  }
}
