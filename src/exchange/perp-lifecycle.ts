import {
  IDiesisIssuanceAuctionAbi,
  IDiesisOperatorBondAbi,
  IDiesisPerpDeployAbi,
} from '../abi/index.js'
import * as addresses from '../addresses.js'
import type {
  IDiesisIssuanceAuctionBidUnpricedPerpListingParams,
  IDiesisPerpDeployInitializeBasicPerpMarketParams,
  IDiesisPerpDeployInitializePolicyPerpMarketParams,
} from '../abi/bindings/viem/index.js'
import {
  concatHex,
  encodeFunctionData,
  encodePacked,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Chain,
  type ContractFunctionReturnType,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'

// crates/contracts/src/precompile_registry.rs::DIESIS_CANONICAL_USDC_ADDR.
export const PERP_CANONICAL_USDC =
  '0x00d1e515000000000000000000000000000c5dc0' as Address
export const PERP_OPERATOR_BOND_VALUE = 50_000n * 10n ** 18n
const UINT64_MAX = (1n << 64n) - 1n
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_HASH = `0x${'00'.repeat(32)}`

export interface UnpricedPerpDeploymentEvidence {
  sourceList: Hex
  metadata: Hex
  signatures: Hex
}

// Contract shapes come from generated bindings; lifecycle policy remains handwritten.
export type UnpricedPerpRegistration =
  IDiesisIssuanceAuctionBidUnpricedPerpListingParams['registration']
export type PerpListingSlot = ContractFunctionReturnType<
  typeof IDiesisIssuanceAuctionAbi,
  'view',
  'getPerpListingSlot'
>
export type InitializeBasicPerpMarketParams =
  IDiesisPerpDeployInitializeBasicPerpMarketParams
export type InitializePolicyPerpMarketParams =
  IDiesisPerpDeployInitializePolicyPerpMarketParams

export type PerpLifecycleReader = Pick<
  PublicClient,
  'getChainId' | 'readContract' | 'estimateGas' | 'getTransactionCount'
>
export type PerpLifecycleWallet = Pick<
  WalletClient,
  'account' | 'chain' | 'getChainId' | 'getAddresses' | 'sendTransaction'
>

export interface PerpLifecycleAttempt {
  to: Address
  data: Hex
  value: bigint
  gas: bigint
  nonce: number
  owner: Address
  chainId: number
}

export interface PerpLifecycleContext {
  publicClient: PerpLifecycleReader
  walletClient: PerpLifecycleWallet
  chain: Chain
  /** Persist the attempt before wallet dispatch. Throwing prevents dispatch. */
  beforeDispatch?: (attempt: PerpLifecycleAttempt) => Promise<void>
}

function bytes(value: Hex, name: string, length?: number): void {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new Error(`${name} must be whole hex bytes`)
  }
  if (length !== undefined && value.length !== 2 + length * 2) {
    throw new Error(`${name} must be ${length} bytes`)
  }
}

function commitment(value: Hex, name: string): void {
  bytes(value, name, 32)
  if (value.toLowerCase() === ZERO_HASH)
    throw new Error(`${name} must be nonzero`)
}

function assets(baseAsset: Address, quoteAsset: Address): void {
  if (
    !isAddress(baseAsset, { strict: false }) ||
    !isAddress(quoteAsset, { strict: false })
  ) {
    throw new Error('Perpetual asset addresses are invalid')
  }
  if (
    baseAsset.toLowerCase() === ZERO_ADDRESS ||
    baseAsset.toLowerCase() === quoteAsset.toLowerCase()
  ) {
    throw new Error('Perpetual base must be nonzero and distinct from quote')
  }
  if (quoteAsset.toLowerCase() !== PERP_CANONICAL_USDC) {
    throw new Error('Perpetual listing requires canonical USDC quote custody')
  }
}

