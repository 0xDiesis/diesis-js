import type { Address, Hex } from 'viem'

/** Same-anchor canonical custody facts, separate from legacy account hints. */
export type GetAccountCustodyParams = { address: Address }
export type CustodyRead = {
  readVersion: 1
  /** Local publication generation, not a financial or authorization generation. */
  indexGeneration: bigint
  value: AccountCustody
}
export type AccountCustody = {
  user: Address
  /** Each asset uses its own token raw units; do not sum unlike tokens. */
  assets: CustodyAsset[]
  /** Every registered perpetual market, including zero reserves and claims. */
  margins: CustodyMargin[]
  /** Producer evidence, not an SDK proof that indexDigest commits inventory. */
  coverage: CustodyCoverage
}
export type CustodyAsset = {
  token: Address
  /** Global custody, already including the locked subset. */
  totalBalance: bigint
  lockedBalance: bigint
  spendableBalance: bigint
  /** Aggregate also itemized in margins; never add both representations. */
  reservedUserMargin: bigint
  /** Aggregate also itemized in margins; never add both representations. */
  evaluatedPositionClaims: bigint
  /** Total plus reserves and claims, without adding locks a second time. */
  accountValueRaw: bigint
}
export type CustodyMargin = {
  marketId: Hex
  token: Address
  reservedUserMargin: bigint
  evaluatedPositionClaim: bigint
}
export type CustodyGap = { fromBlock: bigint; toBlock: bigint }
export type CustodyCoverage = {
  complete: boolean
  genesisCustodyProvenEmpty: boolean
  /** Commitment supplied by the producer; null means provenance is unknown. */
  genesisPrestateHash: Hex | null
  gaps: CustodyGap[]
  gapRangesTruncated: boolean
  inventoryTruncated: boolean
}
const U256_LIMIT = 1n << 256n
const U64_LIMIT = 1n << 64n
function object(
  value: unknown,
  field: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be an object`)
  for (const key of Object.keys(value))
    if (!fields.includes(key))
      throw new Error(`${field} has unknown field ${key}`)
  return value as Record<string, unknown>
}
function hex(value: unknown, bytes: number, field: string): Hex {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value) ||
    BigInt(value) === 0n
  )
    throw new Error(`${field} must be nonzero ${bytes}-byte hex`)
  return value as Hex
}
function amount(value: unknown, field: string): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 66 ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  )
    throw new Error(`${field} must be a canonical uint256 hex quantity`)
  const result = BigInt(value)
  if (result >= U256_LIMIT) throw new Error(`${field} exceeds uint256`)
  return result
}
function generation(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 20 ||
    !/^(?:0|[1-9][0-9]*)$/.test(value)
  )
    throw new Error('indexGeneration must be a decimal uint64 string')
  const result = BigInt(value)
  if (result >= U64_LIMIT) throw new Error('indexGeneration exceeds uint64')
  return result
}
function block(value: unknown, field: string): bigint {
  let result: bigint
  if (typeof value === 'number' && Number.isSafeInteger(value))
    result = BigInt(value)
  else if (
    typeof value === 'string' &&
    /^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-fA-F][0-9a-fA-F]*))$/.test(value) &&
    value.length <= (value.startsWith('0x') ? 18 : 20)
  )
    result = BigInt(value)
  else throw new Error(`${field} must be a lossless uint64`)
  if (result < 0n || result >= U64_LIMIT)
    throw new Error(`${field} exceeds uint64`)
  return result
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`)
  return value
}
function array(value: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${field} must be an array of at most ${max} rows`)
  return value
}
function sum(a: bigint, b: bigint): bigint {
  const result = a + b
  if (result >= U256_LIMIT) throw new Error('custody sum exceeds uint256')
  return result
}
/** Validate the one native Address argument before issuing an RPC request. */
export function custodyQuery(params: GetAccountCustodyParams): Address {
  const query = object(params, 'custody query', ['address'])
  return hex(query.address, 20, 'address') as Address
}
/** Decode versioned facts and bind discovery gaps to the accepted outer anchor. */
export function decodeCustodyRead(
  data: unknown,
  query: Address,
  blockNumber: bigint,
): CustodyRead {
  const read = object(data, 'custody read', [
    'readVersion',
    'indexGeneration',
    'value',
  ])
  if (read.readVersion !== 1) throw new Error('custody readVersion must be 1')
  const indexGeneration = generation(read.indexGeneration)
  const value = object(read.value, 'custody value', [
    'user',
    'assets',
    'margins',
    'coverage',
  ])
  const user = hex(value.user, 20, 'user') as Address
  if (user.toLowerCase() !== query.toLowerCase())
    throw new Error('custody user differs from queried address')
  const seenMarkets = new Set<string>()
  const aggregates = new Map<string, { reserved: bigint; claims: bigint }>()
  const margins = array(value.margins, 256, 'margins').map(
    (raw): CustodyMargin => {
      const row = object(raw, 'custody margin', [
        'marketId',
        'token',
        'reservedUserMargin',
        'evaluatedPositionClaim',
      ])
      const marketId = hex(row.marketId, 32, 'marketId')
      if (seenMarkets.has(marketId.toLowerCase()))
        throw new Error('duplicate custody market')
      seenMarkets.add(marketId.toLowerCase())
      const token = hex(row.token, 20, 'margin token') as Address
      const reservedUserMargin = amount(
        row.reservedUserMargin,
        'reservedUserMargin',
      )
      const evaluatedPositionClaim = amount(
        row.evaluatedPositionClaim,
        'evaluatedPositionClaim',
      )
      const key = token.toLowerCase()
      const previous = aggregates.get(key) ?? { reserved: 0n, claims: 0n }
      aggregates.set(key, {
        reserved: sum(previous.reserved, reservedUserMargin),
        claims: sum(previous.claims, evaluatedPositionClaim),
      })
      return { marketId, token, reservedUserMargin, evaluatedPositionClaim }
    },
  )
  const seenTokens = new Set<string>()
  const assets = array(value.assets, 256, 'assets').map((raw): CustodyAsset => {
    const row = object(raw, 'custody asset', [
      'token',
      'totalBalance',
      'lockedBalance',
      'spendableBalance',
      'reservedUserMargin',
      'evaluatedPositionClaims',
      'accountValueRaw',
    ])
    const token = hex(row.token, 20, 'asset token') as Address
    const key = token.toLowerCase()
    if (seenTokens.has(key)) throw new Error('duplicate custody asset')
    seenTokens.add(key)
    const totalBalance = amount(row.totalBalance, 'totalBalance')
    const lockedBalance = amount(row.lockedBalance, 'lockedBalance')
    const spendableBalance = amount(row.spendableBalance, 'spendableBalance')
    const reservedUserMargin = amount(
      row.reservedUserMargin,
      'reservedUserMargin',
    )
    const evaluatedPositionClaims = amount(
      row.evaluatedPositionClaims,
      'evaluatedPositionClaims',
    )
    const accountValueRaw = amount(row.accountValueRaw, 'accountValueRaw')
    if (
      lockedBalance > totalBalance ||
      spendableBalance !== totalBalance - lockedBalance
    )
      throw new Error('custody locked/spendable subset is inconsistent')
    if (
      accountValueRaw !==
      sum(sum(totalBalance, reservedUserMargin), evaluatedPositionClaims)
    )
      throw new Error('custody account value counts its buckets incorrectly')
    const expected = aggregates.get(key) ?? { reserved: 0n, claims: 0n }
    if (
      reservedUserMargin !== expected.reserved ||
      evaluatedPositionClaims !== expected.claims
    )
      throw new Error('custody asset aggregates differ from market rows')
    if (accountValueRaw === 0n)
      throw new Error('native custody omits all-zero asset rows')
    aggregates.delete(key)
    return {
      token,
      totalBalance,
      lockedBalance,
      spendableBalance,
      reservedUserMargin,
      evaluatedPositionClaims,
      accountValueRaw,
    }
  })
  for (const { reserved, claims } of aggregates.values())
    if (reserved !== 0n || claims !== 0n)
      throw new Error('nonzero custody market amounts have no asset aggregate')
  const coverage = object(value.coverage, 'custody coverage', [
    'complete',
    'genesisCustodyProvenEmpty',
    'genesisPrestateHash',
    'gaps',
    'gapRangesTruncated',
    'inventoryTruncated',
  ])
  const complete = boolean(coverage.complete, 'complete')
  const genesisCustodyProvenEmpty = boolean(
    coverage.genesisCustodyProvenEmpty,
    'genesisCustodyProvenEmpty',
  )
  const genesisPrestateHash =
    coverage.genesisPrestateHash === null
      ? null
      : hex(coverage.genesisPrestateHash, 32, 'genesisPrestateHash')
  if (genesisCustodyProvenEmpty && genesisPrestateHash === null)
    throw new Error('empty custody genesis has no provenance commitment')
  const gapRangesTruncated = boolean(
    coverage.gapRangesTruncated,
    'gapRangesTruncated',
  )
  const inventoryTruncated = boolean(
    coverage.inventoryTruncated,
    'inventoryTruncated',
  )
  let previous: bigint | null = null
  const gaps = array(coverage.gaps, 128, 'custody gaps').map(
    (raw): CustodyGap => {
      const row = object(raw, 'custody gap', ['fromBlock', 'toBlock'])
      const fromBlock = block(row.fromBlock, 'fromBlock')
      const toBlock = block(row.toBlock, 'toBlock')
      if (
        fromBlock > toBlock ||
        toBlock > blockNumber ||
        (genesisCustodyProvenEmpty && fromBlock === 0n) ||
        (previous !== null && fromBlock <= previous)
      )
        throw new Error('custody gap is outside anchor or noncanonical')
      previous = toBlock
      return { fromBlock, toBlock }
    },
  )
  const lastGap = gaps.at(-1)
  if (
    gapRangesTruncated &&
    (gaps.length !== 128 ||
      lastGap === undefined ||
      lastGap.toBlock >= blockNumber)
  )
    throw new Error(
      'truncated custody gaps must list 128 ranges and leave room through the anchor',
    )
  if (
    complete !==
    (genesisCustodyProvenEmpty &&
      gaps.length === 0 &&
      !gapRangesTruncated &&
      !inventoryTruncated)
  )
    throw new Error('custody completeness differs from producer evidence')
  return {
    readVersion: 1,
    indexGeneration,
    value: {
      user,
      assets,
      margins,
      coverage: {
        complete,
        genesisCustodyProvenEmpty,
        genesisPrestateHash,
        gaps,
        gapRangesTruncated,
        inventoryTruncated,
      },
    },
  }
}
