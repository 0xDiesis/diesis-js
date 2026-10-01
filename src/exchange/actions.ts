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
import type { IDiesisErc20FactoryDeployParams } from '../abi/bindings/viem/index.js'
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
  PositionCollateralCapability,
  IndexedResponse,
  PriceLevel,
  FeeEpochStatus,
  FeeEpochHistoryCursor,
  FeeEpochHistoryPage,
  GetFeeEpochHistoryParams,
  PerpFeeBalances,
  PerpFeeRecipientAllocation,
  PerpFeeDistributionAllocation,
  PerpFeeDistributionRead,
  PerpHistoryKind,
  PerpHistoryCursor,
  PerpHistoryRow,
  PerpHistoryPage,
  GetPerpHistoryParams,
  OracleStatusInfo,
  PerpProtectionInfo,
  CanonicalPerpPosition,
  OpeningAuctionSummary,
  GenerateSeedLiquidityPlanParams,
  SeedLiquidityOrderTemplate,
  SeedLiquidityPlan,
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

export type Erc20FactoryDeployParams = IDiesisErc20FactoryDeployParams['params']

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

/** Actual native deployment-state storage response. */
export type PerpDeploymentState = {
  marketId: Hex
  stateTag: number
  state: string
  deadlineOrLiveBlock: bigint
  windowCloseBlock: bigint
  slashReason: number
  operator: Address
}

/** Metadata payload retained for consumers of direct lifecycle transactions. */
export type PerpMetadata = {
  maxLeverage: number
  backstopTopupBps: number
  marginTiers: Array<{ notionalCap: bigint; maintenanceMarginBps: number }>
}
export type PerpMetadataSignature = {
  signer: Address
  r: Hex
  s: Hex
  v: number
}
export type ProposeMetadataUpdateParams = {
  marketId: Hex
  newMetadata: PerpMetadata
  sigs: PerpMetadataSignature[]
}

