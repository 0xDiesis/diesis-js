# @diesis/sdk

TypeScript SDK for the Diesis EVM L1 chain. Extends [viem](https://viem.sh) with Diesis-specific chain definitions, typed custom RPC actions, exchange precompile wrappers, gasless intent signing, and bundle utilities.

## Installation

```bash
npm install @diesis/sdk viem
```

## Quick Start

```typescript
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { diesis } from '@diesis/sdk/chains'
import { diesisPublicActions, diesisWalletActions } from '@diesis/sdk'

// Public client with all Diesis read actions
const publicClient = createPublicClient({
  chain: diesis,
  transport: http(),
}).extend(diesisPublicActions)

// Wallet client with signing and write actions
const account = privateKeyToAccount('0x...')
const walletClient = createWalletClient({
  account,
  chain: diesis,
  transport: http(),
}).extend(diesisWalletActions)
```

## Exchange

Query order books, markets, and trading accounts via typed RPC:

```typescript
// Get all listed markets
const markets = await publicClient.exchange.getMarkets()

// Get order book depth
const book = await publicClient.exchange.getOrderBook({
  marketId: markets[0].marketId,
  depth: 20,
})

// Check trading account balances
const account = await publicClient.exchange.getAccount({
  address: '0x...',
})

// Estimate fill before placing an order
const estimate = await publicClient.exchange.estimateFill({
  marketId: markets[0].marketId,
  side: 0, // Buy
  amount: 1000000000000000000n,
})
```

### Compute a Market ID

```typescript
import { marketId } from '@diesis/sdk'

const id = marketId(baseTokenAddress, quoteTokenAddress, 0) // 0 = Spot
```

### Direct Exchange Action V2 Transactions

Professional order flow uses ordinary signed EVM transactions sent directly to
the spot or perpetual book precompile. The batch has one Ethereum sender and one
Ethereum transaction nonce; V2 does not add per-action signatures or action
nonces.

```typescript
import {
  prepareExchangeActionsV2Transaction,
  sendExchangeActionsV2Transaction,
} from '@diesis/sdk/exchange'

const batch = {
  atomicity: 'atomicAll',
  actions: [
    {
      kind: 'place',
      clientActionId: '0x000102030405060708090a0b0c0d0e0f',
      marketId: '0x...',
      side: 'buy',
      orderKind: 'limit',
      timeInForce: { kind: 'gtc' },
      postOnly: false,
      reduceOnly: false,
      marginType: 'cross',
      priceTicks: 100n,
      quantityLots: 5n,
      maxFills: 2,
      maxPriceLevels: 1,
    },
  ],
} as const

// Deterministic `to`, `data`, and zero value for simulation or estimation.
const request = prepareExchangeActionsV2Transaction({ book: 'spot', batch })
await publicClient.call({ ...request, account: walletClient.account.address })

// Local signing followed by exact eth_sendRawTransaction submission.
const hash = await sendExchangeActionsV2Transaction(walletClient, {
  book: 'spot',
  batch,
  transaction: {
    nonce: 7,
    gas: 500_000n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 1n,
  },
})
```

When decoding the 96-byte precompile return tuple, pass the submitted batch's
action count to `decodeExchangeActionsV2Result`. The decoder rejects zero,
over-limit, or mismatched accepted/rejected totals instead of trusting RPC data.

The perpetual V2 wire is frozen for tooling parity, but execution remains
protocol-gated until the Lane B activation revision. The existing sponsored
`diesis_submitIntent` relay remains the retail/gasless path, not the
professional low-latency path.

Scoped session keys are principal-authorized settlement transactions. Build
their action bitmap with `exchangeActionScopeV2`, then call
`prepareAuthorizeSessionKeyV2Transaction` or
`prepareRevokeSessionKeyV2Transaction`. A zero spend cap is uncapped, a zero
market mask permits no markets, and an all-ones market mask is the explicit
all-markets sentinel. Cancel schedules are regular V2 actions with bounded
market lists, expected renewal counters, and bounded trigger chunks.

## Gasless Intents

Sign order intents off-chain using EIP-712 typed data, then submit them for gasless execution:

```typescript
import { addresses, OrderFlags, OrderType } from '@diesis/sdk'

const signedIntent = await walletClient.signOrderIntent(
  {
    trader: walletClient.account.address,
    marketId: '0x...',
    side: 0,
    orderType: OrderType.Limit,
    price: 50000000000000000000000n,
    amount: 1000000000000000000n,
    triggerPrice: 0n,
    nonce: 1n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    flags: OrderFlags.NONE,
    conductor: '0x0000000000000000000000000000000000000000',
    conductorFeeBps: 0,
    maxConductorFee: 0n,
  },
  addresses.DIESIS_SPOT_BOOK,
)

// Submit the signed intent
const intentHash = await walletClient.submitIntent({ intent: signedIntent })
```

## Bundles

Prepare the canonical plan, collect each member's detached consent, then submit
the signed reservation and member transactions:

```typescript
import { keccak256, type Hex } from 'viem'
import {
  ExecutionFlags,
  signMemberConsent,
  type BundlePlanV2,
  type SubmitBundleMember,
} from '@diesis/sdk'

const rawMemberTransaction = '0x...signedMemberTransaction' as Hex
const plan = {
  chainId: publicClient.chain.id,
  expiry: BigInt(Math.floor(Date.now() / 1000) + 60),
  flags: ExecutionFlags.STOP_ON_SUCCESS,
  payment: {
    payer: walletClient.account.address,
    maximumBuilderPayment: 1_000_000_000_000n,
    refundGasPrice: 1_000_000_000n,
    maximumRefund: 500_000_000_000n,
    escrowNonce: 1n,
  },
  orderedMembers: [
    {
      transactionHash: keccak256(rawMemberTransaction),
      gasAllowance: 250_000,
    },
  ],
} satisfies BundlePlanV2

const prepared = await publicClient.prepareBundle({ plan })
const signature = await signMemberConsent(walletClient.account, {
  planHash: prepared.planHash,
  memberIndex: 0,
  transactionHash: plan.orderedMembers[0].transactionHash,
  chainId: plan.chainId,
})

// Signed transaction that calls reserveBundleV2 for this plan and payment.
const payment = '0x...signedReservationTransaction' as Hex
const members: SubmitBundleMember[] = [
  {
    rawTransaction: rawMemberTransaction,
    consent: {
      planHash: prepared.planHash,
      memberIndex: 0,
      transactionHash: plan.orderedMembers[0].transactionHash,
      signer: walletClient.account.address,
      signature,
    },
  },
]

const result = await publicClient.submitBundle({
  plan,
  planHash: prepared.planHash,
  payment,
  members,
})

const status = await publicClient.getBundleStatus({ planHash: result.planHash })
console.log(status.members, status.includedBlockNumber, status.failure)
```

## Network Status

```typescript
// Pipeline status (consensus, execution, publication heads)
const pipeline = await publicClient.getPipelineStatus()

// Transaction lifecycle status
const txStatus = await publicClient.getTransactionStatus({ hash: '0x...' })
```

## Address Constants

All canonical system contract and precompile addresses are available:

```typescript
import { addresses } from '@diesis/sdk'

addresses.DIESIS_STAKING // 0xD1E5150000000000000000000000000000000001
addresses.DIESIS_SETTLEMENT // 0xD1E5150000000000000000000000000000005E71
addresses.DIESIS_SPOT_BOOK // 0xD1E515000000000000000000000000000000590D
addresses.DIESIS_MARKETS // 0xD1E515000000000000000000000000000000B00C
addresses.WRAPPED_DS // 0xD1E51500000000000000000000000000000000D5
addresses.MULTICALL3 // 0xcA11bde05977b3631167028862bE2a173976CA11
```

## ABIs

Typed ABI constants for contract interactions:

```typescript
import {
  diesisSettlementAbi,
  diesisSpotBookAbi,
  diesisMarketsAbi,
} from '@diesis/sdk/abi'
```

## Sub-path Exports

The SDK supports granular imports:

- `@diesis/sdk` -- everything
- `@diesis/sdk/chains` -- chain definitions only
- `@diesis/sdk/exchange` -- exchange types, actions, and utils
- `@diesis/sdk/intents` -- intent signing helpers
- `@diesis/sdk/bundles` -- bundle utilities
- `@diesis/sdk/patronage` -- patronage/gas sponsorship
- `@diesis/sdk/abi` -- ABI constants

## Chain IDs

| Network        | Chain ID |
| -------------- | -------- |
| Diesis Mainnet | 1980     |
| Diesis Testnet | 19803    |

## License

MIT
