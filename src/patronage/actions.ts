import type { Client, Transport, Chain, Hex } from 'viem'

export interface GasGrant {
  grantId: Hex
  balance: bigint
  totalContributed: bigint
  totalSpent: bigint
  paused: boolean
}

export type PatronageActions = {
  getGrant: (params: { grantId: Hex }) => Promise<GasGrant>
}

export function patronageActions<TTransport extends Transport, TChain extends Chain | undefined>(
  client: Client<TTransport, TChain>,
): PatronageActions {
  return {
    getGrant: (params) => client.request({ method: 'diesis_getGrant' as any, params: [params.grantId] } as any),
  }
}
