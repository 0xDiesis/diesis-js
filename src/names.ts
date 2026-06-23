import { namehash, type Address } from 'viem'
import * as addresses from './addresses.js'

export const nameServiceContracts = {
  registry: addresses.DIESIS_NAME_REGISTRY,
  registrar: addresses.DIESIS_BASE_REGISTRAR,
  resolver: addresses.DIESIS_PUBLIC_RESOLVER,
  reverseRegistrar: addresses.DIESIS_REVERSE_REGISTRAR,
  verifier: addresses.DIESIS_NAME_VERIFIER,
  policy: addresses.DIESIS_NAME_POLICY,
} as const satisfies Record<string, Address>

export interface NameServiceRecordType {
  id:
    | 'address'
    | 'text'
    | 'contenthash'
    | 'route'
    | 'payment'
    | 'agent'
    | 'attestation'
  name: string
  description: string
}

export const nameServiceRecordTypes: NameServiceRecordType[] = [
  {
    id: 'address',
    name: 'Address',
    description: 'Primary chain address and coin-specific address records.',
  },
  {
    id: 'text',
    name: 'Text',
    description: 'Profile, project, URL, and service metadata.',
  },
  {
    id: 'contenthash',
    name: 'Content Hash',
    description: 'Decentralized content pointer for a name.',
  },
  {
    id: 'route',
    name: 'Route',
    description: 'Typed service routes for apps and agent endpoints.',
  },
  {
    id: 'payment',
    name: 'Payment Route',
    description: 'Named payment instructions for wallets and protocols.',
  },
  {
    id: 'agent',
    name: 'Agent',
    description: 'AI agent identity and capability records.',
  },
  {
    id: 'attestation',
    name: 'Attestation',
    description:
      'Signed identity, project, auditor, validator, and agent claims.',
  },
]

export interface GenesisPrecompileName {
  key: string
  name: `${string}.ds`
  group: string
  address: Address
}

export const genesisPrecompileNames = [
  {
    key: 'secp256r1',
    name: 'secp256r1.ds',
    group: 'standard-precompile',
    address: addresses.SECP256R1,
  },
  {
    key: 'poseidon',
    name: 'poseidon.ds',
    group: 'standard-precompile',
    address: addresses.POSEIDON,
  },
  {
    key: 'ml-dsa',
    name: 'ml-dsa.ds',
    group: 'standard-precompile',
    address: addresses.ML_DSA,
  },
  {
    key: 'diesis-staking',
    name: 'diesis-staking.ds',
    group: 'staking',
    address: addresses.DIESIS_STAKING,
  },
  {
    key: 'diesis-patron',
    name: 'diesis-patron.ds',
    group: 'patronage',
    address: addresses.DIESIS_PATRON,
  },
  {
    key: 'diesis-config',
    name: 'diesis-config.ds',
    group: 'config',
    address: addresses.DIESIS_CONFIG,
  },
  {
    key: 'diesis-bootstrap-oracle',
    name: 'diesis-bootstrap-oracle.ds',
    group: 'bridge',
    address: addresses.BOOTSTRAP_ORACLE,
  },
  {
    key: 'diesis-bootstrap-config',
    name: 'diesis-bootstrap-config.ds',
    group: 'bridge',
    address: addresses.BOOTSTRAP_CONFIG,
  },
  {
    key: 'diesis-state-writer',
    name: 'diesis-state-writer.ds',
    group: 'config',
    address: addresses.DIESIS_STATE_WRITER,
  },
  {
    key: 'diesis-position',
    name: 'diesis-position.ds',
    group: 'staking',
    address: addresses.DIESIS_POSITION,
  },
  {
    key: 'diesis-test-usd',
    name: 'diesis-test-usd.ds',
    group: 'token',
    address: addresses.DIESIS_TEST_USD,
  },
  {
    key: 'diesis-name-registry',
    name: 'diesis-name-registry.ds',
    group: 'names',
    address: addresses.DIESIS_NAME_REGISTRY,
  },
  {
    key: 'diesis-base-registrar',
    name: 'diesis-base-registrar.ds',
    group: 'names',
    address: addresses.DIESIS_BASE_REGISTRAR,
  },
  {
    key: 'diesis-public-resolver',
    name: 'diesis-public-resolver.ds',
    group: 'names',
    address: addresses.DIESIS_PUBLIC_RESOLVER,
  },
  {
    key: 'diesis-reverse-registrar',
    name: 'diesis-reverse-registrar.ds',
    group: 'names',
    address: addresses.DIESIS_REVERSE_REGISTRAR,
  },
  {
    key: 'diesis-name-verifier',
    name: 'diesis-name-verifier.ds',
    group: 'names',
    address: addresses.DIESIS_NAME_VERIFIER,
  },
  {
    key: 'diesis-name-policy',
    name: 'diesis-name-policy.ds',
    group: 'names',
    address: addresses.DIESIS_NAME_POLICY,
  },
  {
    key: 'wrapped-ds',
    name: 'wrapped-ds.ds',
    group: 'token',
    address: addresses.WRAPPED_DS,
  },
  {
    key: 'liquid-staked-ds',
    name: 'liquid-staked-ds.ds',
    group: 'token',
    address: addresses.LIQUID_STAKED_DS,
  },
  {
    key: 'diesis-vrf',
    name: 'diesis-vrf.ds',
    group: 'randomness',
    address: addresses.VRF,
  },
  {
    key: 'diesis-stealth-announcer',
    name: 'diesis-stealth-announcer.ds',
    group: 'privacy',
    address: addresses.STEALTH_ANNOUNCER,
  },
  {
    key: 'diesis-stealth-registry',
    name: 'diesis-stealth-registry.ds',
    group: 'privacy',
    address: addresses.STEALTH_REGISTRY,
  },
  {
    key: 'diesis-groth16-verifier',
    name: 'diesis-groth16-verifier.ds',
    group: 'privacy',
    address: addresses.GROTH16_VERIFIER,
  },
  {
    key: 'diesis-shielded-pool',
    name: 'diesis-shielded-pool.ds',
    group: 'privacy',
    address: addresses.SHIELDED_POOL,
  },
  {
    key: 'diesis-privacy-pools',
    name: 'diesis-privacy-pools.ds',
    group: 'privacy',
    address: addresses.PRIVACY_POOLS,
  },
  {
    key: 'diesis-markets',
    name: 'diesis-markets.ds',
    group: 'exchange',
    address: addresses.DIESIS_MARKETS,
  },
  {
    key: 'diesis-spot-book',
    name: 'diesis-spot-book.ds',
    group: 'exchange',
    address: addresses.DIESIS_SPOT_BOOK,
  },
  {
    key: 'diesis-perps-book',
    name: 'diesis-perps-book.ds',
    group: 'exchange',
    address: addresses.DIESIS_PERPS_BOOK,
  },
  {
    key: 'diesis-margin',
    name: 'diesis-margin.ds',
    group: 'exchange',
    address: addresses.DIESIS_MARGIN,
  },
  {
    key: 'diesis-settlement',
    name: 'diesis-settlement.ds',
    group: 'exchange',
    address: addresses.DIESIS_SETTLEMENT,
  },
  {
    key: 'diesis-conductors',
    name: 'diesis-conductors.ds',
    group: 'consensus',
    address: addresses.DIESIS_CONDUCTORS,
  },
  {
    key: 'diesis-issuance-auction',
    name: 'diesis-issuance-auction.ds',
    group: 'economics',
    address: addresses.DIESIS_ISSUANCE_AUCTION,
  },
  {
    key: 'diesis-buyback-burn',
    name: 'diesis-buyback-burn.ds',
    group: 'economics',
    address: addresses.DIESIS_BUYBACK_BURN,
  },
  {
    key: 'diesis-operator-bond',
    name: 'diesis-operator-bond.ds',
    group: 'economics',
    address: addresses.DIESIS_OPERATOR_BOND,
  },
  {
    key: 'diesis-erc20-factory',
    name: 'diesis-erc20-factory.ds',
    group: 'token',
    address: addresses.DIESIS_ERC20_FACTORY,
  },
  {
    key: 'diesis-perp-deploy',
    name: 'diesis-perp-deploy.ds',
    group: 'exchange',
    address: addresses.DIESIS_PERP_DEPLOY,
  },
  {
    key: 'multicall3',
    name: 'multicall3.ds',
    group: 'ecosystem',
    address: addresses.MULTICALL3,
  },
  {
    key: 'permit2',
    name: 'permit2.ds',
    group: 'ecosystem',
    address: addresses.PERMIT2,
  },
] as const satisfies readonly GenesisPrecompileName[]

