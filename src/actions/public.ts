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
import {
  privacyReadActions,
  type PrivacyReadActions,
} from '../privacy/actions.js'

export interface NetworkRules {
  [key: string]: unknown
}

/** Exact node 44bed wire response; observation is not execution authority. */
export interface RuntimeCapabilities {
  configuredExecutionMode: string
  effectiveExecutionMode: string
  witnessPolicy: string
  canonicalPass: boolean
  downgradeReason: string | null
  checkpointReplayMode: string
  blockSequentialFallbackTotal: number
}
export type TransactionStatus =
  | { status: 'unknown'; level: -1 }
  | {
      status: 'submitted' | 'preconfirmed' | 'committed' | 'executed'
      level: 0 | 1 | 2 | 3
      advisory: boolean
      submittedAtMs: number | null
      preconfirmedAtMs: number | null
      committedAtMs: number | null
      executedAtMs: number | null
      publicationStatus: 'published' | null
      publishedAtMs: number | null
      consensusRound: number | null
      blockNumber: number | null
      publicationError: null
      estimatedExecutionMs: number | null
    }
export type LifecycleStatus =
  | 'received'
  | 'admitted'
  | 'preconfirmed'
  | 'committed'
  | 'executed'
  | 'published'
export interface TransactionLifecycle {
  tx_hash: Hex
  status: LifecycleStatus | null
  classification: 'advisory' | 'canonical' | null
  generation: number
  consensus_round: number | null
  node_received_at: number
  transition_at: number
  lineage: Array<{
    block_hash: Hex
    block_number: number | null
    generation: number
    status: LifecycleStatus
    state: 'active' | 'orphaned' | 'replaced'
    observed_at: number
    superseded_at: number | null
  }>
}
/** Relay action identity is distinct from an EVM transaction hash. */
export type ExchangeActionStatus =
  | { status: 'in_flight' | 'native_admitted' | 'native_committed' }
  | { status: 'native_assigned'; parent_hash: Hex; block_number: number }
  | {
      status: 'native_included'
      block_number: number
      block_hash: Hex
      success: boolean
    }
  | { status: 'submitted'; tx_hash: Hex; relayer_nonce: number }
  | {
      status: 'included' | 'finalized'
      tx_hash: Hex
      relayer_nonce: number
      block_number: number
      block_hash: Hex
      success: boolean
    }
  | {
      status: 'terminal_expired'
      tx_hash: Hex
      relayer_nonce: number
      block_number: number
      block_hash: Hex
    }

export type DiesisPublicActions = ExchangePublicActions &
  BundleActions &
  PatronageActions & {
    privacy: PrivacyReadActions['privacy']
    getRules: () => Promise<NetworkRules>
    getRuntimeCapabilities: () => Promise<RuntimeCapabilities>
    getTransactionLifecycle: (params: {
      hash: Hex
    }) => Promise<TransactionLifecycle | null>
    getExchangeActionStatus: (params: {
      actionHash: Hex
    }) => Promise<ExchangeActionStatus | null>
    getTransactionStatus: (params: { hash: Hex }) => Promise<TransactionStatus>
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
  const privacy = privacyReadActions(client)
  return {
    ...exchange,
    ...bundles,
    ...patronage,
    ...privacy,
    getRules: () =>
      client.request({
        method: 'diesis_getRules' as never,
        params: [],
      } as never),
    getRuntimeCapabilities: () =>
      client.request({
        method: 'diesis_getRuntimeCapabilities' as never,
        params: [],
      } as never),
    getTransactionStatus: (params) =>
      client.request({
        method: 'diesis_getTransactionStatus' as never,
        params: [params.hash],
      } as never),
    getTransactionLifecycle: (params) =>
      client.request({
        method: 'diesis_getTransactionLifecycle' as never,
        params: [params.hash],
      } as never),
    getExchangeActionStatus: (params) =>
      client.request({
        method: 'diesis_getExchangeActionStatus' as never,
        params: [params.actionHash],
      } as never),
    getBlockMetadata: async (params) =>
      client.request({
        method: 'diesis_getBlockMetadata' as never,
        params: [safeRpcInteger(params.blockNumber)],
      } as never),
    getConsensusCommitStatus: async (params) =>
      client.request({
        method: 'diesis_getConsensusCommitStatus' as never,
        params: [safeRpcInteger(params.round)],
      } as never),
  }
}

function safeRpcInteger(value: bigint): number {
  if (
    typeof value !== 'bigint' ||
    value < 0n ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error('RPC integer cannot be represented safely in JSON')
  return Number(value)
}
