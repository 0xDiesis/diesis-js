import { describe, expect, it } from 'vitest'
import { decodeFunctionData, encodeAbiParameters } from 'viem'
import {
  IDiesisNameRegistryAbi,
  DiesisPublicResolverAbi,
} from '../src/abi/index.js'
import { readNativeName, type NativeNamesRpc } from '../src/names-read.js'
import { nameServiceContracts } from '../src/names.js'
const hash = `0x${'ab'.repeat(32)}`
const genesis = `0x${'cd'.repeat(32)}`
const owner = `0x${'11'.repeat(20)}`
const recipient = `0x${'22'.repeat(20)}`
const zero = `0x${'00'.repeat(20)}`
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { method: string; params: readonly unknown[] }[] = []
  let headers = 0
  const rpc: NativeNamesRpc = {
    identity: () => 'configured-rpc-v1',
    async request(query) {
      calls.push(query)
      if (query.method === 'eth_chainId') return '0x7bc'
      if (query.method === 'eth_getBlockByNumber') {
        if (query.params[0] === '0x0')
          return { number: '0x0', hash: genesis, timestamp: '0x0' }
        headers++
        return {
          number: '0xa',
          hash: overrides.reorg && headers > 1 ? genesis : hash,
          timestamp: '0x64',
        }
      }
      expect(query.params[1]).toEqual({
        blockHash: hash,
        requireCanonical: true,
      })
      if (query.method === 'eth_getCode') return overrides.code ?? '0x01'
      const tx = query.params[0] as { to: string; data: `0x${string}` }
      const abi =
        tx.to === nameServiceContracts.registry.toLowerCase()
          ? IDiesisNameRegistryAbi
          : DiesisPublicResolverAbi
      const { functionName } = decodeFunctionData({ abi, data: tx.data })
      const values: Record<string, unknown> = {
        owner,
        resolver: nameServiceContracts.resolver,
        ttl: 5n,
        expiry: 100n,
        ownershipEpoch: 7n,
        registry: nameServiceContracts.registry,
        addr: recipient,
        ...overrides,
      }
      return encodeAbiParameters(
        [
          {
            type: ['owner', 'resolver', 'registry', 'addr'].includes(
              functionName,
            )
              ? 'address'
              : 'uint256',
          },
        ],
        [values[functionName] as never],
      )
    },
  }
  return { rpc, calls }
}
describe('portable anchored native Names reader', () => {
  it('separates owner and recipient at expiry equality and checks canonical code and registry', async () => {
    const { rpc, calls } = fixture()
    const result = await readNativeName(
      rpc,
      {
        chainId: 1980,
        expectedGenesisHash: genesis,
        expectedRpcIdentity: 'configured-rpc-v1',
      },
      'Alice.ds',
    )
    expect(result).toMatchObject({
      version: 1,
      kind: 'native-name-observation',
      name: 'alice.ds',
      chainId: 'ethereum:1980',
      owner,
      expiry: '100',
      ownershipEpoch: '7',
      status: 'active',
      recipient: { status: 'resolved', address: recipient },
      verification: 'rpc-observation',
    })
    expect(result.anchor).toEqual({
      blockNumber: '10',
      blockHash: hash,
      timestamp: '100',
    })
    expect(calls.filter((c) => c.method === 'eth_call')).toHaveLength(6)
  })
  it.each([
    ['expiry', 99n, 'expired'],
    ['owner', zero, 'not-registered'],
  ])(
    'classifies %s without treating a stored address as authorization',
    async (field, value, status) => {
      const { rpc } = fixture({ [field]: value })
      expect(
        (await readNativeName(rpc, { chainId: 1980 }, 'alice.ds')).status,
      ).toBe(status)
    },
  )
  it.each([
    ['resolver', zero, 'no-resolver'],
    ['resolver', recipient, 'unsupported-resolver'],
    ['addr', zero, 'not-set'],
  ])('returns recipient status for %s', async (field, value, status) => {
    const { rpc } = fixture({ [field]: value })
    expect(
      (await readNativeName(rpc, { chainId: 1980 }, 'alice.ds')).recipient
        .status,
    ).toBe(status)
  })
  it.each([{ reorg: true }, { registry: recipient }, { code: '0x' }])(
    'rejects unavailable or changed canonical evidence %j',
    async (overrides) => {
      await expect(
        readNativeName(fixture(overrides).rpc, { chainId: 1980 }, 'alice.ds'),
      ).rejects.toThrow()
    },
  )
  it('rejects network, genesis and RPC identity mismatch', async () => {
    await expect(
      readNativeName(fixture().rpc, { chainId: 19803 }, 'alice.ds'),
    ).rejects.toThrow()
    await expect(
      readNativeName(
        fixture().rpc,
        { chainId: 1980, expectedGenesisHash: hash },
        'alice.ds',
      ),
    ).rejects.toThrow()
    await expect(
      readNativeName(
        fixture().rpc,
        { chainId: 1980, expectedRpcIdentity: 'other' },
        'alice.ds',
      ),
    ).rejects.toThrow()
  })
  it.each(['alice.eth', 'alice.xyz', 'alice', 'alïce.ds'])(
    'refuses suffix guessing and Unicode %s',
    async (name) => {
      const { rpc, calls } = fixture()
      await expect(
        readNativeName(rpc, { chainId: 1980 }, name),
      ).rejects.toThrow()
      expect(calls).toHaveLength(0)
    },
  )
  it('retires requests and enforces a deadline without a fallback', async () => {
    const { rpc } = fixture()
    await expect(
      readNativeName(rpc, { chainId: 1980, current: () => false }, 'alice.ds'),
    ).rejects.toThrow(/retired/)
    rpc.request = () => new Promise(() => {})
    await expect(
      readNativeName(rpc, { chainId: 1980, timeoutMs: 5 }, 'alice.ds'),
    ).rejects.toThrow(/deadline/)
  })
})