export type ExchangePublicActions = {
  exchange: {
    getFeeEpoch: (params: {
      marketId: Hex
      epoch: bigint
    }) => Promise<IndexedResponse<FeeEpochStatus | null>>
    getFeeEpochHistory: (
      params: GetFeeEpochHistoryParams,
    ) => Promise<IndexedResponse<FeeEpochHistoryPage>>
    getPerpHistory: (
      params: GetPerpHistoryParams,
    ) => Promise<IndexedResponse<PerpHistoryPage>>
    getPerpFeeBalances: (params: {
      marketId: Hex
    }) => Promise<IndexedResponse<PerpFeeBalances>>
    getPerpFeeDistribution: (params: {
      marketId: Hex
      epoch: bigint
    }) => Promise<IndexedResponse<PerpFeeDistributionRead>>
    getOracleStatus: (params: { marketId: Hex }) => Promise<OracleStatusInfo>
    getPerpProtection: (params: {
      marketId: Hex
    }) => Promise<PerpProtectionInfo>
    getPerpPosition: (params: {
      user: Address
      marketId: Hex
    }) => Promise<CanonicalPerpPosition | null>
    getOpeningAuction: (params: {
      marketId: Hex
    }) => Promise<OpeningAuctionSummary>
    generateSeedLiquidityPlan: (
      params: GenerateSeedLiquidityPlanParams,
    ) => Promise<SeedLiquidityPlan>
    getOrderBook: (params: {
      marketId: Hex
      depth?: number
    }) => Promise<IndexedResponse<OrderBook>>
    getMarkets: () => Promise<IndexedResponse<MarketInfo[]>>
    getMarket: (params: { marketId: Hex }) => Promise<MarketInfo | null>
    getAccount: (params: {
      address: Address
    }) => Promise<IndexedResponse<TradingAccount>>
    getPositionCollateral: (params: {
      user: Address
      marketId: Hex
    }) => Promise<PositionCollateralCapability>
    getTrades: (params: {
      marketId: Hex
      limit?: number
    }) => Promise<IndexedResponse<Trade[]>>
    getFundingRates: (params: { marketId: Hex }) => Promise<FundingRateInfo>
    getMarkPrices: (params: { marketIds: Hex[] }) => Promise<MarkPrice[]>
    getInsuranceFund: (params: {
      marketId: Hex
    }) => Promise<InsuranceFundStatus>
    estimateFill: (params: {
      marketId: Hex
      side: number
      amount: bigint
      price?: bigint
    }) => Promise<IndexedResponse<FillEstimate>>
    getMarketDeploymentState: (params: {
      marketId: Hex
    }) => Promise<PerpDeploymentState | null>
    getOperatorBalance: (params: { operator: Address }) => Promise<bigint>
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

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}
function fixedHex(value: unknown, bytes: number, field: string): Hex {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)
  ) {
    throw new Error(`${field} must be ${bytes} bytes of hex`)
  }
  return value as Hex
}
function integer(
  value: unknown,
  bits: number,
  field: string,
  signed = false,
): bigint {
  let decoded: bigint
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    decoded = BigInt(value)
  } else if (
    typeof value === 'string' &&
    /^(?:-?(?:0|[1-9][0-9]*)|0x[0-9a-fA-F]+)$/.test(value)
  ) {
    const digits = value.startsWith('0x')
      ? value.length - 2
      : value.replace(/^-/, '').length
    const maxDigits = value.startsWith('0x')
      ? Math.ceil(bits / 4)
      : Math.ceil(bits * Math.LOG10E * Math.LN2)
    if (digits > maxDigits)
      throw new Error(`${field} exceeds ${signed ? 'int' : 'uint'}${bits}`)
    decoded = BigInt(value)
  } else {
    throw new Error(
      `${field} must be an exact integer; unsafe JSON numbers are unsupported`,
    )
  }
  const upper = 1n << BigInt(signed ? bits - 1 : bits)
  if (decoded < (signed ? -upper : 0n) || decoded >= upper) {
    throw new Error(`${field} exceeds ${signed ? 'int' : 'uint'}${bits}`)
  }
  return decoded
}
function count(value: unknown, bits: number, field: string): number {
  return Number(integer(value, bits, field))
}
function side(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1)
    throw new Error('side must be 0 (buy) or 1 (sell)')
  return value
}
function indexed<T>(
  value: unknown,
  decode: (data: unknown) => T,
): IndexedResponse<T> {
  const row = object(value, 'indexed response')
  const blockNumber = integer(row.blockNumber, 64, 'blockNumber')
  const blockHash = fixedHex(row.blockHash, 32, 'blockHash')
  const indexDigest = fixedHex(row.indexDigest, 32, 'indexDigest')
  return { blockNumber, blockHash, indexDigest, data: decode(row.data) }
}
function level(value: unknown): PriceLevel {
  const row = object(value, 'price level')
  return {
    price: integer(row.price, 64, 'price'),
    amount: integer(row.quantity, 64, 'quantity'),
    orders: count(row.order_count, 32, 'order_count'),
  }
}
function orderBook(value: unknown): OrderBook {
  const row = object(value, 'order book')
  return {
    marketId: fixedHex(row.market_id, 32, 'market_id'),
    bids: array(row.bids, 'bids').map(level),
    asks: array(row.asks, 'asks').map(level),
  }
}
function market(value: unknown): MarketInfo {
  const row = object(value, 'market')
  return {
    marketId: fixedHex(row.market_id, 32, 'market_id'),
    baseToken: fixedHex(row.base_token, 20, 'base_token'),
    quoteToken: fixedHex(row.quote_token, 20, 'quote_token'),
    marketType: count(row.market_type, 8, 'market_type'),
    status: count(row.state, 8, 'state'),
    tickSize: integer(row.tick_size, 64, 'tick_size'),
    lotSize: integer(row.lot_size, 64, 'lot_size'),
  }
}
function tradingAccount(value: unknown): TradingAccount {
  const row = object(value, 'account')
  return {
    user: fixedHex(row.user, 20, 'user'),
    balances: array(row.balances, 'balances').map((value) => {
      const balance = object(value, 'balance')
      return {
        token: fixedHex(balance.token, 20, 'token'),
        available: integer(balance.available, 256, 'available'),
        locked: integer(balance.locked, 256, 'locked'),
        total: integer(balance.total, 256, 'total'),
      }
    }),
    open_order_count: count(row.open_order_count, 32, 'open_order_count'),
    open_position_count: count(
      row.open_position_count,
      32,
      'open_position_count',
    ),
  }
}
function trade(value: unknown): Trade {
  const row = object(value, 'trade')
  return {
    marketId: fixedHex(row.market_id, 32, 'market_id'),
    price: integer(row.price, 64, 'price'),
    quantity: integer(row.quantity, 64, 'quantity'),
    side: side(row.side),
    blockNumber: integer(row.block_number, 64, 'block_number'),
  }
}
function fillEstimate(value: unknown): FillEstimate {
  const row = object(value, 'fill estimate')
  return {
    avgPrice: integer(row.avgPrice, 256, 'avgPrice'),
    totalCost: integer(row.totalCost, 256, 'totalCost'),
    fills: count(row.fills, 32, 'fills'),
    slippageBps: count(row.slippageBps, 32, 'slippageBps'),
  }
}

