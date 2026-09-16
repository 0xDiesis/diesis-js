import type {
  Account,
  Client,
  Transport,
  Chain,
  Hex,
  Address,
  Hash,
} from 'viem'
import { readContract, writeContract } from 'viem/actions'
import { IDiesisErc20FactoryAbi } from '../abi/index.js'
import { DIESIS_ERC20_FACTORY } from '../addresses.js'
import type {
  OrderBook,
  MarketInfo,
  TradingAccount,
  Trade,
  FundingRateInfo,
  InsuranceFundStatus,
  FillEstimate,
  MarkPrice,
} from './types.js'

type FactoryFunctionName =
  | 'deploy'
  | 'predictAddress'
  | 'templateBytecodeHash'
  | 'proposeTemplateUpdate'
  | 'executeTemplateUpdate'

type FactoryFunction<N extends FactoryFunctionName> = Extract<
  (typeof IDiesisErc20FactoryAbi)[number],
  { readonly type: 'function'; readonly name: N }
>

function factoryFunction<N extends FactoryFunctionName>(
  name: N,
): FactoryFunction<N> {
  const entry = IDiesisErc20FactoryAbi.find(
    (candidate) => candidate.type === 'function' && candidate.name === name,
  )
  if (entry === undefined) {
    throw new Error(`missing generated ERC-20 factory function ABI: ${name}`)
  }
  return entry as FactoryFunction<N>
}

export const DiesisErc20FactoryAbi = [
  factoryFunction('deploy'),
  factoryFunction('predictAddress'),
  factoryFunction('templateBytecodeHash'),
  factoryFunction('proposeTemplateUpdate'),
  factoryFunction('executeTemplateUpdate'),
] as const

export type Erc20FactoryDeployParams = {
  symbol: Hex
  name: string
  initialSupply: bigint
  deployer: Address
}

export function erc20Symbol(symbol: string): Hex {
  if (!/^[A-Za-z0-9]{2,11}$/.test(symbol)) {
    throw new Error(
      'ERC-20 factory symbol must be 2-11 ASCII alphanumeric characters',
    )
  }
  let hex = '0x'
  for (let i = 0; i < symbol.length; i += 1) {
    hex += symbol.charCodeAt(i).toString(16).padStart(2, '0')
  }
  return hex.padEnd(24, '0') as Hex
}

/**
 * Cycle A2.1 — perp-deployment state, mirrors
 * `crates/exchange/src/markets/perp_deployment.rs::PerpDeploymentState`.
 */
export type PerpDeploymentState =
  | { tag: 'awaitingDeployment'; deadlineBlock: bigint }
  | { tag: 'cooling'; liveAtBlock: bigint }
  | { tag: 'live' }
  | { tag: 'delisting'; windowCloseBlock: bigint }
  | {
      tag: 'slashed'
      reason: 'backstopFunding' | 'abandonment'
      claimWindowClose: bigint
    }
  | { tag: 'closed' }

/**
 * Cycle A2.1 — payload for `exchange_deployPerp`.
 *
 * Mirrors `IDiesisPerpDeploy.activate` plus the operator-signed source list
 * and metadata blobs. The validator set never consults `sigs` for price
 * computation; they're stored as evidence for slashing inputs.
 */
export type DeployPerpParams = {
  slotId: Hex
  sourceList: { sources: Array<{ id: Hex; weightTenths: number }> }
  metadata: {
    maxLeverage: number
    backstopTopupBps: number
    marginTiers: Array<{ notionalCap: bigint; maintenanceMarginBps: number }>
  }
  sigs: Array<{ signer: Address; r: Hex; s: Hex; v: number }>
}

/** Cycle A2.1 — payload for `exchange_proposeMetadataUpdate`. */
export type ProposeMetadataUpdateParams = {
  marketId: Hex
  newMetadata: DeployPerpParams['metadata']
  sigs: DeployPerpParams['sigs']
}

