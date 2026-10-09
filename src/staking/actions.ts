import type {
  Client,
  Transport,
  Chain,
  Account,
  Address,
  Hash,
  WriteContractParameters,
} from 'viem'
import { readContract, writeContract } from 'viem/actions'
import { DiesisStakingAbi } from '../abi/index.js'
import { DIESIS_STAKING } from '../addresses.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ValidatorInfo {
  operator: Address
  marks: bigint
  bonded: bigint
  joinedCheckpoint: bigint
  joinedAt: bigint
  heldAt: bigint
  heldCheckpoint: bigint
}

export interface PositionInfo {
  validatorId: bigint
  amount: bigint
  entryCheckpoint: bigint
}

// ── Read actions ───────────────────────────────────────────────────────────

export type StakingReadActions = {
  /** Get validator info by ID. */
  getValidator: (params: { validatorId: bigint }) => Promise<ValidatorInfo>
  /** Get position info by token ID. */
  getPosition: (params: { tokenId: bigint }) => Promise<PositionInfo>
  /** Get unclaimed rewards for a position. */
  getUnclaimedRewards: (params: { tokenId: bigint }) => Promise<bigint>
  /** Get aggregate active stake. */
  getAggregateActiveStake: () => Promise<bigint>
  /** Get aggregate total stake. */
  getAggregateStake: () => Promise<bigint>
  /** Get the latest finalized checkpoint. */
  getLatestFinalizedCheckpoint: () => Promise<bigint>
  /** Get circulating supply. */
  getCirculatingSupply: () => Promise<bigint>
  /** Look up validator ID by operator address. */
  getValidatorByAddress: (params: { address: Address }) => Promise<bigint>
  /** Check if a validator currently has a slashable fault. */
  isSlashable: (params: { validatorId: bigint }) => Promise<boolean>
}

export function stakingReadActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): StakingReadActions {
  return {
    getValidator: async ({ validatorId }) => {
      const result = await readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'nodeLedger',
        args: [validatorId],
      })
      const [
        operator,
        marks,
        bonded,
        joinedCheckpoint,
        joinedAt,
        heldAt,
        heldCheckpoint,
      ] = result
      return {
        operator,
        marks,
        bonded,
        joinedCheckpoint,
        joinedAt,
        heldAt,
        heldCheckpoint,
      }
    },

    getPosition: async ({ tokenId }) => {
      const result = await readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'stakeLots',
        args: [tokenId],
      })
      const [validatorId, amount, entryCheckpoint] = result as [
        bigint,
        bigint,
        bigint,
      ]
      return { validatorId, amount, entryCheckpoint }
    },

    getUnclaimedRewards: ({ tokenId }) =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'unclaimedRewards',
        args: [tokenId],
      }) as Promise<bigint>,

    getAggregateActiveStake: () =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'aggregateActiveStake',
      }) as Promise<bigint>,

    getAggregateStake: () =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'aggregateStake',
      }) as Promise<bigint>,

    getLatestFinalizedCheckpoint: () =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'latestFinalizedCheckpoint',
      }) as Promise<bigint>,

    getCirculatingSupply: () =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'circulatingSupply',
      }) as Promise<bigint>,

    getValidatorByAddress: ({ address }) =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'nodeIdByOperator',
        args: [address],
      }) as Promise<bigint>,

    isSlashable: ({ validatorId }) =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'isSlashable',
        args: [validatorId],
      }) as unknown as Promise<boolean>,
  }
}

// ── Write actions ──────────────────────────────────────────────────────────

export type StakingWriteActions = {
  /** Stake native tokens to a validator (via DiesisStaking directly). */
  stake: (params: { validatorId: bigint; amount: bigint }) => Promise<Hash>
  /** Request unstake from a position. */
  requestUnstake: (params: {
    tokenId: bigint
    requestId: bigint
    amount: bigint
  }) => Promise<Hash>
  /** Complete an unstake request after cooldown. */
  completeUnstake: (params: {
    tokenId: bigint
    requestId: bigint
  }) => Promise<Hash>
  /** Harvest (claim) rewards for a position. */
  harvestRewards: (params: { tokenId: bigint }) => Promise<Hash>
  /** Compound (restake) rewards for a position. */
  compoundRewards: (params: { tokenId: bigint }) => Promise<Hash>
  /** Register a new validator. */
  registerValidator: (params: {
    pubkey: `0x${string}`
    operatorBond: bigint
  }) => Promise<Hash>
  /** Schedule a per-validator operator reward cut (validator operator only). */
  setOperatorTakeRate: (params: {
    validatorId: bigint
    rate: bigint
  }) => Promise<Hash>
  /** Withdraw a validator and release pubkey for reuse. */
  withdrawValidator: (params: { validatorId: bigint }) => Promise<Hash>
}

export function stakingWriteActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
  TAccount extends Account,
>(client: Client<TTransport, TChain, TAccount>): StakingWriteActions {
  type StakingWriteParameters = WriteContractParameters<
    typeof DiesisStakingAbi,
    keyof StakingWriteActions & string
  >
  const walletClient = client as Client<Transport, Chain | undefined, Account>
  const submit = (parameters: StakingWriteParameters): Promise<Hash> =>
    writeContract(walletClient, parameters)

  return {
    stake: ({ validatorId, amount }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'stake',
        args: [validatorId],
        value: amount,
      }),
    requestUnstake: ({ tokenId, requestId, amount }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'requestUnstake',
        args: [tokenId, requestId, amount],
      }),
    completeUnstake: ({ tokenId, requestId }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'completeUnstake',
        args: [tokenId, requestId],
      }),
    harvestRewards: ({ tokenId }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'harvestRewards',
        args: [tokenId],
      }),
    compoundRewards: ({ tokenId }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'compoundRewards',
        args: [tokenId],
      }),
    registerValidator: ({ pubkey, operatorBond }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'registerValidator',
        args: [pubkey],
        value: operatorBond,
      }),
    setOperatorTakeRate: ({ validatorId, rate }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'setOperatorTakeRate',
        args: [validatorId, rate],
      }),
    withdrawValidator: ({ validatorId }) =>
      submit({
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        account: client.account,
        chain: client.chain,
        functionName: 'withdrawValidator',
        args: [validatorId],
      }),
  }
}