function collateralCapability(value: unknown): PositionCollateralCapability {
  const row = object(value, 'position collateral')
  if (row.capabilityVersion !== 1)
    throw new Error('unsupported collateral capability version')
  if (typeof row.active !== 'boolean' || typeof row.eligible !== 'boolean') {
    throw new Error('active and eligible must be booleans')
  }
  const decimal = (value: unknown, field: string): string | null => {
    if (value === null) return null
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
      throw new Error(`${field} must be a decimal string or null`)
    }
    integer(value, 256, field)
    return value
  }
  if (
    row.unavailableReason !== null &&
    typeof row.unavailableReason !== 'string'
  ) {
    throw new Error('unavailableReason must be a string or null')
  }
  return {
    capabilityVersion: 1,
    active: row.active,
    eligible: row.eligible,
    user: fixedHex(row.user, 20, 'user'),
    marketId: fixedHex(row.marketId, 32, 'marketId'),
    quoteToken: fixedHex(row.quoteToken, 20, 'quoteToken'),
    side: row.side === null ? null : side(row.side),
    size: decimal(row.size, 'size'),
    currentClaim: decimal(row.currentClaim, 'currentClaim'),
    addableCollateral: decimal(row.addableCollateral, 'addableCollateral'),
    withdrawableCollateral: decimal(
      row.withdrawableCollateral,
      'withdrawableCollateral',
    ),
    unavailableReason: row.unavailableReason,
  }
}