function evidence(params: UnpricedPerpDeploymentEvidence): void {
  let total = 0
  for (const name of ['sourceList', 'metadata', 'signatures'] as const) {
    bytes(params[name], name)
    const length = (params[name].length - 2) / 2
    if (length > 32 * 1024) throw new Error(`${name} exceeds 32 KiB`)
    total += length
  }
  if (total > 64 * 1024) throw new Error('Deployment evidence exceeds 64 KiB')
}

/** Legacy perpetual identity only. Priced identities require their own native contract. */
export function perpMarketId(baseAsset: Address, quoteAsset: Address): Hex {
  assets(baseAsset, quoteAsset)
  return keccak256(
    encodePacked(['address', 'address', 'uint8'], [baseAsset, quoteAsset, 1]),
  )
}

/** Commit the exact opaque bytes later supplied to deployPerp. */
export function computeUnpricedPerpDeploymentEvidence(
  params: { marketId: Hex } & UnpricedPerpDeploymentEvidence,
): Hex {
  commitment(params.marketId, 'marketId')
  evidence(params)
  return keccak256(
    concatHex([
      stringToHex('DiesisPerpDeploy.V1.DeploymentEvidence'),
      params.marketId,
      keccak256(params.sourceList),
      keccak256(params.metadata),
      keccak256(params.signatures),
    ]),
  )
}

export function computeUnpricedPerpRegistrationDigest(
  registration: UnpricedPerpRegistration,
): Hex {
  commitment(registration.marketId, 'marketId')
  commitment(registration.evidenceHash, 'evidenceHash')
  if (
    registration.marketId.toLowerCase() !==
    perpMarketId(registration.baseAsset, registration.quoteAsset)
  ) {
    throw new Error(
      'Registration marketId does not match canonical perpetual identity',
    )
  }
  return keccak256(
    concatHex([
      stringToHex('DiesisIssuanceAuction.PerpRegistrationV1'),
      registration.marketId,
      registration.baseAsset,
      registration.quoteAsset,
      registration.evidenceHash,
    ]),
  )
}

export function createUnpricedPerpRegistration(
  params: {
    baseAsset: Address
    quoteAsset: Address
  } & UnpricedPerpDeploymentEvidence,
): { registration: UnpricedPerpRegistration; registrationDigest: Hex } {
  const marketId = perpMarketId(params.baseAsset, params.quoteAsset)
  const registration = {
    marketId,
    baseAsset: params.baseAsset,
    quoteAsset: params.quoteAsset,
    evidenceHash: computeUnpricedPerpDeploymentEvidence({
      ...params,
      marketId,
    }),
  }
  return {
    registration,
    registrationDigest: computeUnpricedPerpRegistrationDigest(registration),
  }
}

function configuredChain(chain: Chain): void {
  if (!Number.isSafeInteger(chain?.id) || chain.id <= 0)
    throw new Error('Configured chain is required')
}

async function checkReaderChain(
  publicClient: PerpLifecycleReader,
  chain: Chain,
): Promise<void> {
  configuredChain(chain)
  if ((await publicClient.getChainId()) !== chain.id)
    throw new Error('Lifecycle read provider chain mismatch')
}

