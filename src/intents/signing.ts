import type {
  WalletClient,
  Account,
  Transport,
  Chain,
  Hex,
  Address,
  Client,
  TypedDataDomain,
} from 'viem'
import { writeContract } from 'viem/actions'
import { IDiesisSettlementAbi } from '../abi/index.js'
import { DIESIS_SETTLEMENT } from '../addresses.js'
import type {
  OrderIntent,
  SignedOrderIntent,
  TradingKeyAuthorization,
} from './types.js'

/**
 * EIP-712 v2 type for the OrderIntent struct.
 *
 * Field order and types mirror `crates/exchange/src/intents/order_intent.rs`
 * exactly. Any reordering or renaming will change the struct hash and break
 * signature verification on-chain.
 */
export const ORDER_INTENT_TYPES = {
  OrderIntent: [
    { name: 'trader', type: 'address' },
    { name: 'marketId', type: 'bytes32' },
    { name: 'side', type: 'uint8' },
    { name: 'orderType', type: 'uint8' },
    { name: 'price', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'triggerPrice', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
    { name: 'flags', type: 'uint8' },
    { name: 'conductor', type: 'address' },
    { name: 'conductorFeeBps', type: 'uint16' },
    { name: 'maxConductorFee', type: 'uint256' },
  ],
} as const

const TRADING_KEY_TYPES = {
  TradingKeyAuthorization: [
    { name: 'tradingKey', type: 'address' },
    { name: 'expiry', type: 'uint256' },
    { name: 'maxNotional', type: 'uint256' },
    { name: 'markets', type: 'bytes32[]' },
    { name: 'canWithdraw', type: 'bool' },
  ],
} as const

/**
 * Build the EIP-712 domain for an OrderIntent.
 *
 * Mirrors `crates/exchange/src/intents/order_intent.rs::IntentDomain`. The
 * `verifyingContract` must be the address of the spot or perp book precompile
 * the intent is routed to — same address the on-chain side verifies against.
 */
export function getOrderIntentDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return {
    name: 'Diesis Exchange',
    version: '2',
    chainId,
    verifyingContract,
  } as const
}

export function getOrderIntentTypedData(
  intent: OrderIntent,
  verifyingContract: Address,
  chainId: number = 1980,
) {
  return {
    domain: getOrderIntentDomain(chainId, verifyingContract),
    types: ORDER_INTENT_TYPES,
    primaryType: 'OrderIntent',
    message: {
      trader: intent.trader,
      marketId: intent.marketId,
      side: intent.side,
      orderType: intent.orderType,
      price: intent.price,
      amount: intent.amount,
      triggerPrice: intent.triggerPrice,
      expiry: intent.expiry,
      nonce: intent.nonce,
      flags: intent.flags,
      conductor: intent.conductor,
      conductorFeeBps: intent.conductorFeeBps,
      maxConductorFee: intent.maxConductorFee,
    },
  } as const
}

export interface OrderIntentAccount {
  address: Address
  signTypedData: (typedData: ReturnType<typeof getOrderIntentTypedData>) => Promise<Hex>
}

/** Sign a gasless order intent with an arbitrary local or wallet-backed account. */
export async function signOrderIntentWithAccount(
  account: OrderIntentAccount,
  intent: OrderIntent,
  verifyingContract: Address,
  chainId: number = 1980,
): Promise<SignedOrderIntent> {
  const signature = await account.signTypedData(
    getOrderIntentTypedData(intent, verifyingContract, chainId),
  )
  return { intent, signature, signer: account.address }
}

/** Sign a gasless order intent using EIP-712 typed data (v2). */
export async function signOrderIntent<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account,
>(
  client: WalletClient<TTransport, TChain, TAccount>,
  intent: OrderIntent,
  verifyingContract: Address,
): Promise<SignedOrderIntent> {
  const chainId = client.chain?.id ?? 1980
  const signature = await client.signTypedData({
    account: client.account,
    ...getOrderIntentTypedData(intent, verifyingContract, chainId),
  })
  return { intent, signature, signer: client.account.address }
}

/** Sign a trading key authorization using EIP-712 typed data. */
export async function signTradingKeyAuthorization<
  TTransport extends Transport,
  TChain extends Chain,
  TAccount extends Account,
>(
  client: WalletClient<TTransport, TChain, TAccount>,
  auth: TradingKeyAuthorization,
): Promise<Hex> {
  const chainId = client.chain?.id ?? 1980
  return client.signTypedData({
    account: client.account,
    domain: {
      name: 'Diesis Exchange',
      version: '2',
      chainId,
    } as const,
    types: TRADING_KEY_TYPES,
    primaryType: 'TradingKeyAuthorization',
    message: auth,
  })
}

export interface RegisterTradingKeyParameters {
  tradingKey: Address
  validUntil: bigint | number
  maxOrderNotional: bigint
  allowedMarketsMask: Hex
  canWithdraw?: boolean
}

export interface RevokeTradingKeyParameters {
  tradingKey: Address
}

type SettlementWalletClient = Client<Transport, Chain | undefined, Account>

/** Register a settlement trading key for the connected wallet account. */
export function registerTradingKey(
  client: SettlementWalletClient,
  params: RegisterTradingKeyParameters,
): Promise<Hex> {
  return writeContract(client, {
    address: DIESIS_SETTLEMENT,
    abi: IDiesisSettlementAbi,
    account: client.account,
    chain: client.chain,
    functionName: 'registerTradingKey',
    args: [
      params.tradingKey,
      BigInt(params.validUntil),
      params.maxOrderNotional,
      params.allowedMarketsMask,
      params.canWithdraw ?? false,
    ],
  })
}

/** Revoke a settlement trading key for the connected wallet account. */
export function revokeTradingKey(
  client: SettlementWalletClient,
  params: RevokeTradingKeyParameters,
): Promise<Hex> {
  return writeContract(client, {
    address: DIESIS_SETTLEMENT,
    abi: IDiesisSettlementAbi,
    account: client.account,
    chain: client.chain,
    functionName: 'revokeTradingKey',
    args: [params.tradingKey],
  })
}
