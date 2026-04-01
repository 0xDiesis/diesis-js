import type { Client, Transport, Chain, Hex, Address } from 'viem'

export interface PatronFund {
  balance: bigint
  patron: Address
  fundType: number
}

export type PatronageActions = {
  getPatronFund: (params: { fundKey: Hex }) => Promise<PatronFund>
}

export function patronageActions<TTransport extends Transport, TChain extends Chain | undefined>(
  client: Client<TTransport, TChain>,
): PatronageActions {
  return {
    getPatronFund: (params) => client.request({ method: 'diesis_getPatronFund' as any, params: [params.fundKey] } as any),
  }
}
