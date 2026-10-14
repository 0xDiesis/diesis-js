import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { IDiesisNameRegistryAbi, DiesisPublicResolverAbi } from './abi/index.js'
import {
  diesisNamehash,
  nameServiceContracts,
  normalizeDiesisName,
} from './names.js'

/** The adapter must obey signal, byte limit and no-redirect/no-fallback policy before buffering. */
export interface NativeNamesRpc {
  identity(): string | Promise<string>
  request(query: {
    method: string
    params: readonly unknown[]
    signal: AbortSignal
    maxResponseBytes: number
  }): Promise<unknown>
}
export interface NativeNameReadOptions {
  chainId: 1980 | 19803
  expectedGenesisHash?: Hex
  expectedRpcIdentity?: string
  timeoutMs?: number
  maxResponseBytes?: number
  signal?: AbortSignal
  current?: () => boolean
}
export interface NativeNameObservationV1 {
  version: 1
  kind: 'native-name-observation'
  name: string
  node: Hex
  chainId: 'ethereum:1980' | 'ethereum:19803'
  network: { genesisHash: Hex; rpcIdentity: string }
  anchor: { blockNumber: string; blockHash: Hex; timestamp: string }
  contracts: { registry: Address; canonicalResolver: Address }
  owner: Address
  resolver: Address
  expiry: string
  ownershipEpoch: string
  status: 'active' | 'expired' | 'not-registered'
  recipient:
    | { status: 'resolved'; address: Address }
    | { status: 'no-resolver' | 'unsupported-resolver' | 'not-set' }
  verification: 'rpc-observation'
}
export class NativeNamesReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NativeNamesReadError'
  }
}
const zero = `0x${'0'.repeat(40)}`
const fail = (message = 'Native name read unavailable'): never => {
  throw new NativeNamesReadError(message)
}
function assertJson(value: unknown, depth = 0): void {
  if (depth > 64) return fail('Malformed native name reply')
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return
  if (
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value))
  )
    return fail('Malformed native name reply')
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return fail()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!('value' in descriptor)) return fail('Malformed native name reply')
    assertJson(descriptor.value, depth + 1)
  }
}
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return fail()
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !('value' in descriptor)) return fail()
  return descriptor.value
}
function hash(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[\da-f]{64}$/i.test(value))
    return fail()
  return value.toLowerCase() as Hex
}
function quantity(value: unknown, bits = 64): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][\da-f]*)$/i.test(value))
    return fail()
  const result = BigInt(value)
  if (result >= 1n << BigInt(bits)) return fail()
  return result
}
function address(value: unknown): Address {
  if (typeof value !== 'string' || !/^0x[\da-f]{40}$/i.test(value))
    return fail()
  return value.toLowerCase() as Address
}
function uint(value: unknown, bits: number): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits))
    return fail()
  return value
}
function header(value: unknown) {
  return {
    blockNumber: quantity(own(value, 'number')).toString(),
    blockHash: hash(own(value, 'hash')),
    timestamp: quantity(own(value, 'timestamp')).toString(),
  }
}
/** Read-only canonical observation. This does not establish finality or grant send authority. */
export async function readNativeName(
  rpc: NativeNamesRpc,
  options: NativeNameReadOptions,
  input: string,
): Promise<NativeNameObservationV1> {
  if (
    typeof input !== 'string' ||
    !input.trim().toLowerCase().endsWith('.ds') ||
    /[^\x20-\x7e]/.test(input)
  )
    return fail('Enter an explicit ASCII .ds name')
  const name = normalizeDiesisName(input)
  if (name.length > 253) return fail('Native name exceeds 253 characters')
  const node = diesisNamehash(name)
  if (options.chainId !== 1980 && options.chainId !== 19803)
    return fail('Unsupported native network')
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxResponseBytes = options.maxResponseBytes ?? 262_144
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 15_000 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 262_144
  )
    return fail('Invalid read bounds')
  if (options.expectedGenesisHash !== undefined)
    hash(options.expectedGenesisHash)
  if (
    options.expectedRpcIdentity !== undefined &&
    (!options.expectedRpcIdentity || options.expectedRpcIdentity.length > 128)
  )
    return fail('Invalid expected RPC identity')
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const check = () => {
    if (timedOut) return fail('Native name read deadline exceeded')
    if (
      options.signal?.aborted ||
      controller.signal.aborted ||
      options.current?.() === false
    )
      return fail('Native name read retired')
  }
  let rejectDeadline: (reason: Error) => void = () => {}
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject
  })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    rejectDeadline(
      new NativeNamesReadError('Native name read deadline exceeded'),
    )
  }, timeoutMs)
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () =>
        reject(
          new NativeNamesReadError(
            timedOut
              ? 'Native name read deadline exceeded'
              : 'Native name read retired',
          ),
        ),
      { once: true },
    )
  })
  void deadline.catch(() => {})
  void cancelled.catch(() => {})
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    check()
    const value = await Promise.race([
      Promise.resolve().then(operation),
      deadline,
      cancelled,
    ])
    check()
    return value
  }
  const request = async (method: string, params: readonly unknown[]) => {
    const value = await bounded(() =>
      rpc.request({
        method,
        params,
        signal: controller.signal,
        maxResponseBytes,
      }),
    )
    // A second limit protects custom adapters after decoding. Transport must bound bytes before buffering.
    assertJson(value)
    const serialized = JSON.stringify(value)
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > maxResponseBytes
    )
      return fail('Native name response limit exceeded')
    return value
  }
  const identity = async () => {
    const value = await bounded(async () => rpc.identity())
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))
      return fail('Invalid RPC identity')
    return value
  }
  try {
    check()
    const rpcIdentity = await identity()
    if (
      options.expectedRpcIdentity !== undefined &&
      rpcIdentity !== options.expectedRpcIdentity
    )
      return fail('RPC identity mismatch')
    const chain = async () => {
      if (
        quantity(await request('eth_chainId', []), 256) !==
        BigInt(options.chainId)
      )
        return fail('Native network mismatch')
    }
    await chain()
    const genesis = header(
      await request('eth_getBlockByNumber', ['0x0', false]),
    )
    if (
      genesis.blockNumber !== '0' ||
      (options.expectedGenesisHash !== undefined &&
        genesis.blockHash !== options.expectedGenesisHash.toLowerCase())
    )
      return fail('Genesis mismatch')
    const anchor = header(
      await request('eth_getBlockByNumber', ['latest', false]),
    )
    const selector = { blockHash: anchor.blockHash, requireCanonical: true }
    const registry = nameServiceContracts.registry.toLowerCase() as Address
    const canonicalResolver =
      nameServiceContracts.resolver.toLowerCase() as Address
    const requireCode = async (target: Address) => {
      const code = await request('eth_getCode', [target, selector])
      if (typeof code !== 'string' || !/^0x(?:[\da-f]{2})+$/i.test(code))
        return fail('Native name contract bytecode unavailable')
    }
    const read = async (
      target: Address,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
    ) => {
      const data = encodeFunctionData({ abi, functionName, args })
      const raw = await request('eth_call', [{ to: target, data }, selector])
      // All selected getters return one static word; reject extra/truncated words.
      if (typeof raw !== 'string' || !/^0x[\da-f]{64}$/i.test(raw))
        return fail('Malformed native name contract reply')
      if (
        ['owner', 'resolver', 'registry', 'addr'].includes(functionName) &&
        !/^0x0{24}/i.test(raw)
      )
        return fail('Malformed native name address padding')
      return decodeFunctionResult({ abi, functionName, data: raw as Hex })
    }
    await requireCode(registry)
    const ownerValue = address(
      await read(registry, IDiesisNameRegistryAbi, 'owner', [node]),
    )
    const resolverValue = address(
      await read(registry, IDiesisNameRegistryAbi, 'resolver', [node]),
    )
    const expiry = uint(
      await read(registry, IDiesisNameRegistryAbi, 'expiry', [node]),
      64,
    )
    const ownershipEpoch = uint(
      await read(registry, IDiesisNameRegistryAbi, 'ownershipEpoch', [node]),
      256,
    )
    const owner = ownerValue === zero ? null : ownerValue
    const resolver = resolverValue === zero ? null : resolverValue
    const status =
      owner === null
        ? 'not-registered'
        : expiry !== 0n && BigInt(anchor.timestamp) > expiry
          ? 'expired'
          : 'active'
    let recipient: NativeNameObservationV1['recipient'] = {
      status:
        resolver === null
          ? 'no-resolver'
          : resolver !== canonicalResolver
            ? 'unsupported-resolver'
            : 'not-set',
    }
    if (owner !== null) {
      if (resolver === null) recipient = { status: 'no-resolver' }
      else if (resolver !== canonicalResolver)
        recipient = { status: 'unsupported-resolver' }
      else {
        await requireCode(canonicalResolver)
        if (
          address(
            await read(
              canonicalResolver,
              DiesisPublicResolverAbi,
              'registry',
              [],
            ),
          ) !== registry
        )
          return fail('Resolver registry mismatch')
        const resolved = address(
          await read(canonicalResolver, DiesisPublicResolverAbi, 'addr', [
            node,
          ]),
        )
        recipient =
          resolved === zero
            ? { status: 'not-set' }
            : { status: 'resolved', address: resolved }
      }
    }
    const confirmed = header(
      await request('eth_getBlockByNumber', [
        `0x${BigInt(anchor.blockNumber).toString(16)}`,
        false,
      ]),
    )
    if (
      confirmed.blockNumber !== anchor.blockNumber ||
      confirmed.blockHash !== anchor.blockHash ||
      confirmed.timestamp !== anchor.timestamp
    )
      return fail('Native name anchor changed')
    const genesisConfirmed = header(
      await request('eth_getBlockByNumber', ['0x0', false]),
    )
    if (
      genesisConfirmed.blockHash !== genesis.blockHash ||
      genesisConfirmed.blockNumber !== '0' ||
      genesisConfirmed.timestamp !== genesis.timestamp
    )
      return fail('Genesis changed')
    await chain()
    if ((await identity()) !== rpcIdentity) return fail('RPC identity changed')
    check()
    return {
      version: 1,
      kind: 'native-name-observation',
      name,
      node,
      chainId: `ethereum:${options.chainId}`,
      network: { genesisHash: genesis.blockHash, rpcIdentity },
      anchor,
      contracts: { registry, canonicalResolver },
      owner: ownerValue,
      resolver: resolverValue,
      expiry: expiry.toString(),
      ownershipEpoch: ownershipEpoch.toString(),
      status,
      recipient,
      verification: 'rpc-observation',
    }
  } catch (error) {
    check()
    if (error instanceof NativeNamesReadError) throw error
    throw new NativeNamesReadError('Native name read unavailable', {
      cause: error,
    })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
