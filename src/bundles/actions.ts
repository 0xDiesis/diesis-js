import {
  hexToBytes,
  type Chain,
  type Client,
  type Hex,
  type Transport,
} from 'viem'

import { planToWire, consentToWire } from './wire.js'
import type {
  BundleMemberConsent,
  BundlePlan,
  BundleStatusResult,
  PreparedBundle,
  SubmitBundleResult,
} from './types.js'

/** A submitted member: its raw signed transaction and detached consent. */
export interface SubmitBundleMember {
  rawTransaction: Hex
  consent: BundleMemberConsent
}

export interface SubmitBundleInput {
  plan: BundlePlan
  /** Raw RLP-encoded signed reservation/payment transaction. */
  payment: Hex
  members: SubmitBundleMember[]
  planHash: Hex
}

export interface StealthBundleInput {
  plan: BundlePlan
  planHash: Hex
  funding: Hex
  announcement: Hex
  consent: BundleMemberConsent
}

function rawBytes(value: Hex): number[] {
  return Array.from(hexToBytes(value))
}

export type BundleActions = {
  /**
   * Submit the ordered plan and receive the canonical plan hash plus the
   * per-member EIP-712 digests each member signs to consent.
   */
  prepareBundle: (params: { plan: BundlePlan }) => Promise<PreparedBundle>
  /** Submit a fully-signed bundle (plan, reservation, ordered members). */
  submitBundle: (params: SubmitBundleInput) => Promise<SubmitBundleResult>
  getBundleStatus: (params: { planHash: Hex }) => Promise<BundleStatusResult>
  /**
   * Submit a stealth bundle: the node assembles a single-member
   * `HALT_ON_INVALID` bundle from the funding + announcement and the
   * announcement signer's detached consent.
   */
  sendStealthBundle: (params: StealthBundleInput) => Promise<SubmitBundleResult>
}

export function bundleActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): BundleActions {
  return {
    prepareBundle: (params) =>
      client.request({
        method: 'diesis_prepareBundle' as never,
        params: [{ plan: planToWire(params.plan) }] as never,
      } as never),
    submitBundle: (params) =>
      client.request({
        method: 'diesis_submitBundle' as never,
        params: [
          {
            bundle: {
              plan: planToWire(params.plan),
              payment: rawBytes(params.payment),
              members: params.members.map((member) => ({
                rawTransaction: rawBytes(member.rawTransaction),
                consent: consentToWire(member.consent),
              })),
            },
            planHash: params.planHash,
          },
        ] as never,
      } as never),
    getBundleStatus: (params) =>
      client.request({
        method: 'diesis_getBundleStatus' as never,
        params: [params] as never,
      } as never),
    sendStealthBundle: (params) =>
      client.request({
        method: 'diesis_sendStealthBundle' as never,
        params: [
          {
            plan: planToWire(params.plan),
            planHash: params.planHash,
            funding: params.funding,
            announcement: params.announcement,
            consent: consentToWire(params.consent),
          },
        ] as never,
      } as never),
  }
}
