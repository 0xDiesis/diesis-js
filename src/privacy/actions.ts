import type {
  Account,
  Address,
  Chain,
  Client,
  Hash,
  Hex,
  Transport,
} from 'viem'
import { encodeFunctionData, zeroAddress } from 'viem'
import { readContract, writeContract } from 'viem/actions'
import { DiesisPrivacyPoolsAbi, DiesisShieldedPoolAbi } from '../abi/index.js'
import { PRIVACY_POOLS, SHIELDED_POOL } from '../addresses.js'
import { BN254_SCALAR_R } from './field.js'

const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as Hex

export interface ShieldedPoolState {
  artifactClass: Hex
  denomination: bigint
  depth: bigint
  maxLeaves: bigint
  rootHistorySize: bigint
  currentRootIndex: bigint
  initialized: boolean
  nextIndex: bigint
  outstandingNotes: bigint
  root: Hex
  transferVerifier: Address
  treeInitialized: boolean
  withdrawVerifier: Address
}

export interface PrivacyProvider {
  name: string
  registered: boolean
  associationSetRoot: Hex
}

export interface DepositShieldedV1Parameters {
  commitment: Hex
  encryptedNote: Hex
}

export interface TransactShieldedV1Parameters {
  proof: Hex
  merkleRoot: Hex
  nullifiers: readonly [Hex, Hex]
  commitments: readonly [Hex, Hex]
  activeCount: 1 | 2
  encryptedOutputs: Hex
}

export interface WithdrawShieldedV1Parameters {
  proof: Hex
  merkleRoot: Hex
  nullifier: Hex
  recipient: Address
  relayer?: Address
  fee?: bigint
}

function assertHexBytes(value: Hex, length: number, label: string): void {
  if (
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    (value.length - 2) / 2 !== length
  ) {
    throw new RangeError(`${label} must be exactly ${length} bytes`)
  }
}

function assertActiveField(value: Hex, label: string): void {
  assertHexBytes(value, 32, label)
  const field = BigInt(value)
  if (field === 0n || field >= BN254_SCALAR_R) {
    throw new RangeError(`${label} must be a nonzero canonical field element`)
  }
}

function assertRoot(value: Hex): void {
  assertHexBytes(value, 32, 'Merkle root')
  if (BigInt(value) >= BN254_SCALAR_R) {
    throw new RangeError('Merkle root must be a canonical field element')
  }
}

function validateDeposit(parameters: DepositShieldedV1Parameters): void {
  assertActiveField(parameters.commitment, 'commitment')
  assertHexBytes(parameters.encryptedNote, 169, 'encrypted note')
}

function validateTransfer(parameters: TransactShieldedV1Parameters): void {
  assertHexBytes(parameters.proof, 256, 'Groth16 proof')
  assertRoot(parameters.merkleRoot)
  assertActiveField(parameters.nullifiers[0], 'nullifier 0')
  assertActiveField(parameters.commitments[0], 'commitment 0')
  if (parameters.activeCount === 1) {
    if (
      parameters.nullifiers[1] !== ZERO_BYTES32 ||
      parameters.commitments[1] !== ZERO_BYTES32
    ) {
      throw new Error('inactive transfer slots must be zero')
    }
  } else {
    assertActiveField(parameters.nullifiers[1], 'nullifier 1')
    assertActiveField(parameters.commitments[1], 'commitment 1')
    if (parameters.nullifiers[0] === parameters.nullifiers[1]) {
      throw new Error('active nullifiers must be distinct')
    }
    if (parameters.commitments[0] === parameters.commitments[1]) {
      throw new Error('active commitments must be distinct')
    }
  }
  assertHexBytes(
    parameters.encryptedOutputs,
    parameters.activeCount * 169,
    'encrypted outputs',
  )
}

function normalizedWithdrawal(parameters: WithdrawShieldedV1Parameters) {
  assertHexBytes(parameters.proof, 256, 'Groth16 proof')
  assertRoot(parameters.merkleRoot)
  assertActiveField(parameters.nullifier, 'nullifier')
  if (parameters.recipient === zeroAddress) {
    throw new Error('withdrawal recipient must be nonzero')
  }
  const relayer = parameters.relayer ?? zeroAddress
  const fee = parameters.fee ?? 0n
  if (fee < 0n || fee > 1_000_000_000_000_000_000n) {
    throw new Error('withdrawal fee exceeds denomination')
  }
  if ((fee === 0n) !== (relayer === zeroAddress)) {
    throw new Error('withdrawal relayer and fee are inconsistent')
  }
  return { relayer, fee }
}