type Decoder<T> = (value: unknown) => T
function shape<T>(fields: { [K in keyof T]: Decoder<T[K]> }): Decoder<T> {
  return (value) => {
    const row = object(value, 'exchange response')
    const result = {} as T
    for (const key of Object.keys(fields) as Array<keyof T>) {
      result[key] = fields[key](row[String(key)])
    }
    return result
  }
}
const uint64 = (value: unknown) => integer(value, 64, 'uint64')
const uint256 = (value: unknown) => integer(value, 256, 'uint256')
const uint8 = (value: unknown) => count(value, 8, 'uint8')
const uint16 = (value: unknown) => count(value, 16, 'uint16')
const uint32 = (value: unknown) => count(value, 32, 'uint32')
const hash = (value: unknown) => fixedHex(value, 32, 'hash')
const address = (value: unknown) => fixedHex(value, 20, 'address')
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('expected a boolean')
  return value
}
function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value) => (value === null ? null : decode(value))
}
function boundedArray(value: unknown, max: number, field: string): unknown[] {
  const values = array(value, field)
  if (values.length > max) throw new Error(`${field} exceeds ${max} entries`)
  return values
}
function splitBps(value: unknown): [number, number, number] {
  const values = boundedArray(value, 3, 'residualSplitBps')
  if (values.length !== 3)
    throw new Error('residualSplitBps must have three entries')
  return [uint16(values[0]), uint16(values[1]), uint16(values[2])]
}
function historyKind(value: unknown): PerpHistoryKind {
  if (value !== 'trade' && value !== 'funding' && value !== 'liquidation')
    throw new Error('invalid perpetual history kind')
  return value
}
const feeEpoch = shape<FeeEpochStatus>({
  marketId: hash,
  epoch: uint64,
  policyRevision: uint64,
  backstopTopupBps: uint16,
  burn: address,
  treasury: address,
  validators: address,
  residualSplitBps: splitBps,
  snapshotHash: hash,
  accruedTotal: uint256,
  distributionId: hash,
  finalized: boolean,
})
const feeBalances = shape<PerpFeeBalances>({
  marketId: hash,
  quoteToken: address,
  protocolFee: uint256,
  marketInsurance: uint256,
  globalInsuranceReserve: uint256,
  backstopCollateral: uint256,
})
const recipientAllocation = shape<PerpFeeRecipientAllocation>({
  recipient: address,
  amount: uint256,
})
const feeAllocation = shape<PerpFeeDistributionAllocation>({
  quoteToken: address,
  policyRevision: uint64,
  backstopTopupBps: uint16,
  residualSplitBps: splitBps,
  snapshotHash: hash,
  accruedTotal: uint256,
  distributionId: nullable(hash),
  marketInsuranceTopup: uint256,
  burn: recipientAllocation,
  treasury: recipientAllocation,
  validators: recipientAllocation,
})
const feeDistributionShape = shape<PerpFeeDistributionRead>({
  marketId: hash,
  epoch: uint64,
  state: (value) => {
    if (value !== 'absent' && value !== 'projected' && value !== 'finalized')
      throw new Error('invalid fee distribution state')
    return value
  },
  allocation: nullable(feeAllocation),
})
function feeDistribution(value: unknown): PerpFeeDistributionRead {
  const result = feeDistributionShape(value)
  if ((result.state === 'absent') !== (result.allocation === null))
    throw new Error('fee distribution state does not match allocation')
  if (
    result.allocation !== null &&
    (result.state === 'projected') !==
      (result.allocation.distributionId === null)
  )
    throw new Error('fee distribution state does not match distributionId')
  return result
}
const feeCursor = shape<FeeEpochHistoryCursor>({
  marketId: hash,
  fromEpoch: uint64,
  toEpoch: uint64,
  nextEpoch: uint64,
  anchorBlockNumber: uint64,
  anchorBlockHash: hash,
})
const perpCursor = shape<PerpHistoryCursor>({
  marketId: hash,
  kind: historyKind,
  fromBlock: uint64,
  toBlock: uint64,
  nextBlockNumber: uint64,
  nextLogIndex: uint64,
  anchorBlockNumber: uint64,
  anchorBlockHash: hash,
  generation: uint64,
})
const perpHistoryRow = shape<PerpHistoryRow>({
  kind: historyKind,
  eventTag: uint16,
  blockNumber: uint64,
  blockHash: hash,
  transactionHash: hash,
  transactionIndex: uint32,
  logIndex: uint64,
  emitter: address,
  topics: (value) => {
    const values = boundedArray(value, 4, 'topics')
    if (values.length === 0) throw new Error('topics must be nonempty')
    return values.map(hash)
  },
  data: (value) => boundedArray(value, 1024 * 1024, 'receipt data').map(uint8),
})
const oracleStatus = shape<OracleStatusInfo>({
  marketId: hash,
  accepted: boolean,
  round: uint64,
  observedAt: uint64,
  indexPrice: uint64,
  markPrice: uint64,
  sourceSetHash: hash,
  evidenceHash: hash,
  status: uint8,
  divergenceCount: uint64,
  recoveryCount: uint64,
})
const perpProtection = shape<PerpProtectionInfo>({
  marketId: hash,
  continuationKind: uint8,
  side: uint8,
  boundary: uint256,
  target: uint256,
  backstopCollateral: uint256,
})
const perpPosition = shape<CanonicalPerpPosition>({
  user: address,
  marketId: hash,
  side,
  size: uint256,
  storedClaim: uint256,
  currentClaim: uint256,
  priceIndex: uint256,
  fundingIndex: uint256,
})
const openingAuction = shape<OpeningAuctionSummary>({
  marketId: hash,
  startBlock: uint64,
  endBlock: uint64,
  referencePrice: uint256,
  finalized: boolean,
  clearingPrice: uint256,
  totalVolume: uint256,
})
const seedOrder = shape<SeedLiquidityOrderTemplate>({
  marketId: hash,
  side,
  price: uint64,
  quantity: uint64,
})
const seedPlan = shape<SeedLiquidityPlan>({
  marketId: hash,
  referencePrice: uint64,
  orders: (value) => boundedArray(value, 200, 'seed orders').map(seedOrder),
})

