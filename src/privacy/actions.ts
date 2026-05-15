import type {
  Account,
  Address,
  Chain,
  Client,
  Hash,
  Hex,
  Transport,
} from 'viem'
import { zeroAddress } from 'viem'
import { readContract, writeContract } from 'viem/actions'
import { DiesisPrivacyPoolsAbi, DiesisShieldedPoolAbi } from '../abi/index.js'
import { PRIVACY_POOLS, SHIELDED_POOL } from '../addresses.js'

export interface ShieldedPoolState {
  denomination: bigint
  depth: bigint
  maxLeaves: bigint
  rootHistorySize: bigint
  bootstrapOwner: Address
  currentRootIndex: bigint
  initialized: boolean
  nextIndex: bigint
  root: Hex
  treeInitialized: boolean
  verifier: Address
}

export interface PrivacyProvider {
  name: string
  registered: boolean
  associationSetRoot: Hex
}

export type PrivacyReadActions = {
  privacy: {
    getShieldedPoolState: () => Promise<ShieldedPoolState>
    getShieldedPoolRoot: () => Promise<Hex>
    isKnownShieldedRoot: (params: { root: Hex }) => Promise<boolean>
    isShieldedNullifierSpent: (params: { nullifier: Hex }) => Promise<boolean>
    getShieldedRootHistory: (params: { index: bigint }) => Promise<Hex>
    getPrivacyProvider: (params: {
      provider: Address
    }) => Promise<PrivacyProvider>
    getPrivacyProviderCount: () => Promise<bigint>
    getPrivacyProviderAddress: (params: { index: bigint }) => Promise<Address>
    getPrivacyPoolsOwner: () => Promise<Address>
    getPrivacyPoolsVerifier: () => Promise<Address>
  }
}

export type PrivacyWriteActions = {
  privacy: {
    depositShielded: (params: {
      commitment: Hex
      value: bigint
    }) => Promise<Hash>
    transactShielded: (params: {
      proof: Hex
      merkleRoot: Hex
      nullifiers: Hex[]
      commitments: Hex[]
      extDataHash: Hex
    }) => Promise<Hash>
    withdrawShielded: (params: {
      proof: Hex
      merkleRoot: Hex
      nullifierHash: Hex
      recipient: Address
      amount: bigint
      relayer?: Address
      fee?: bigint
    }) => Promise<Hash>
    registerPrivacyProvider: (params: {
      provider: Address
      name: string
    }) => Promise<Hash>
    updateAssociationSet: (params: { newRoot: Hex }) => Promise<Hash>
    verifyAssociation: (params: {
      proof: Hex
      associationSetRoot: Hex
      nullifier: Hex
      provider: Address
    }) => Promise<Hash>
    transferPrivacyPoolsOwnership: (params: {
      newOwner: Address
    }) => Promise<Hash>
  }
}

export function privacyReadActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): PrivacyReadActions {
  return {
    privacy: {
      getShieldedPoolState: async () => {
        const [
          denomination,
          depth,
          maxLeaves,
          rootHistorySize,
          bootstrapOwner,
          currentRootIndex,
          initialized,
          nextIndex,
          root,
          treeInitialized,
          verifier,
        ] = await Promise.all([
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'DENOMINATION',
          }) as Promise<bigint>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'DEPTH',
          }) as Promise<bigint>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'MAX_LEAVES',
          }) as Promise<bigint>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'ROOT_HISTORY_SIZE',
          }) as Promise<bigint>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'bootstrapOwner',
          }) as Promise<Address>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'currentRootIndex',
          }) as Promise<bigint>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'initialized',
          }) as Promise<boolean>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'nextIndex',
          }) as Promise<bigint>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'root',
          }) as Promise<Hex>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'treeInitialized',
          }) as Promise<boolean>,
          readContract(client, {
            address: SHIELDED_POOL,
            abi: DiesisShieldedPoolAbi,
            functionName: 'verifierAddr',
          }) as Promise<Address>,
        ])
        return {
          denomination,
          depth,
          maxLeaves,
          rootHistorySize,
          bootstrapOwner,
          currentRootIndex,
          initialized,
          nextIndex,
          root,
          treeInitialized,
          verifier,
        }
      },
      getShieldedPoolRoot: () =>
        readContract(client, {
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'root',
        }) as Promise<Hex>,
      isKnownShieldedRoot: ({ root }) =>
        readContract(client, {
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'isKnownRoot',
          args: [root],
        }) as Promise<boolean>,
      isShieldedNullifierSpent: ({ nullifier }) =>
        readContract(client, {
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'nullifiers',
          args: [nullifier],
        }) as Promise<boolean>,
      getShieldedRootHistory: ({ index }) =>
        readContract(client, {
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          functionName: 'rootHistory',
          args: [index],
        }) as Promise<Hex>,
      getPrivacyProvider: async ({ provider }) => {
        const [name, registered, associationSetRoot] = (await readContract(
          client,
          {
            address: PRIVACY_POOLS,
            abi: DiesisPrivacyPoolsAbi,
            functionName: 'providers',
            args: [provider],
          },
        )) as [string, boolean, Hex]
        return { name, registered, associationSetRoot }
      },
      getPrivacyProviderCount: () =>
        readContract(client, {
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'providerCount',
        }) as Promise<bigint>,
      getPrivacyProviderAddress: ({ index }) =>
        readContract(client, {
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'providerList',
          args: [index],
        }) as Promise<Address>,
      getPrivacyPoolsOwner: () =>
        readContract(client, {
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'owner',
        }) as Promise<Address>,
      getPrivacyPoolsVerifier: () =>
        readContract(client, {
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          functionName: 'verifierAddr',
        }) as Promise<Address>,
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
      depositShielded: ({ commitment, value }) =>
        submit({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'deposit',
          args: [commitment],
          value,
        }),
      transactShielded: ({
        proof,
        merkleRoot,
        nullifiers,
        commitments,
        extDataHash,
      }) =>
        submit({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'transact',
          args: [proof, merkleRoot, nullifiers, commitments, extDataHash],
        }),
      withdrawShielded: ({
        proof,
        merkleRoot,
        nullifierHash,
        recipient,
        amount,
        relayer = zeroAddress,
        fee = 0n,
      }) =>
        submit({
          address: SHIELDED_POOL,
          abi: DiesisShieldedPoolAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'withdraw',
          args: [
            proof,
            merkleRoot,
            nullifierHash,
            recipient,
            amount,
            relayer,
            fee,
          ],
        }),
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
      verifyAssociation: ({ proof, associationSetRoot, nullifier, provider }) =>
        submit({
          address: PRIVACY_POOLS,
          abi: DiesisPrivacyPoolsAbi,
          account: client.account,
          chain: client.chain,
          functionName: 'verifyAssociation',
          args: [proof, associationSetRoot, nullifier, provider],
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
    },
  }
}