export function encodeDepositShieldedV1(
  parameters: DepositShieldedV1Parameters,
): Hex {
  validateDeposit(parameters)
  return encodeFunctionData({
    abi: DiesisShieldedPoolAbi,
    functionName: 'deposit',
    args: [parameters.commitment, parameters.encryptedNote],
  })
}

export function encodeTransactShieldedV1(
  parameters: TransactShieldedV1Parameters,
): Hex {
  validateTransfer(parameters)
  return encodeFunctionData({
    abi: DiesisShieldedPoolAbi,
    functionName: 'transact',
    args: [
      parameters.proof,
      parameters.merkleRoot,
      parameters.nullifiers,
      parameters.commitments,
      parameters.activeCount,
      parameters.encryptedOutputs,
    ],
  })
}

export function encodeWithdrawShieldedV1(
  parameters: WithdrawShieldedV1Parameters,
): Hex {
  const { relayer, fee } = normalizedWithdrawal(parameters)
  return encodeFunctionData({
    abi: DiesisShieldedPoolAbi,
    functionName: 'withdraw',
    args: [
      parameters.proof,
      parameters.merkleRoot,
      parameters.nullifier,
      parameters.recipient,
      relayer,
      fee,
    ],
  })
}

export type PrivacyReadActions = {
  privacy: {
    getShieldedPoolState: () => Promise<ShieldedPoolState>
    getShieldedPoolRoot: () => Promise<Hex>
    isKnownShieldedRoot: (parameters: { root: Hex }) => Promise<boolean>
    isShieldedNullifierSpent: (parameters: {
      nullifier: Hex
    }) => Promise<boolean>
    getShieldedRootHistory: (parameters: { index: bigint }) => Promise<Hex>
    getPrivacyProvider: (parameters: {
      provider: Address
    }) => Promise<PrivacyProvider>
    getPrivacyProviderCount: () => Promise<bigint>
    getPrivacyProviderAddress: (parameters: {
      index: bigint
    }) => Promise<Address>
    getPrivacyPoolsOwner: () => Promise<Address>
    getPrivacyPoolsPendingOwner: () => Promise<Address>
    getPrivacyPoolsVerifier: () => Promise<Address>
    verifyAssociation: (parameters: {
      proof: Hex
      associationSetRoot: Hex
      nullifier: Hex
      provider: Address
    }) => Promise<boolean>
  }
}

export type PrivacyWriteActions = {
  privacy: {
    depositShielded: (
      parameters: DepositShieldedV1Parameters & { value: bigint },
    ) => Promise<Hash>
    transactShielded: (
      parameters: TransactShieldedV1Parameters,
    ) => Promise<Hash>
    withdrawShielded: (
      parameters: WithdrawShieldedV1Parameters,
    ) => Promise<Hash>
    registerPrivacyProvider: (parameters: {
      provider: Address
      name: string
    }) => Promise<Hash>
    updateAssociationSet: (parameters: { newRoot: Hex }) => Promise<Hash>
    transferPrivacyPoolsOwnership: (parameters: {
      newOwner: Address
    }) => Promise<Hash>
    acceptPrivacyPoolsOwnership: () => Promise<Hash>
  }
}