export type ExchangePublicActions = {
  exchange: {
    getOrderBook: (params: {
      marketId: Hex
      depth?: number
    }) => Promise<OrderBook>
    getMarkets: () => Promise<MarketInfo[]>
    getMarket: (params: { marketId: Hex }) => Promise<MarketInfo>
    getAccount: (params: { address: Address }) => Promise<TradingAccount>
    getTrades: (params: { marketId: Hex; limit?: number }) => Promise<Trade[]>
    getFundingRates: (params: { marketId: Hex }) => Promise<FundingRateInfo>
    getMarkPrices: (params: { marketIds: Hex[] }) => Promise<MarkPrice[]>
    getInsuranceFund: (params: {
      marketId: Hex
    }) => Promise<InsuranceFundStatus>
    estimateFill: (params: {
      marketId: Hex
      side: number
      amount: bigint
    }) => Promise<FillEstimate>
    // Cycle A2.1 — operator-deployed perp markets.
    deployPerp: (params: DeployPerpParams) => Promise<{ marketId: Hex }>
    getMarketDeploymentState: (params: {
      marketId: Hex
    }) => Promise<PerpDeploymentState | null>
    getOperatorBalance: (params: { operator: Address }) => Promise<Hex>
    proposeMetadataUpdate: (
      params: ProposeMetadataUpdateParams,
    ) => Promise<{ unlockBlock: bigint }>
    // A2.1.1 — direct EVM dispatch to the ERC-20 factory precompile.
    predictErc20Address: (params: {
      deployer: Address
      symbol: Hex
    }) => Promise<Address>
    getErc20TemplateBytecodeHash: () => Promise<Hex>
  }
}

export type ExchangeWalletActions = {
  exchange: {
    deployErc20: (params: Erc20FactoryDeployParams) => Promise<Hash>
    proposeErc20TemplateUpdate: (params: { newHash: Hex }) => Promise<Hash>
    executeErc20TemplateUpdate: () => Promise<Hash>
  }
}

export function exchangePublicActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): ExchangePublicActions {
  return {
    exchange: {
      getOrderBook: (params) =>
        client.request({
          method: 'exchange_getOrderBook' as never,
          params: [params],
        } as never),
      getMarkets: () =>
        client.request({
          method: 'exchange_getMarkets' as never,
          params: [],
        } as never),
      getMarket: (params) =>
        client.request({
          method: 'exchange_getMarket' as never,
          params: [params.marketId],
        } as never),
      getAccount: (params) =>
        client.request({
          method: 'exchange_getAccount' as never,
          params: [params.address],
        } as never),
      getTrades: (params) =>
        client.request({
          method: 'exchange_getTrades' as never,
          params: [params],
        } as never),
      getFundingRates: (params) =>
        client.request({
          method: 'exchange_getFundingRates' as never,
          params: [params.marketId],
        } as never),
      getMarkPrices: (params) =>
        client.request({
          method: 'exchange_getMarkPrices' as never,
          params: [params.marketIds],
        } as never),
      getInsuranceFund: (params) =>
        client.request({
          method: 'exchange_getInsuranceFund' as never,
          params: [params.marketId],
        } as never),
      estimateFill: (params) =>
        client.request({
          method: 'exchange_estimateFill' as never,
          params: [params],
        } as never),
      deployPerp: (params) =>
        client.request({
          method: 'exchange_deployPerp' as never,
          params: [params],
        } as never),
      getMarketDeploymentState: (params) =>
        client.request({
          method: 'exchange_getMarketDeploymentState' as never,
          params: [params.marketId],
        } as never),
      getOperatorBalance: (params) =>
        client.request({
          method: 'exchange_getOperatorBalance' as never,
          params: [params.operator],
        } as never),
      proposeMetadataUpdate: (params) =>
        client.request({
          method: 'exchange_proposeMetadataUpdate' as never,
          params: [params],
        } as never),
      predictErc20Address: ({ deployer, symbol }) =>
        readContract(client, {
          address: DIESIS_ERC20_FACTORY,
          abi: DiesisErc20FactoryAbi,
          functionName: 'predictAddress',
          args: [deployer, symbol],
        }) as Promise<Address>,
      getErc20TemplateBytecodeHash: () =>
        readContract(client, {
          address: DIESIS_ERC20_FACTORY,
          abi: DiesisErc20FactoryAbi,
          functionName: 'templateBytecodeHash',
        }) as Promise<Hex>,
    },
  }
}

export function exchangeWalletActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
  TAccount extends Account,
>(client: Client<TTransport, TChain, TAccount>): ExchangeWalletActions {
  const walletClient = client as Client<Transport, Chain | undefined, Account>
  const submit = (
    parameters: Parameters<typeof writeContract>[1],
  ): Promise<Hash> => writeContract(walletClient, parameters)

  return {
    exchange: {
      deployErc20: (params) =>
        submit({
          address: DIESIS_ERC20_FACTORY,
          abi: DiesisErc20FactoryAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'deploy',
          args: [params],
        }),
      proposeErc20TemplateUpdate: ({ newHash }) =>
        submit({
          address: DIESIS_ERC20_FACTORY,
          abi: DiesisErc20FactoryAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'proposeTemplateUpdate',
          args: [newHash],
        }),
      executeErc20TemplateUpdate: () =>
        submit({
          address: DIESIS_ERC20_FACTORY,
          abi: DiesisErc20FactoryAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'executeTemplateUpdate',
        }),
    },
  }
}