/** serde's bare u64 request fields require JSON numbers, not quantity strings. */
function jsonUint64(value: bigint, field: string, nonzero = false): number {
  if (typeof value !== 'bigint') throw new Error(`${field} must be a bigint`)
  integer(value.toString(), 64, field)
  if (nonzero && value === 0n) throw new Error(`${field} must be nonzero`)
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(
      `${field} cannot be encoded as an exact native JSON integer`,
    )
  return Number(value)
}
function fieldsOnly(value: object, fields: string[]): void {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) throw new Error(`unknown query field ${key}`)
}
function boundedCount(
  value: number | undefined,
  max: number,
  field: string,
): number | undefined {
  if (value === undefined) return undefined
  const result = count(value, 32, field)
  if (result === 0 || result > max)
    throw new Error(`${field} must be between 1 and ${max}`)
  return result
}
function equalHex(a: Hex, b: Hex): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
function bindFeeCursor(
  cursor: FeeEpochHistoryCursor,
  params: GetFeeEpochHistoryParams,
): void {
  if (
    !equalHex(cursor.marketId, params.marketId) ||
    cursor.fromEpoch !== params.fromEpoch ||
    cursor.toEpoch !== params.toEpoch ||
    cursor.nextEpoch < params.fromEpoch ||
    cursor.nextEpoch > params.toEpoch
  )
    throw new Error('fee history cursor does not bind this market and range')
}
function bindPerpCursor(
  cursor: PerpHistoryCursor,
  params: GetPerpHistoryParams,
): void {
  if (
    !equalHex(cursor.marketId, params.marketId) ||
    cursor.kind !== params.kind ||
    cursor.fromBlock !== params.fromBlock ||
    cursor.toBlock !== params.toBlock ||
    cursor.nextBlockNumber < params.fromBlock ||
    cursor.nextBlockNumber > params.toBlock
  )
    throw new Error(
      'perpetual history cursor does not bind this market, kind, and range',
    )
}
function wireCursor(
  cursor: FeeEpochHistoryCursor | PerpHistoryCursor,
): Record<string, number | string> {
  const result: Record<string, number | string> = {}
  for (const [key, value] of Object.entries(cursor))
    result[key] = typeof value === 'bigint' ? jsonUint64(value, key) : value
  return result
}
function feeHistoryQuery(
  params: GetFeeEpochHistoryParams,
): Record<string, unknown> {
  fieldsOnly(params, [
    'marketId',
    'fromEpoch',
    'toEpoch',
    'cursor',
    'limit',
    'scanBudget',
  ])
  const query: Record<string, unknown> = {
    marketId: hash(params.marketId),
    fromEpoch: jsonUint64(params.fromEpoch, 'fromEpoch', true),
    toEpoch: jsonUint64(params.toEpoch, 'toEpoch', true),
  }
  if (params.fromEpoch > params.toEpoch)
    throw new Error('fromEpoch must not exceed toEpoch')
  if (params.limit !== undefined)
    query.limit = boundedCount(params.limit, 256, 'limit')
  if (params.scanBudget !== undefined)
    query.scanBudget = boundedCount(params.scanBudget, 4096, 'scanBudget')
  if (params.cursor !== undefined) {
    if (params.cursor === null) query.cursor = null
    else {
      fieldsOnly(params.cursor, [
        'marketId',
        'fromEpoch',
        'toEpoch',
        'nextEpoch',
        'anchorBlockNumber',
        'anchorBlockHash',
      ])
      // Validate bigint model fields before producing the native JSON cursor.
      const cursor = feeCursor(wireCursor(params.cursor))
      bindFeeCursor(cursor, params)
      query.cursor = wireCursor(cursor)
    }
  }
  return query
}
function perpHistoryQuery(
  params: GetPerpHistoryParams,
): Record<string, unknown> {
  fieldsOnly(params, [
    'marketId',
    'kind',
    'fromBlock',
    'toBlock',
    'cursor',
    'limit',
    'scanBudget',
  ])
  const query: Record<string, unknown> = {
    marketId: hash(params.marketId),
    kind: historyKind(params.kind),
    fromBlock: jsonUint64(params.fromBlock, 'fromBlock'),
    toBlock: jsonUint64(params.toBlock, 'toBlock'),
  }
  if (params.fromBlock > params.toBlock)
    throw new Error('fromBlock must not exceed toBlock')
  if (params.limit !== undefined)
    query.limit = boundedCount(params.limit, 256, 'limit')
  if (params.scanBudget !== undefined)
    query.scanBudget = boundedCount(params.scanBudget, 4096, 'scanBudget')
  if (params.cursor !== undefined) {
    if (params.cursor === null) query.cursor = null
    else {
      fieldsOnly(params.cursor, [
        'marketId',
        'kind',
        'fromBlock',
        'toBlock',
        'nextBlockNumber',
        'nextLogIndex',
        'anchorBlockNumber',
        'anchorBlockHash',
        'generation',
      ])
      const cursor = perpCursor(wireCursor(params.cursor))
      bindPerpCursor(cursor, params)
      query.cursor = wireCursor(cursor)
    }
  }
  return query
}
function bindAnchor(
  cursor: { anchorBlockNumber: bigint; anchorBlockHash: Hex } | null,
  response: IndexedResponse<unknown>,
): void {
  if (
    cursor !== null &&
    (cursor.anchorBlockNumber !== response.blockNumber ||
      !equalHex(cursor.anchorBlockHash, response.blockHash))
  )
    throw new Error('history cursor anchor does not match indexed response')
}
function decodeFeeHistory(
  value: unknown,
  params: GetFeeEpochHistoryParams,
): IndexedResponse<FeeEpochHistoryPage> {
  const response = indexed(value, (value): FeeEpochHistoryPage => {
    const row = object(value, 'fee history page')
    const rows = boundedArray(
      row.rows,
      Math.min(params.limit ?? 256, params.scanBudget ?? 4096),
      'fee rows',
    ).map(feeEpoch)
    let previous = (params.cursor?.nextEpoch ?? params.fromEpoch) - 1n
    for (const fee of rows) {
      if (
        !equalHex(fee.marketId, params.marketId) ||
        fee.epoch <= previous ||
        fee.epoch > params.toEpoch
      )
        throw new Error(
          'fee history rows do not match requested ascending range',
        )
      previous = fee.epoch
    }
    const next = nullable(feeCursor)(row.next)
    if (next !== null) {
      bindFeeCursor(next, params)
      if (
        next.nextEpoch <= previous ||
        next.nextEpoch <= (params.cursor?.nextEpoch ?? params.fromEpoch)
      )
        throw new Error('fee history cursor does not advance')
    }
    return { rows, next }
  })
  bindAnchor(response.data.next, response)
  if (params.cursor) bindAnchor(params.cursor, response)
  return response
}
function decodePerpHistory(
  value: unknown,
  params: GetPerpHistoryParams,
): IndexedResponse<PerpHistoryPage> {
  const response = indexed(value, (value): PerpHistoryPage => {
    const row = object(value, 'perpetual history page')
    const rows = boundedArray(
      row.rows,
      Math.min(params.limit ?? 256, params.scanBudget ?? 4096),
      'perpetual rows',
    ).map(perpHistoryRow)
    let previousBlock = params.cursor?.nextBlockNumber ?? params.fromBlock
    let previousLog = (params.cursor?.nextLogIndex ?? 0n) - 1n
    for (const event of rows) {
      if (
        event.kind !== params.kind ||
        event.blockNumber < previousBlock ||
        event.blockNumber > params.toBlock ||
        (event.blockNumber === previousBlock && event.logIndex <= previousLog)
      )
        throw new Error(
          'perpetual history rows do not match requested ascending range',
        )
      previousBlock = event.blockNumber
      previousLog = event.logIndex
    }
    const next = nullable(perpCursor)(row.next)
    if (next !== null) {
      bindPerpCursor(next, params)
      if (
        next.nextBlockNumber < previousBlock ||
        (next.nextBlockNumber === previousBlock &&
          next.nextLogIndex <= previousLog) ||
        next.nextBlockNumber <
          (params.cursor?.nextBlockNumber ?? params.fromBlock) ||
        (next.nextBlockNumber ===
          (params.cursor?.nextBlockNumber ?? params.fromBlock) &&
          next.nextLogIndex <= (params.cursor?.nextLogIndex ?? 0n))
      )
        throw new Error('perpetual history cursor does not advance')
      if (params.cursor && next.generation !== params.cursor.generation)
        throw new Error('perpetual history cursor generation changed')
    }
    return { rows, next }
  })
  bindAnchor(response.data.next, response)
  if (params.cursor) bindAnchor(params.cursor, response)
  return response
}

