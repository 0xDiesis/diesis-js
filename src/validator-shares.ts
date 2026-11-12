import type { Address, Chain, Client, Hex, Transport } from 'viem'
import { DIESIS_POSITION } from './addresses.js'

/** Select one native validator and optionally an exact canonical historical state. */
export interface ValidatorShareBindingParams {
  validatorId: bigint
  blockHash?: Hex
}

/** Core's verified runtime association; observation alone does not admit a write. */
export interface ValidatorShareBinding {
  readVersion: 1
  anchor: {
    chainId: string
    blockNumber: number
    blockHash: Hex
    stateRoot: Hex
    timestamp: string
  }
  binding: {
    status: 'unbound' | 'verified' | 'unsupportedRuntime' | 'invalidBinding'
    positionAddress: Address
    positionCodeHash: Hex
    positionOwner: Address | null
    shareAddress: Address | null
    shareCodeHash: Hex | null
    supportedArtifact: 'validatorShareV1' | null
    semantics: 'oneTimeOwnerBinding'
  }
  validator: {
    id: string
    registration: 'registered' | 'retired' | 'unknown'
    operator: Address | null
    marks: string | null
    inactive: boolean | null
  }
}

export interface ValidatorShareReadActions {
  getValidatorShareBinding: (
    params: ValidatorShareBindingParams,
  ) => Promise<ValidatorShareBinding>
}

function invalid(): never {
  throw new Error('Invalid validator-share binding observation')
}

function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid()
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return invalid()
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) return invalid()
  }
  return value as Record<string, unknown>
}

function hex(value: unknown, bytes: number, nonzero = false): Hex {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value) ||
    (nonzero && BigInt(value) === 0n)
  )
    return invalid()
  return value as Hex
}

function decimal(value: unknown, bits: number, nonzero = false): string {
  if (
    typeof value !== 'string' ||
    value.length > 78 ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  )
    return invalid()
  const number = BigInt(value)
  if (number >= 1n << BigInt(bits) || (nonzero && number === 0n))
    return invalid()
  return value
}

/** Validate and scope a producer response without coercing integers to JavaScript numbers. */
export function decodeValidatorShareBinding(
  value: unknown,
  query: ValidatorShareBindingParams,
  expectedChainId?: number,
): ValidatorShareBinding {
  const response = object(value, [
    'readVersion',
    'anchor',
    'binding',
    'validator',
  ])
  if (response.readVersion !== 1) return invalid()
  const anchor = object(response.anchor, [
    'chainId',
    'blockNumber',
    'blockHash',
    'stateRoot',
    'timestamp',
  ])
  decimal(anchor.chainId, 64)
  decimal(anchor.timestamp, 64)
  if (
    typeof anchor.blockNumber !== 'number' ||
    !Number.isSafeInteger(anchor.blockNumber) ||
    anchor.blockNumber < 0
  )
    return invalid()
  hex(anchor.blockHash, 32, true)
  hex(anchor.stateRoot, 32)
  if (
    query.blockHash &&
    String(anchor.blockHash).toLowerCase() !== query.blockHash.toLowerCase()
  )
    return invalid()
  if (
    expectedChainId !== undefined &&
    (!Number.isSafeInteger(expectedChainId) ||
      String(expectedChainId) !== anchor.chainId)
  )
    return invalid()
  const binding = object(response.binding, [
    'status',
    'positionAddress',
    'positionCodeHash',
    'positionOwner',
    'shareAddress',
    'shareCodeHash',
    'supportedArtifact',
    'semantics',
  ])
  if (
    hex(binding.positionAddress, 20).toLowerCase() !==
      DIESIS_POSITION.toLowerCase() ||
    binding.semantics !== 'oneTimeOwnerBinding'
  )
    return invalid()
  hex(binding.positionCodeHash, 32)
  if (binding.positionOwner !== null) hex(binding.positionOwner, 20)
  if (binding.shareAddress !== null) hex(binding.shareAddress, 20, true)
  if (binding.shareCodeHash !== null) hex(binding.shareCodeHash, 32)
  if ((binding.shareAddress === null) !== (binding.shareCodeHash === null))
    return invalid()
  switch (binding.status) {
    case 'verified':
      if (
        binding.positionOwner === null ||
        binding.shareAddress === null ||
        binding.shareCodeHash === null ||
        binding.supportedArtifact !== 'validatorShareV1'
      )
        return invalid()
      break
    case 'unbound':
      if (
        binding.positionOwner === null ||
        binding.shareAddress !== null ||
        binding.shareCodeHash !== null ||
        binding.supportedArtifact !== null
      )
        return invalid()
      break
    case 'unsupportedRuntime':
      if (
        binding.positionOwner !== null ||
        binding.shareAddress !== null ||
        binding.shareCodeHash !== null ||
        binding.supportedArtifact !== null
      )
        return invalid()
      break
    case 'invalidBinding':
      if (binding.positionOwner === null || binding.supportedArtifact !== null)
        return invalid()
      break
    default:
      return invalid()
  }
  const validator = object(response.validator, [
    'id',
    'registration',
    'operator',
    'marks',
    'inactive',
  ])
  if (decimal(validator.id, 32, true) !== query.validatorId.toString())
    return invalid()
  if (validator.registration === 'unknown') {
    if (
      validator.operator !== null ||
      validator.marks !== null ||
      validator.inactive !== null
    )
      return invalid()
  } else if (
    validator.registration === 'registered' ||
    validator.registration === 'retired'
  ) {
    hex(validator.operator, 20, true)
    const marks = BigInt(decimal(validator.marks, 16))
    // _NODE_ACTIVE is zero; uptime/score probation alone does not mean inactive.
    if (
      typeof validator.inactive !== 'boolean' ||
      validator.inactive !== ((marks & 0x1c1n) !== 0n)
    )
      return invalid()
  } else return invalid()
  return value as ValidatorShareBinding
}

/** Read through Core's fixed method; no caller-selected share target or latest fallback. */
export function validatorShareReadActions<
  TTransport extends Transport,
  TChain extends Chain | undefined,
>(client: Client<TTransport, TChain>): ValidatorShareReadActions {
  return {
    getValidatorShareBinding: async (params) => {
      if (
        !params ||
        typeof params !== 'object' ||
        Reflect.ownKeys(params).some(
          (key) => key !== 'validatorId' && key !== 'blockHash',
        ) ||
        typeof params.validatorId !== 'bigint' ||
        params.validatorId < 1n ||
        params.validatorId >= 1n << 32n
      )
        throw new Error('Validator ID must be a nonzero uint32 bigint')
      const query: ValidatorShareBindingParams = {
        validatorId: params.validatorId,
        ...(params.blockHash !== undefined
          ? { blockHash: params.blockHash }
          : {}),
      }
      if (query.blockHash !== undefined) hex(query.blockHash, 32, true)
      const chainId = client.chain?.id
      const response: unknown = await client.request({
        method: 'diesis_getValidatorShareBinding' as never,
        params: [
          {
            validatorId: query.validatorId.toString(),
            ...(query.blockHash !== undefined
              ? { blockHash: query.blockHash }
              : {}),
          },
        ],
      } as never)
      return decodeValidatorShareBinding(response, query, chainId)
    },
  }
}