const genesisPrecompileByName = new Map<string, GenesisPrecompileName>(
  genesisPrecompileNames.map((entry) => [entry.name, entry]),
)

const genesisPrecompileByAddress = new Map<string, GenesisPrecompileName>(
  genesisPrecompileNames.map((entry) => [entry.address.toLowerCase(), entry]),
)

const DIESIS_NAME_SUFFIX = '.ds'
const MIN_REGISTRAR_LABEL_LENGTH = 3
const MAX_LABEL_LENGTH = 63
const MAX_NAME_LENGTH = 255

function assertValidDiesisLabel(
  label: string,
  isRegistrarLabel: boolean,
): void {
  if (
    label.length === 0 ||
    label.length > MAX_LABEL_LENGTH ||
    (isRegistrarLabel && label.length < MIN_REGISTRAR_LABEL_LENGTH) ||
    label.startsWith('-') ||
    label.endsWith('-') ||
    !/^[a-z0-9-]+$/.test(label)
  ) {
    throw new Error('Invalid .ds name')
  }
}

export function normalizeDiesisName(input: string): string {
  const trimmed = input.trim().toLowerCase()
  const normalized = trimmed.endsWith(DIESIS_NAME_SUFFIX)
    ? trimmed
    : `${trimmed}${DIESIS_NAME_SUFFIX}`

  if (normalized.length > MAX_NAME_LENGTH) {
    throw new Error('Invalid .ds name')
  }

  const nameWithoutSuffix = normalized.slice(0, -DIESIS_NAME_SUFFIX.length)
  const labels = nameWithoutSuffix.split('.')
  const registrarLabelIndex = labels.length - 1

  labels.forEach((label, index) => {
    assertValidDiesisLabel(label, index === registrarLabelIndex)
  })

  return normalized
}

export function resolveGenesisPrecompileName(
  input: string,
): GenesisPrecompileName | undefined {
  return genesisPrecompileByName.get(normalizeDiesisName(input))
}

export function reverseResolveGenesisPrecompile(
  address: string,
): GenesisPrecompileName | undefined {
  return genesisPrecompileByAddress.get(address.toLowerCase())
}

export function diesisNamehash(input: string): `0x${string}` {
  return namehash(normalizeDiesisName(input))
}