export function privacyReadActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): PrivacyReadActions {
  const read = (parameters: unknown): Promise<unknown> =>
    readContract(client, parameters as never) as Promise<unknown>
  return {
    privacy: {
      getShieldedPoolState: async () => {
        const [
          artifactClass,
          denomination,
          depth,
          maxLeaves,
          rootHistorySize,
          currentRootIndex,
          initialized,
          nextIndex,
          outstandingNotes,
          root,
          transferVerifier,
          treeInitialized,
          withdrawVerifier,
        ] = await Promise.all([
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'artifactClass',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'DENOMINATION',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'DEPTH',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'MAX_LEAVES',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'ROOT_HISTORY_SIZE',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'currentRootIndex',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'initialized',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'nextIndex',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'outstandingNotes',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'root',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'transferVerifier',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'treeInitialized',
          }),
          read({
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'withdrawVerifier',
          }),
        ])
        return {
          artifactClass: artifactClass as Hex,
          denomination: denomination as bigint,
          depth: depth as bigint,
          maxLeaves: maxLeaves as bigint,
          rootHistorySize: rootHistorySize as bigint,
          currentRootIndex: currentRootIndex as bigint,
          initialized: initialized as boolean,
          nextIndex: nextIndex as bigint,
          outstandingNotes: outstandingNotes as bigint,
          root: root as Hex,
          transferVerifier: transferVerifier as Address,
          treeInitialized: treeInitialized as boolean,
          withdrawVerifier: withdrawVerifier as Address,
        }
      },
      getShieldedPoolRoot: () =>
        read({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'root',
        }) as Promise<Hex>,
      isKnownShieldedRoot: ({ root }) =>
        read({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'isKnownRoot',
          args: [root],
        }) as Promise<boolean>,
      isShieldedNullifierSpent: ({ nullifier }) =>
        read({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'nullifiers',
          args: [nullifier],
        }) as Promise<boolean>,
      getShieldedRootHistory: ({ index }) =>
        read({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'rootHistory',
          args: [index],
        }) as Promise<Hex>,
      getPrivacyProvider: async ({ provider }) => {
        const [name, registered, associationSetRoot] = (await read({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'providers',
          args: [provider],
        })) as [string, boolean, Hex]
        return { name, registered, associationSetRoot }
      },
      getPrivacyProviderCount: () =>
        read({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'providerCount',
        }) as Promise<bigint>,
      getPrivacyProviderAddress: ({ index }) =>
        read({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'providerList',
          args: [index],
        }) as Promise<Address>,
      getPrivacyPoolsOwner: () =>
        read({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'owner',
        }) as Promise<Address>,
      getPrivacyPoolsPendingOwner: () =>
        read({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'pendingOwner',
        }) as Promise<Address>,
      getPrivacyPoolsVerifier: () =>
        read({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'associationVerifier',
        }) as Promise<Address>,
      verifyAssociation: ({ proof, associationSetRoot, nullifier, provider }) =>
        read({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'verifyAssociation',
          args: [proof, associationSetRoot, nullifier, provider],
        }) as Promise<boolean>,
    },
  }
}

export function privacyWriteActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
  TAccount extends Account,
>(client: Client<TTransport, TChain, TAccount>): PrivacyWriteActions {
  const walletClient = client as Client<Transport, Chain | undefined, Account>
  const submit = (parameters: unknown): Promise<Hash> =>
    writeContract(walletClient, parameters as never) as Promise<Hash>
  return {
    privacy: {
      depositShielded: (parameters) => {
        validateDeposit(parameters)
        return submit({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'deposit',
          args: [parameters.commitment, parameters.encryptedNote],
          value: parameters.value,
        })
      },
      transactShielded: (parameters) => {
        validateTransfer(parameters)
        return submit({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'transact',
          args: [
            parameters.proof,
            parameters.merkleRoot,
            parameters.nullifiers,
            parameters.commitments,
            parameters.activeCount,
            parameters.encryptedOutputs,
          ],
        })
      },
      withdrawShielded: (parameters) => {
        const { relayer, fee } = normalizedWithdrawal(parameters)
        return submit({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'withdraw',
          args: [
            parameters.proof,
            parameters.merkleRoot,
            parameters.nullifier,
            parameters.recipient,
            relayer,
            fee,
          ],
        })
      },
      registerPrivacyProvider: ({ provider, name }) =>
        submit({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'registerProvider',
          args: [provider, name],
        }),
      updateAssociationSet: ({ newRoot }) =>
        submit({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'updateAssociationSet',
          args: [newRoot],
        }),
      transferPrivacyPoolsOwnership: ({ newOwner }) =>
        submit({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'transferOwnership',
          args: [newOwner],
        }),
      acceptPrivacyPoolsOwnership: () =>
        submit({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'acceptOwnership',
        }),
    },
  }
}
