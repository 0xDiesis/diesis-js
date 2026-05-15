import type { Client, Transport, Chain, Hex } from 'viem'
import type {
  BundleStatusResult,
  PreparedBundle,
  SubmitBundleResult,
} from './types.js'

export type BundleActions = {
  prepareBundle: (params: {
    payment: Hex
    bundle: Hex[]
    flags: number
  }) => Promise<PreparedBundle>
  submitBundle: (params: {
    planHash: Hex
    payment: Hex
    bundle: Hex[]
    flags: number
  }) => Promise<SubmitBundleResult>
  getBundleStatus: (params: { planHash: Hex }) => Promise<BundleStatusResult>
}

export function bundleActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): BundleActions {
  return {
    prepareBundle: (params) =>
      client.request({
        method: 'diesis_prepareBundle' as never,
        params: [params],
      } as never),
    submitBundle: (params) =>
      client.request({
        method: 'diesis_submitBundle' as never,
        params: [params],
      } as never),
    getBundleStatus: (params) =>
      client.request({
        method: 'diesis_getBundleStatus' as never,
        params: [params],
      } as never),
  }
}