export function exchangePublicActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): ExchangePublicActions {
  const request = (method: string, params: unknown[]): Promise<unknown> =>
    client.request({ method, params } as never)
  const marketId = (value: unknown) => fixedHex(value, 32, 'marketId')
  return {
    exchange: {
      getFeeEpoch: async (params) =>
        indexed(
          await request('exchange_getFeeEpoch', [
            marketId(params.marketId),
            jsonUint64(params.epoch, 'epoch', true),
          ]),
          nullable(feeEpoch),
        ),
      getFeeEpochHistory: async (params) =>
        decodeFeeHistory(
          await request('exchange_getFeeEpochHistory', [
            feeHistoryQuery(params),
          ]),
          params,
        ),
      getPerpHistory: async (params) =>
        decodePerpHistory(
          await request('exchange_getPerpHistory', [perpHistoryQuery(params)]),
          params,
        ),
      getPerpFeeBalances: async (params) =>
        indexed(
          await request('exchange_getPerpFeeBalances', [
            marketId(params.marketId),
          ]),
          feeBalances,
        ),
      getPerpFeeDistribution: async (params) =>
        indexed(
          await request('exchange_getPerpFeeDistribution', [
            marketId(params.marketId),
            jsonUint64(params.epoch, 'epoch', true),
          ]),
          feeDistribution,
        ),
      getOracleStatus: async (params) =>
        oracleStatus(
          await request('exchange_getOracleStatus', [
            marketId(params.marketId),
          ]),
        ),
      getPerpProtection: async (params) => {
        const result = perpProtection(
          await request('exchange_getPerpProtection', [
            marketId(params.marketId),
          ]),
        )
        if (
          result.continuationKind > 2 ||
          (result.continuationKind !== 0 && result.side > 1)
        )
          throw new Error('invalid canonical protection continuation')
        return result
      },
      getPerpPosition: async (params) =>
        nullable(perpPosition)(
          await request('exchange_getPerpPosition', [
            address(params.user),
            marketId(params.marketId),
          ]),
        ),
      getOpeningAuction: async (params) =>
        openingAuction(
          await request('exchange_getOpeningAuction', [
            marketId(params.marketId),
          ]),
        ),
      generateSeedLiquidityPlan: async (params) => {
        const referencePrice = jsonUint64(
          params.referencePrice,
          'referencePrice',
          true,
        )
        const baseQuantity = jsonUint64(
          params.baseQuantity,
          'baseQuantity',
          true,
        )
        const tickSpacing = jsonUint64(params.tickSpacing, 'tickSpacing', true)
        const levels = boundedCount(params.levels, 100, 'levels')
        if (levels === undefined) throw new Error('levels is required')
        const offset = params.tickSpacing * BigInt(levels)
        if (
          params.referencePrice < offset ||
          params.referencePrice + offset >= 1n << 64n
        )
          throw new Error('seed plan price bounds overflow or underflow')
        return seedPlan(
          await request('exchange_generateSeedLiquidityPlan', [
            {
              marketId: marketId(params.marketId),
              referencePrice,
              levels,
              baseQuantity,
              tickSpacing,
            },
          ]),
        )
      },
      getOrderBook: async (params) => {
        const query = {
          marketId: marketId(params.marketId),
          ...(params.depth === undefined
            ? {}
            : {
                depth: Math.min(
                  100,
                  Math.max(1, count(params.depth, 32, 'depth')),
                ),
              }),
        }
        return indexed(
          await request('exchange_getOrderBook', [query]),
          orderBook,
        )
      },
      getMarkets: async () =>
        indexed(await request('exchange_getMarkets', []), (data) =>
          array(data, 'markets').map(market),
        ),
      getMarket: async (params) => {
        const value = await request('exchange_getMarket', [
          marketId(params.marketId),
        ])
        return value === null ? null : market(value)
      },
      getAccount: async (params) =>
        indexed(
          await request('exchange_getAccount', [
            fixedHex(params.address, 20, 'address'),
          ]),
          tradingAccount,
        ),
      getPositionCollateral: async (params) =>
        collateralCapability(
          await request('exchange_getPositionCollateral', [
            fixedHex(params.user, 20, 'user'),
            marketId(params.marketId),
          ]),
        ),
      getTrades: async (params) => {
        const query = {
          marketId: marketId(params.marketId),
          ...(params.limit === undefined
            ? {}
            : { limit: count(params.limit, 32, 'limit') }),
        }
        return indexed(await request('exchange_getTrades', [query]), (data) =>
          array(data, 'trades').map(trade),
        )
      },
      getFundingRates: async (params) => {
        const row = object(
          await request('exchange_getFundingRates', [
            marketId(params.marketId),
          ]),
          'funding rates',
        )
        return {
          market_id: fixedHex(row.market_id, 32, 'market_id'),
          current_rate_bps: integer(
            row.current_rate_bps,
            64,
            'current_rate_bps',
            true,
          ),
          cumulative_index: integer(
            row.cumulative_index,
            128,
            'cumulative_index',
            true,
          ),
        }
      },
      getMarkPrices: async (params) => {
        if (params.marketIds.length > 256)
          throw new Error('getMarkPrices accepts at most 256 market IDs')
        const values = array(
          await request('exchange_getMarkPrices', [
            params.marketIds.map(marketId),
          ]),
          'mark prices',
        )
        return values.map((value): MarkPrice => {
          const tuple = array(value, 'mark price')
          if (tuple.length !== 2)
            throw new Error('mark price must contain exactly two fields')
          return [marketId(tuple[0]), integer(tuple[1], 64, 'mark price')]
        })
      },
      getInsuranceFund: async (params) => {
        const row = object(
          await request('exchange_getInsuranceFund', [
            marketId(params.marketId),
          ]),
          'insurance fund',
        )
        return {
          market_id: fixedHex(row.market_id, 32, 'market_id'),
          market_balance: integer(row.market_balance, 256, 'market_balance'),
          global_balance: integer(row.global_balance, 256, 'global_balance'),
        }
      },
      estimateFill: async (params) => {
        if (
          typeof params.amount !== 'bigint' ||
          (params.price !== undefined && typeof params.price !== 'bigint')
        )
          throw new Error('amount and price must be bigints')
        const amount = integer(params.amount.toString(), 64, 'amount')
        const price =
          params.price === undefined
            ? undefined
            : integer(params.price.toString(), 64, 'price')
        return indexed(
          await request('exchange_estimateFill', [
            {
              marketId: marketId(params.marketId),
              side: side(params.side),
              amount: `0x${amount.toString(16)}`,
              ...(price === undefined
                ? {}
                : { price: `0x${price.toString(16)}` }),
            },
          ]),
          fillEstimate,
        )
      },
      getMarketDeploymentState: async (params) => {
        const value = await request('exchange_getMarketDeploymentState', [
          marketId(params.marketId),
        ])
        if (value === null) return null
        const row = object(value, 'deployment state')
        if (typeof row.state !== 'string')
          throw new Error('state must be a string')
        return {
          marketId: marketId(row.marketId),
          stateTag: count(row.stateTag, 8, 'stateTag'),
          state: row.state,
          deadlineOrLiveBlock: integer(
            row.deadlineOrLiveBlock,
            64,
            'deadlineOrLiveBlock',
          ),
          windowCloseBlock: integer(
            row.windowCloseBlock,
            64,
            'windowCloseBlock',
          ),
          slashReason: count(row.slashReason, 8, 'slashReason'),
          operator: fixedHex(row.operator, 20, 'operator'),
        }
      },
      getOperatorBalance: async (params) =>
        integer(
          await request('exchange_getOperatorBalance', [
            fixedHex(params.operator, 20, 'operator'),
          ]),
          256,
          'operator balance',
        ),
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
