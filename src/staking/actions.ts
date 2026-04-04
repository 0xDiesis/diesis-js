import type { Client, Transport, Chain, Account, Address, Hash } from 'viem'
import { readContract, writeContract } from 'viem/actions'
import { DiesisStakingAbi } from '../abi/index.js'
import { DIESIS_STAKING } from '../addresses.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ValidatorInfo {
  status: bigint
  totalStaked: bigint
  authority: Address
  registeredEpoch: bigint
  registeredAt: bigint
  suspendedAt: bigint
  suspendedEpoch: bigint
}

export interface PositionInfo {
  validatorId: bigint
  amount: bigint
  entryEpoch: bigint
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
  /** Get the latest finalized epoch. */
  getLatestFinalizedEpoch: () => Promise<bigint>
  /** Get circulating supply. */
  getCirculatingSupply: () => Promise<bigint>
  /** Look up validator ID by authority address. */
  getValidatorByAddress: (params: { address: Address }) => Promise<bigint>
  /** Check if a validator is a cheater (slashed). */
  isCheater: (params: { validatorId: bigint }) => Promise<boolean>
}

export function stakingReadActions<TTransport extends Transport, TChain extends Chain | undefined>(
  client: Client<TTransport, TChain>,
): StakingReadActions {
  return {
    getValidator: async ({ validatorId }) => {
      const result = await readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'validators',
        args: [validatorId],
      })
      const [status, totalStaked, authority, registeredEpoch, registeredAt, suspendedAt, suspendedEpoch] = result as [bigint, bigint, Address, bigint, bigint, bigint, bigint]
      return { status, totalStaked, authority, registeredEpoch, registeredAt, suspendedAt, suspendedEpoch }
    },

    getPosition: async ({ tokenId }) => {
      const result = await readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'positions',
        args: [tokenId],
      })
      const [validatorId, amount, entryEpoch] = result as [bigint, bigint, bigint]
      return { validatorId, amount, entryEpoch }
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

    getLatestFinalizedEpoch: () =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'latestFinalizedEpoch',
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
        functionName: 'validatorByAddress',
        args: [address],
      }) as Promise<bigint>,

    isCheater: ({ validatorId }) =>
      readContract(client, {
        address: DIESIS_STAKING,
        abi: DiesisStakingAbi,
        functionName: 'isCheater',
        args: [validatorId],
      }) as Promise<boolean>,
  }
}

// ── Write actions ──────────────────────────────────────────────────────────

export type StakingWriteActions = {
  /** Stake native tokens to a validator (via DiesisStaking directly). */
  stake: (params: { validatorId: bigint; amount: bigint }) => Promise<Hash>
  /** Request unstake from a position. */
  requestUnstake: (params: { tokenId: bigint; requestId: bigint; amount: bigint }) => Promise<Hash>
  /** Complete an unstake request after cooldown. */
  completeUnstake: (params: { tokenId: bigint; requestId: bigint }) => Promise<Hash>
  /** Harvest (claim) rewards for a position. */
  harvestRewards: (params: { tokenId: bigint }) => Promise<Hash>
  /** Compound (restake) rewards for a position. */
  compoundRewards: (params: { tokenId: bigint }) => Promise<Hash>
  /** Register a new validator. */
  registerValidator: (params: { pubkey: `0x${string}`; selfStake: bigint }) => Promise<Hash>
  /** Set per-validator commission rate (validator authority only). */
  setValidatorCommission: (params: { validatorId: bigint; rate: bigint }) => Promise<Hash>
  /** Withdraw a validator and release pubkey for reuse. */
  withdrawValidator: (params: { validatorId: bigint }) => Promise<Hash>
}

export function stakingWriteActions<TTransport extends Transport, TChain extends Chain, TAccount extends Account>(
  client: Client<TTransport, TChain, TAccount>,
): StakingWriteActions {
  const write = (functionName: string, args: unknown[], value?: bigint) =>
    writeContract(client, {
      address: DIESIS_STAKING,
      abi: DiesisStakingAbi,
      functionName,
      args,
      ...(value !== undefined ? { value } : {}),
    } as any)

  return {
    stake: ({ validatorId, amount }) => write('stake', [validatorId], amount),
    requestUnstake: ({ tokenId, requestId, amount }) => write('requestUnstake', [tokenId, requestId, amount]),
    completeUnstake: ({ tokenId, requestId }) => write('completeUnstake', [tokenId, requestId]),
    harvestRewards: ({ tokenId }) => write('harvestRewards', [tokenId]),
    compoundRewards: ({ tokenId }) => write('compoundRewards', [tokenId]),
    registerValidator: ({ pubkey, selfStake }) => write('registerValidator', [pubkey], selfStake),
    setValidatorCommission: ({ validatorId, rate }) => write('setValidatorCommission', [validatorId, rate]),
    withdrawValidator: ({ validatorId }) => write('withdrawValidator', [validatorId]),
  }
}