describe('reader refusal boundaries', () => {
  it('rejects unsupported canonical selectors without retrying latest', async () => {
    const { rpc, calls } = fixture()
    const original = rpc.request
    rpc.request = async (query) => {
      if (query.method === 'eth_call')
        throw new Error('unsupported canonical selector')
      return original(query)
    }
    await expect(
      readNativeName(rpc, { chainId: 1980 }, 'alice.ds'),
    ).rejects.toThrow()
    expect(
      calls.filter(
        (call) =>
          call.method === 'eth_getBlockByNumber' && call.params[0] === 'latest',
      ),
    ).toHaveLength(1)
  })
  it('rejects changed timestamp, changing RPC revision and retired replies', async () => {
    const { rpc } = fixture()
    const original = rpc.request
    let numbered = 0
    rpc.request = async (query) => {
      const result = await original(query)
      if (query.method === 'eth_getBlockByNumber' && query.params[0] === '0xa')
        return { ...(result as object), timestamp: '0x65' }
      return result
    }
    await expect(
      readNativeName(rpc, { chainId: 1980 }, 'alice.ds'),
    ).rejects.toThrow(/anchor/)
    rpc.request = original
    rpc.identity = () => (++numbered === 1 ? 'v1' : 'v2')
    await expect(
      readNativeName(rpc, { chainId: 1980 }, 'alice.ds'),
    ).rejects.toThrow(/identity changed/)
    rpc.identity = () => 'v1'
    let active = true
    rpc.request = async (query) => {
      const result = await original(query)
      if (query.method === 'eth_call') active = false
      return result
    }
    await expect(
      readNativeName(rpc, { chainId: 1980, current: () => active }, 'alice.ds'),
    ).rejects.toThrow(/retired/)
  })
  it('rejects malformed quantities, oversized replies, getters and dirty ABI address padding', async () => {
    for (const value of ['0x07bc', '0x' + 'f'.repeat(80)]) {
      const { rpc } = fixture()
      const original = rpc.request
      rpc.request = (query) =>
        query.method === 'eth_chainId'
          ? Promise.resolve(value)
          : original(query)
      await expect(
        readNativeName(rpc, { chainId: 1980 }, 'alice.ds'),
      ).rejects.toThrow()
    }
    const { rpc } = fixture()
    await expect(
      readNativeName(rpc, { chainId: 1980, maxResponseBytes: 16 }, 'alice.ds'),
    ).rejects.toThrow(/limit/)
    let invoked = false
    const original = rpc.request
    rpc.request = async (query) =>
      query.method === 'eth_getBlockByNumber'
        ? {
            get number() {
              invoked = true
              return '0x0'
            },
            hash: genesis,
            timestamp: '0x0',
          }
        : original(query)
    await expect(
      readNativeName(rpc, { chainId: 1980 }, 'alice.ds'),
    ).rejects.toThrow()
    expect(invoked).toBe(false)
    let callCount = 0
    rpc.request = async (query) =>
      query.method === 'eth_call' && ++callCount === 1
        ? '0x' + 'ff'.repeat(32)
        : original(query)
    await expect(
      readNativeName(rpc, { chainId: 1980 }, 'alice.ds'),
    ).rejects.toThrow()
  })
  it('stops promptly when the external signal aborts during a stalled RPC', async () => {
    const { rpc } = fixture()
    rpc.request = () => new Promise(() => {})
    const controller = new AbortController()
    const pending = readNativeName(
      rpc,
      { chainId: 1980, signal: controller.signal },
      'alice.ds',
    )
    controller.abort()
    await expect(pending).rejects.toThrow(/retired/)
  })
})