/** Slot winner/digest describe the current bid; they alone do not prove system settlement. */
export async function getPerpListingSlot(
  publicClient: PerpLifecycleReader,
  chain: Chain,
  blockNumber?: bigint,
): Promise<PerpListingSlot> {
  await checkReaderChain(publicClient, chain)
  return publicClient.readContract({
    address: addresses.DIESIS_ISSUANCE_AUCTION,
    abi: IDiesisIssuanceAuctionAbi,
    functionName: 'getPerpListingSlot',
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
}

export async function currentPerpListingPrice(
  publicClient: PerpLifecycleReader,
  chain: Chain,
  blockNumber?: bigint,
): Promise<bigint> {
  await checkReaderChain(publicClient, chain)
  return publicClient.readContract({
    address: addresses.DIESIS_ISSUANCE_AUCTION,
    abi: IDiesisIssuanceAuctionAbi,
    functionName: 'currentPerpListingPrice',
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
}

export async function getPerpDeploymentState(
  publicClient: PerpLifecycleReader,
  chain: Chain,
  marketId: Hex,
  blockNumber?: bigint,
) {
  commitment(marketId, 'marketId')
  await checkReaderChain(publicClient, chain)
  return publicClient.readContract({
    address: addresses.DIESIS_PERP_DEPLOY,
    abi: IDiesisPerpDeployAbi,
    functionName: 'getDeploymentState',
    args: [marketId],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
}

function initialization(
  params: InitializeBasicPerpMarketParams | InitializePolicyPerpMarketParams,
): void {
  assets(params.baseToken, params.quoteToken)
  // Both existing native initializers require u64 values for these uint256 ABI fields.
  // Priced initialization is a separate selector and must carry its own constraints.
  for (const name of [
    'tickSize',
    'lotSize',
    'maxOpenInterest',
    'initialMark',
  ] as const) {
    if (
      typeof params[name] !== 'bigint' ||
      params[name] <= 0n ||
      params[name] > UINT64_MAX
    ) {
      throw new Error(
        `${name} must be a positive uint64 for canonical initialization`,
      )
    }
  }
  if (params.initialMark % params.tickSize !== 0n)
    throw new Error('Initial mark must satisfy the tick grid')
  if (
    'maxLeverage' in params &&
    (!Number.isInteger(params.maxLeverage) ||
      params.maxLeverage < 1 ||
      params.maxLeverage > 50)
  ) {
    throw new Error('Maximum leverage must be between 1 and 50')
  }
}

/**
 * Direct EVM transactions, serialized within this instance to avoid nonce collisions.
 * Settlement, cooling, receipts, and nonce coordination across instances remain caller-managed.
 */
export function createPerpLifecycle({
  publicClient,
  walletClient,
  chain,
  beforeDispatch,
}: PerpLifecycleContext) {
  configuredChain(chain)
  const chainId = chain.id
  const capturedChain = Object.freeze({ ...chain })
  const account = walletClient.account
  if (
    !account ||
    !['json-rpc', 'local'].includes(account.type) ||
    !isAddress(account.address, { strict: false }) ||
    account.address.toLowerCase() === ZERO_ADDRESS
  ) {
    throw new Error(
      'An ordinary configured operator wallet account is required',
    )
  }
  const owner = account.address
  const accountType = account.type
  if (!walletClient.chain || walletClient.chain.id !== chainId)
    throw new Error('Configured wallet chain mismatch')

  function checkConfiguration(): void {
    if (
      chain.id !== chainId ||
      walletClient.chain?.id !== chainId ||
      walletClient.account?.address.toLowerCase() !== owner.toLowerCase() ||
      walletClient.account?.type !== accountType
    ) {
      throw new Error('Lifecycle wallet configuration changed')
    }
  }

  async function checkWallet(): Promise<void> {
    checkConfiguration()
    const [readChainId, walletChainId] = await Promise.all([
      publicClient.getChainId(),
      walletClient.getChainId(),
    ])
    if (readChainId !== chainId || walletChainId !== chainId)
      throw new Error('Lifecycle provider chain mismatch')
    if (accountType === 'json-rpc') {
      const connected = await walletClient.getAddresses()
      if (connected[0]?.toLowerCase() !== owner.toLowerCase())
        throw new Error('Connected operator account changed')
    }
  }

  let dispatchQueue: Promise<void> = Promise.resolve()

  function submit(to: Address, data: Hex, value = 0n): Promise<Hash> {
    const result = dispatchQueue.then(() => dispatch(to, data, value))
    // A rejected attempt must not prevent later, explicitly requested dispatches.
    dispatchQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function dispatch(
    to: Address,
    data: Hex,
    value: bigint,
  ): Promise<Hash> {
    await checkWallet()
    const estimate = await publicClient.estimateGas({
      account: owner,
      to,
      data,
      value,
    })
    if (typeof estimate !== 'bigint' || estimate <= 0n)
      throw new Error('A fresh positive gas estimate is required')
    const gas = (estimate * 110n + 99n) / 100n
    const nonce = await publicClient.getTransactionCount({
      address: owner,
      blockTag: 'pending',
    })
    if (!Number.isSafeInteger(nonce) || nonce < 0)
      throw new Error('Fresh operator transaction nonce unavailable')
    await checkWallet()
    if (beforeDispatch) {
      await beforeDispatch({ to, data, value, gas, nonce, owner, chainId })
      await checkWallet()
    }
    // No await may separate the final mutable-context fence from dispatch.
    checkConfiguration()
    return walletClient.sendTransaction({
      account: account!,
      chain: capturedChain,
      to,
      data,
      value,
      gas,
      nonce,
    })
  }

  return {
    async bidUnpricedPerpListing({
      registration,
    }: {
      registration: UnpricedPerpRegistration
    }): Promise<Hash> {
      computeUnpricedPerpRegistrationDigest(registration)
      return submit(
        addresses.DIESIS_ISSUANCE_AUCTION,
        encodeFunctionData({
          abi: IDiesisIssuanceAuctionAbi,
          functionName: 'bidUnpricedPerpListing',
          args: [registration],
        }),
      )
    },
    async postBond({ marketId }: { marketId: Hex }): Promise<Hash> {
      commitment(marketId, 'marketId')
      return submit(
        addresses.DIESIS_OPERATOR_BOND,
        encodeFunctionData({
          abi: IDiesisOperatorBondAbi,
          functionName: 'postBond',
          args: [marketId],
        }),
        PERP_OPERATOR_BOND_VALUE,
      )
    },
    async deployPerp(
      params: { slotId: Hex; marketId: Hex } & UnpricedPerpDeploymentEvidence,
    ): Promise<Hash> {
      commitment(params.slotId, 'slotId')
      computeUnpricedPerpDeploymentEvidence(params)
      return submit(
        addresses.DIESIS_PERP_DEPLOY,
        encodeFunctionData({
          abi: IDiesisPerpDeployAbi,
          functionName: 'deployPerp',
          args: [
            params.slotId,
            params.marketId,
            params.sourceList,
            params.metadata,
            params.signatures,
          ],
        }),
      )
    },
    async promoteToLive({ marketId }: { marketId: Hex }): Promise<Hash> {
      commitment(marketId, 'marketId')
      return submit(
        addresses.DIESIS_PERP_DEPLOY,
        encodeFunctionData({
          abi: IDiesisPerpDeployAbi,
          functionName: 'promoteToLive',
          args: [marketId],
        }),
      )
    },
    async initializeBasicPerpMarket(
      params: InitializeBasicPerpMarketParams,
    ): Promise<Hash> {
      initialization(params)
      return submit(
        addresses.DIESIS_PERP_DEPLOY,
        encodeFunctionData({
          abi: IDiesisPerpDeployAbi,
          functionName: 'initializeBasicPerpMarket',
          args: [
            params.baseToken,
            params.quoteToken,
            params.tickSize,
            params.lotSize,
            params.maxOpenInterest,
            params.initialMark,
            params.maxLeverage,
          ],
        }),
      )
    },
    async initializePolicyPerpMarket(
      params: InitializePolicyPerpMarketParams,
    ): Promise<Hash> {
      initialization(params)
      return submit(
        addresses.DIESIS_PERP_DEPLOY,
        encodeFunctionData({
          abi: IDiesisPerpDeployAbi,
          functionName: 'initializePolicyPerpMarket',
          args: [
            params.baseToken,
            params.quoteToken,
            params.tickSize,
            params.lotSize,
            params.maxOpenInterest,
            params.initialMark,
            params.policy,
            params.keyset,
          ],
        }),
      )
    },
  }
}

export type PerpLifecycle = ReturnType<typeof createPerpLifecycle>
