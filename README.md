<div align="center">

<img src="https://github.com/0xDiesis/diesis/raw/main/docs/diesis.png" alt="Diesis" width="120">

<pre>
 ___ ___ ___ ___ ___ ___
|   \_ _| __/ __|_ _/ __|
| |) | || _|\__ \| |\__ \
|___/___|___|___/___|___/
 -  -  -  -  -  -  -  -
</pre>

**The TypeScript SDK for Diesis**

Trade on the chain's built-in order books, let a sponsor pay your users' gas,
bundle transactions into one plan, and resolve `.ds` names. It all plugs into
the [viem](https://viem.sh) client you already use.

Chain ID `1980` · Token **DS** · Runtime **viem 2** · Language **TypeScript**

_Greek δίεσις: the smallest interval in music.<br>Diesis aims for the smallest interval between blocks._

</div>

---

## Why this SDK

Diesis builds trading, fee sponsorship, names, staking, and private transfers
into the chain itself. Each of those has its own RPC methods, precompile
addresses, and signing formats. This package wraps them so you call
`publicClient.exchange.getOrderBook()` instead of hand-encoding calldata.

- It extends viem clients with `.extend()`. No new client type to learn.
- Every system contract address and ABI ships as a typed constant.
- Signing helpers use the same EIP-712 field order and domains as the Rust
  node and the [Python SDK](https://github.com/0xDiesis/diesis-py). Both SDKs
  test their addresses and chain data against the same `canonical.json`.
- ABIs are generated from the Solidity sources for viem, wagmi, ethers, and
  web3.js.

## Install

The package is not on the npm registry yet. Install it from GitHub with
authenticated Git access, and pin a commit so builds stay reproducible:

```bash
pnpm add 'git+https://github.com/0xDiesis/diesis-js.git#<commit>' viem
```

The `prepare` script runs `tsc` on install, so the `dist/` output is built for
you.

## Connect

**In short.** You make two clients. One reads from the chain. The other holds
your key and sends transactions. Diesis methods get added to both.

**Details.** `diesisPublicActions` adds exchange, bundle, patronage, privacy,
and node status reads. `diesisWalletActions` adds intent signing, synchronous
sends, and privacy writes. Both work with any viem transport. The `diesis` and
`diesisTestnet` chain objects carry the chain ID, native currency, and default
RPC URLs.

```typescript
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { diesis } from '@diesis/sdk/chains'
import { diesisPublicActions, diesisWalletActions } from '@diesis/sdk'

const publicClient = createPublicClient({
  chain: diesis,
  transport: http(),
}).extend(diesisPublicActions)

const walletClient = createWalletClient({
  account: privateKeyToAccount('0x...'),
  chain: diesis,
  transport: http(),
}).extend(diesisWalletActions)
```

| Network        | Chain ID | Export          |
| -------------- | -------- | --------------- |
| Diesis Mainnet | 1980     | `diesis`        |
| Diesis Testnet | 19803    | `diesisTestnet` |

## Read the exchange

**In short.** Diesis runs its order books inside the chain, like a stock
exchange that every node keeps a copy of. You can list markets, see who wants
to buy and sell at what price, and check your balances.

**Details.** These calls go to the `exchange_*` RPC methods and return typed
results with `bigint` amounts. `estimateFill` walks the current book and
reports what a market order of a given size would get, without placing
anything. A market ID is a hash of the base token, quote token, and market
type, so you can compute it offline with `marketId`.

```typescript
import { marketId, MarketType, Side } from '@diesis/sdk'

const markets = await publicClient.exchange.getMarkets()

const book = await publicClient.exchange.getOrderBook({
  marketId: markets[0].marketId,
  depth: 20,
})

const account = await publicClient.exchange.getAccount({ address: '0x...' })

const estimate = await publicClient.exchange.estimateFill({
  marketId: markets[0].marketId,
  side: Side.Buy,
  amount: 1_000000000000000000n,
})

const id = marketId(baseToken, quoteToken, MarketType.Spot)
```

Other reads on `publicClient.exchange` include `getMarket`, `getTrades`,
`getFundingRates`, `getMarkPrices`, and `getInsuranceFund`.

## Trade without gas

**In short.** You sign an order with your wallet, the same way you'd sign a
login message. A relayer pays the fee and puts it on chain for you. Your
account never needs DS for gas.

**Details.** An order intent is EIP-712 typed data. Its `verifyingContract`
must be the book the order is routed to, `DIESIS_SPOT_BOOK` or
`DIESIS_PERPS_BOOK`. A mismatch fails signature checks on chain.
`submitIntent` sends it to `diesis_submitIntent`, which is the sponsored retail
path. An optional conductor can take a fee, capped by `conductorFeeBps` and
`maxConductorFee`.

```typescript
import { addresses, OrderFlags, OrderType, Side } from '@diesis/sdk'

const signedIntent = await walletClient.signOrderIntent(
  {
    trader: walletClient.account.address,
    marketId: '0x...',
    side: Side.Buy,
    orderType: OrderType.Limit,
    price: 50_000_000000000000000000n,
    amount: 1_000000000000000000n,
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

const intentHash = await walletClient.submitIntent({ intent: signedIntent })
```

`signCancelIntent` and `buildSignedCancelIntent` cover gasless cancels.
`registerTradingKey` lets a hot key sign on behalf of a main account, within an
expiry and a notional cap.

## Trade directly with Exchange Actions V2

**In short.** Professional traders skip the relayer. They send a normal
transaction straight to the order book, and one transaction can hold a batch
of orders.

**Details.** A V2 batch is an ordinary signed EVM transaction to the spot or
perpetual book precompile. It has one sender and one transaction nonce. V2
adds no per-action signatures or action nonces. `atomicity` decides whether one
rejected action fails the whole batch.

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

// Returns `to`, `data`, and a zero `value` for simulation or gas estimation.
const request = prepareExchangeActionsV2Transaction({ book: 'spot', batch })
await publicClient.call({ ...request, account: walletClient.account.address })

// Signs locally, then submits the exact bytes with eth_sendRawTransaction.
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

The precompile returns a 96-byte tuple. Pass the batch's action count to
`decodeExchangeActionsV2Result`. It throws on a zero count, an over-limit
count, or accepted and rejected totals that don't add up, so a bad RPC
response can't pass as a result.

The wire codec and ABI do not prove that a runtime supports every perpetual
action. Check the operation's capability read before offering it to a user.

Session keys let a trading bot act for a main account within limits. Build the
permitted-action bitmap with `exchangeActionScopeV2`, then call
`prepareAuthorizeSessionKeyV2Transaction` or
`prepareRevokeSessionKeyV2Transaction`. A zero spend cap means no cap. A zero
market mask allows no markets, and an all-ones mask allows all of them. Cancel
schedules are regular V2 actions with a bounded market list, an expected
renewal counter, and bounded trigger chunks.

### Add or release position collateral

`getPositionCollateral` returns the current materialized claim and the server's
addable and withdrawable amounts as decimal strings in quote-asset atomic
units. Check `active` and `eligible` before signing; when unavailable, the
amounts are `null` and `unavailableReason` explains why. An older runtime may
reject the RPC method. Do not substitute a local balance estimate for this
read. The bound can change before inclusion, and settlement checks it again.

A positive `collateralDelta` adds collateral from the owner's available global
settlement balance to an existing canonical perpetual position. A negative
value releases it back to that owner's global settlement balance. This is not
an external token deposit or withdrawal, and it does not create an isolated
position or change its size. Zero and values outside signed int256 are rejected.

```typescript
import { parseSignature } from 'viem'
import { DIESIS_PERPS_BOOK } from '@diesis/sdk/addresses'
import {
  computeActionsHash,
  computePerpRelayActionHash,
  encodeExchangeActionBatchV2,
  signPerpActions,
  type SignedPerpRelayEnvelope,
} from '@diesis/sdk/exchange'

const trader = walletClient.account.address
const marketId = '0x...' // canonical perpetual market ID
const availability = await publicClient.exchange.getPositionCollateral({
  user: trader,
  marketId,
})
if (
  !availability.active ||
  !availability.eligible ||
  availability.withdrawableCollateral === null
) {
  throw new Error(
    availability.unavailableReason ?? 'Collateral adjustment unavailable',
  )
}

const collateralDelta = -1_000_000n // release one million quote atomic units
if (-collateralDelta > BigInt(availability.withdrawableCollateral)) {
  throw new Error('Release exceeds the current server-computed bound')
}
const actions = encodeExchangeActionBatchV2({
  atomicity: 'atomicAll',
  actions: [
    {
      kind: 'adjustPositionCollateral',
      clientActionId: '0x000102030405060708090a0b0c0d0e0f',
      marketId,
      collateralDelta,
    },
  ],
})
const nonce = 42n // use a fresh owner nonce for each signed request
const expiry = BigInt(Math.floor(Date.now() / 1000) + 300)
const actionsHash = computeActionsHash(actions)
const rawSignature = await signPerpActions(
  walletClient.account,
  {
    trader,
    nonce,
    expiry,
    actionsHash,
  },
  diesis.id,
  DIESIS_PERPS_BOOK,
)
const { r, s, yParity } = parseSignature(rawSignature)
const signed: SignedPerpRelayEnvelope = {
  trader,
  nonce: `0x${nonce.toString(16)}`,
  expiry: Number(expiry),
  chainId: diesis.id,
  verifyingContract: DIESIS_PERPS_BOOK,
  actionsHash,
  actions,
  signature: { r, s, v: 27 + yParity },
}
const expectedActionHash = computePerpRelayActionHash(signed)
```

Send `signed` unchanged as the sole parameter to `diesis_submitIntent`. Persist
`expectedActionHash` before submission so a lost response can be reconciled;
compare any returned hash and use the relay receipt and action outcome to
determine success. The helper hashes the exact raw envelope, including hex
casing. It accepts string nonces and numeric fields within JavaScript's safe
integer range; other RPC payload forms need their own normalization.

A delegated session key needs the separate
`exchangeActionScopeV2(['adjustPositionCollateral'])` bit (tag 10). Earlier
place/cancel grants do not authorize collateral release. Session market scope
and absolute-amount limits still apply.

## Bundle transactions

**In short.** A bundle is a list of transactions that run in a fixed order as
one plan. Everyone whose transaction is in the list signs off on the whole
plan, and a separate payment covers the builder.

**Details.** The flow has four steps. `prepareBundle` binds the plan and
returns its hash. Each member signs an EIP-712 consent over the plan hash, its
index, and its transaction hash. The payer signs a reservation transaction that
calls `reserveBundle` on the escrow contract. `submitBundle` sends all of it.
`ExecutionFlags` control rollback. The payment transaction stays committed even
when bundled work rolls back.

```typescript
import { keccak256, type Hex } from 'viem'
import {
  ExecutionFlags,
  signMemberConsent,
  type BundlePlan,
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
} satisfies BundlePlan

const prepared = await publicClient.prepareBundle({ plan })
const signature = await signMemberConsent(walletClient.account, {
  planHash: prepared.planHash,
  memberIndex: 0,
  transactionHash: plan.orderedMembers[0].transactionHash,
  chainId: plan.chainId,
})

// Signed transaction that calls reserveBundle for this plan and payment.
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

`planHash`, `encodeReserveBundle`, and `reservationValue` compute the same
values offline if you'd rather not call the node.

## Sponsor gas

**In short.** An app can put DS into a gas grant, and the chain spends it on
fees for that app's users. New users can start before they own any DS.

**Details.** The Patron system contract holds grants and campaigns.
`getGrant` reads a grant's balance, contributions, spend, and pause state. A
campaign owner signs `CampaignVoucherV1` vouchers, and each one authorizes a
single beneficiary to call one target and one function selector, with caps on
transaction count, lifetime spend, and expiry. The `encode*` helpers build
calldata for registering, claiming, and revoking.

```typescript
import {
  campaignIdFor,
  encodeClaimCampaignVoucher,
  signCampaignVoucher,
  type CampaignVoucherV1,
} from '@diesis/sdk/patronage'

const grant = await publicClient.getGrant({ grantId: '0x...' })

const campaignId = campaignIdFor(owner.address, salt)
const voucher = {
  campaignId,
  beneficiary: '0x...',
  target: '0x...',
  selector: '0xa9059cbb',
  maxTransactions: 5,
  maxLifetimeSpend: 10_000_000_000_000_000n,
  expiry: BigInt(Math.floor(Date.now() / 1000) + 86_400),
  nonce: 1n,
} satisfies CampaignVoucherV1
const signature = await signCampaignVoucher(owner, voucher, diesis.id)
const data = encodeClaimCampaignVoucher(voucher, signature)
```

## Stake DS

**In short.** You lock DS with a validator to help secure the chain and earn
rewards. Your stake is a token you hold, and you can claim or restake rewards
whenever you like.

**Details.** Staking actions live on their own subpath and wrap the
`DiesisStaking` system contract. Each position is an ERC-721 token.
Unstaking is a two-step request and complete, with a checkpoint and time
cooldown between them.

```typescript
import { stakingReadActions, stakingWriteActions } from '@diesis/sdk/staking'

const staking = stakingReadActions(publicClient)
const validator = await staking.getValidator({ validatorId: 1n })
const rewards = await staking.getUnclaimedRewards({ tokenId: 42n })

const stakingWrites = stakingWriteActions(walletClient)
await stakingWrites.stake({ validatorId: 1n, amount: 100_000000000000000000n })
await stakingWrites.compoundRewards({ tokenId: 42n })
```

## Resolve `.ds` names

**In short.** `.ds` names work like web addresses for accounts. `alice.ds` is
easier to read and share than `0xd1e5...`.

**Details.** `normalizeDiesisName` lowercases and validates a name.
`diesisNamehash` computes the ENS-style node hash used by the registry and
resolver. Every system contract has a genesis name, such as
`diesis-spot-book.ds`, and those resolve offline with no RPC call.

```typescript
import {
  diesisNamehash,
  normalizeDiesisName,
  resolveGenesisPrecompileName,
} from '@diesis/sdk/names'

normalizeDiesisName('Alice.DS') // 'alice.ds'
diesisNamehash('alice.ds') // '0x82b9...1b17'
resolveGenesisPrecompileName('diesis-spot-book.ds')?.address
```

## Private transfers

**In short.** The shielded pool lets you move tokens without showing who paid
whom. You put funds in, and later take them out, and a zero-knowledge proof
shows the math adds up without revealing the details.

**Details.** `@diesis/sdk/privacy` has note creation, Poseidon hashing, the
Merkle tree, witness building, and Groth16 provers for the Transfer,
Withdrawal, and Association V1 circuits. Proving runs in a Web Worker through
`@diesis/sdk/privacy/worker-runtime`. Reads such as
`publicClient.privacy.getShieldedPoolState()` and
`isShieldedNullifierSpent` come with `diesisPublicActions`. Writes such as
`walletClient.privacy.depositShielded` come with `diesisWalletActions`.

```typescript
import { createNoteV1, deriveCommitmentV1 } from '@diesis/sdk/privacy'

const note = await createNoteV1(ownerPublic)
const commitment = await deriveCommitmentV1(note)

const pool = await publicClient.privacy.getShieldedPoolState()
```

## Check node status

`getRuntimeCapabilities` returns the node's configured and effective execution
modes and witness policy. `getTransactionStatus` returns `status`, numeric
`level`, `advisory` and stage timestamps such as `committedAtMs`; unknown hashes
return only `{ status: 'unknown', level: -1 }`. `getTransactionLifecycle` returns
branch-aware lineage, including orphaned and replaced publication episodes.
These observations do not grant execution authority or establish certified finality.

```typescript
const runtime = await publicClient.getRuntimeCapabilities()
const tx = await publicClient.getTransactionStatus({ hash: evmTransactionHash })
const lineage = await publicClient.getTransactionLifecycle({
  hash: evmTransactionHash,
})
const relay = await publicClient.getExchangeActionStatus({
  actionHash: relayActionHash,
})
```

The interfaces follow node commit `44bed910b4fd18c29e287ecd49a12982a90ac5bb`:
`crates/rpc/src/server/{mod.rs,handler/api.rs,capabilities.rs}`,
`tx_lifecycle.rs` and `exchange_relay.rs`. The nonexistent pipeline-status and
block-witness methods have been removed. RPC `u64` fields are JSON numbers;
values beyond JavaScript's safe integer range need a lossless JSON transport.
Block-number and consensus-round inputs reject values that ordinary JSON
cannot represent exactly.

`walletClient.sendTransactionSync(serializedSignedTransaction)` sends signed
transaction bytes to `diesis_sendRawTransactionSync` and returns the node's
EIP-7966 receipt directly. It does not sign an unsigned object. An EVM transaction
hash, exchange relay action hash, ERC-4337 UserOperation hash and bundle execution
plan hash identify different objects: query the corresponding status surface.

The public `@diesis/sdk/exchange/results` subpath exports V2 result decoding,
ordered outcome commitment hashing, reason codes and outcome types. A decoded
result tuple is a count and commitment, not proof of execution authority.

## Addresses and ABIs

**In short.** Diesis system contracts live at fixed addresses that start with
`0xD1E515`. The SDK has all of them, plus the interface for each one, in a
form that works with viem, wagmi, ethers, or web3.js.

**Details.** `addresses` exports every system contract and precompile
address. `@diesis/sdk/abi` exports typed `as const` ABIs.
`@diesis/sdk/canonical.json` is the same address and chain data as JSON, for
tools that don't run TypeScript.

`diesisContracts` pairs each public system contract with its address and ABI,
so you never copy an address by hand. Spread an entry into viem or wagmi and
the function names, arguments, and return types are all inferred.

```typescript
import { createPublicClient, getContract, http } from 'viem'
import { diesis } from '@diesis/sdk/chains'
import { diesisContracts } from '@diesis/sdk/abi/viem'

const client = createPublicClient({ chain: diesis, transport: http() })
const staking = getContract({ ...diesisContracts.staking, client })
const rewards = await staking.read.unclaimedRewards([42n])
```

Each library's entry point also has generated wrappers for every public
contract, named after the contract.

| Entry point               | Library    | Wrapper                                           |
| ------------------------- | ---------- | ------------------------------------------------- |
| `@diesis/sdk/abi/viem`    | viem 2     | `getDiesisStakingContract(address, client)`       |
| `@diesis/sdk/abi/wagmi`   | wagmi 2, 3 | Hooks such as `useDiesisStakingStake(address)`    |
| `@diesis/sdk/abi/ethers`  | ethers 6   | `connectDiesisStaking(address, runner)`           |
| `@diesis/sdk/abi/ethers5` | ethers 5   | `connectDiesisStaking(address, signerOrProvider)` |
| `@diesis/sdk/abi/web3js`  | web3.js 4  | `createDiesisStaking(web3, address)`              |

Payable functions take a value in every wrapper. The ethers wrappers also
accept the usual overrides, such as `gasLimit` and `nonce`.

```typescript
import { parseEther, Wallet, JsonRpcProvider } from 'ethers'
import { connectDiesisStaking, diesisContracts } from '@diesis/sdk/abi/ethers'

const signer = new Wallet(
  privateKey,
  new JsonRpcProvider('https://rpc.diesis.xyz'),
)
const staking = connectDiesisStaking(diesisContracts.staking.address, signer)

const { bonded } = await staking.nodeLedger(1n)
await staking.stake(1n, { value: parseEther('100') })
```

```typescript
import { parseEther } from 'viem'
import { diesisContracts, useDiesisStakingStake } from '@diesis/sdk/abi/wagmi'

const { write, isPending } = useDiesisStakingStake(
  diesisContracts.staking.address,
)
write({ toValidatorId: 1n }, { value: parseEther('100') })
```

```typescript
import { Web3 } from 'web3'
import { createDiesisStaking, diesisContracts } from '@diesis/sdk/abi/web3js'

const web3 = new Web3('https://rpc.diesis.xyz')
const staking = createDiesisStaking(web3, diesisContracts.staking.address)
const rewards = await staking.methods.unclaimedRewards(42n).call() // bigint
```

ethers, wagmi, and web3 are optional peer dependencies. Install the one you
use.

## Subpath exports

Import only what you need.

| Path                                                 | Contents                                                |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `@diesis/sdk`                                        | The client extensions and the most-used helpers         |
| `@diesis/sdk/chains`                                 | `diesis`, `diesisTestnet`                               |
| `@diesis/sdk/addresses`                              | System contract and precompile addresses                |
| `@diesis/sdk/canonical.json`                         | Chain and address data as JSON                          |
| `@diesis/sdk/names`                                  | `.ds` normalization, namehash, genesis names            |
| `@diesis/sdk/exchange`                               | Exchange reads, V2 actions, session keys                |
| `@diesis/sdk/intents`                                | Order, cancel, and trading key signing                  |
| `@diesis/sdk/bundles`                                | Bundle plans, consent, escrow encoding                  |
| `@diesis/sdk/patronage`                              | Gas grants and campaign vouchers                        |
| `@diesis/sdk/staking`                                | Staking reads and writes                                |
| `@diesis/sdk/privacy`                                | Shielded notes, trees, witnesses, provers               |
| `@diesis/sdk/privacy/worker-runtime`                 | Web Worker entry for proving                            |
| `@diesis/sdk/abi`                                    | Typed ABI constants                                     |
| `@diesis/sdk/abi/{viem,wagmi,ethers,ethers5,web3js}` | ABIs, `diesisContracts`, and typed wrappers per library |

## Develop

```bash
pnpm install
pnpm test          # unit tests
pnpm test:browser  # Playwright privacy tests
pnpm quality       # ABI drift check, lint, typecheck, format
```

`pnpm codegen` regenerates ABIs from the contracts in the
[diesis](https://github.com/0xDiesis/diesis) repo.

## License

MIT
