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

## Gasless Intents

Sign order intents off-chain using EIP-712 typed data, then submit them for gasless execution:

```typescript
import { signOrderIntent } from '@diesis/sdk'

const signedIntent = await walletClient.signOrderIntent({
  marketId: '0x...',
  side: 0,
  price: 50000000000000000000000n,
  amount: 1000000000000000000n,
  orderType: 0, // LimitGTC
  nonce: 1n,
  expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
  reduceOnly: false,
})

// Submit the signed intent
const intentHash = await walletClient.submitIntent({ intent: signedIntent })
```

## Bundles

Prepare and submit transaction bundles with execution flags:

```typescript
import { ExecutionFlags } from '@diesis/sdk'

// Prepare a bundle
const prepared = await publicClient.prepareBundle({
  payment: '0x...',
  bundle: ['0x...signedTx1', '0x...signedTx2'],
  flags: ExecutionFlags.STOP_ON_SUCCESS,
})

// Submit it
const result = await publicClient.submitBundle({
  planHash: prepared.planHash,
  payment: '0x...',
  bundle: ['0x...signedTx1', '0x...signedTx2'],
  flags: ExecutionFlags.STOP_ON_SUCCESS,
})

// Check status
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
addresses.MULTICALL3 // 0xcA11bde05977b3631167028862bE2a173976CA90
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
