import { describe, expect, it, vi } from 'vitest'
import { diesisPublicActions } from '../src/actions/public.js'
import type { TransactionStatus } from '../src/actions/public.js'
import { diesisWalletActions } from '../src/actions/wallet.js'
const hash = `0x${'11'.repeat(32)}` as const
function client() {
  return {
    request: vi.fn(async (request: unknown) => {
      void request
      return { status: 'unknown', level: -1 }
    }),
  }
}
describe('node 44bed public and wallet wire contracts', () => {
  it('exposes actual node observation reads with exact hash parameters', async () => {
    const transport = client()
    const actions = diesisPublicActions(transport as never)
    await actions.getRuntimeCapabilities()
    await actions.getTransactionStatus({ hash })
    await actions.getTransactionLifecycle({ hash })
    await actions.getExchangeActionStatus({ actionHash: hash })
    await actions.getBlockMetadata({ blockNumber: 12n })
    await actions.getConsensusCommitStatus({ round: 13n })
    await expect(
      actions.getBlockMetadata({ blockNumber: 1n << 64n }),
    ).rejects.toThrow('safely')
    expect(transport.request.mock.calls.map(([request]) => request)).toEqual([
      { method: 'diesis_getRuntimeCapabilities', params: [] },
      { method: 'diesis_getTransactionStatus', params: [hash] },
      { method: 'diesis_getTransactionLifecycle', params: [hash] },
      { method: 'diesis_getExchangeActionStatus', params: [hash] },
      { method: 'diesis_getBlockMetadata', params: [12] },
      { method: 'diesis_getConsensusCommitStatus', params: [13] },
    ])
  })
  it('sync send accepts serialized signed bytes and returns the receipt directly', async () => {
    const transport = client()
    const receipt = { transactionHash: hash, status: 1 }
    transport.request.mockResolvedValue(receipt as never)
    const actions = diesisWalletActions(transport as never)
    await expect(actions.sendTransactionSync('0x02abcd')).resolves.toEqual(
      receipt,
    )
    expect(transport.request).toHaveBeenCalledWith({
      method: 'diesis_sendRawTransactionSync',
      params: ['0x02abcd'],
    })
    await expect(
      actions.sendTransactionSync({ to: hash } as never),
    ).rejects.toThrow()
  })
  it('preserves a committed observation that this node did not submit', async () => {
    const status: TransactionStatus = {
      status: 'committed',
      level: 2,
      advisory: false,
      submittedAtMs: null,
      preconfirmedAtMs: null,
      committedAtMs: 10,
      executedAtMs: null,
      publicationStatus: null,
      publishedAtMs: null,
      consensusRound: 1,
      blockNumber: null,
      publicationError: null,
      estimatedExecutionMs: null,
    }
    const transport = client()
    transport.request.mockResolvedValue(status as never)
    await expect(
      diesisPublicActions(transport as never).getTransactionStatus({ hash }),
    ).resolves.toEqual(status)
  })
  it('rejects unsafe or non-bigint parameters as promises before transport', async () => {
    const transport = client(),
      actions = diesisPublicActions(transport as never)
    for (const blockNumber of [
      -1n,
      9007199254740992n,
      1.5 as never,
      NaN as never,
    ])
      await expect(actions.getBlockMetadata({ blockNumber })).rejects.toThrow(
        'safely',
      )
    expect(transport.request).not.toHaveBeenCalled()
    await actions.getBlockMetadata({ blockNumber: 9007199254740991n })
    expect(transport.request).toHaveBeenCalledWith({
      method: 'diesis_getBlockMetadata',
      params: [9007199254740991],
    })
  })
})

// Source: node 44bed pipeline_status.rs and witness.rs, registered in node/run.rs.
describe('pipeline and witness node wire contracts', () => {
  it('returns all eight camelCase pipeline fields as JSON numbers and mode', async () => {
    const transport = client()
    const status = {
      consensusHead: 18,
      executionHead: 16,
      publicationHead: 15,
      executionLag: 2,
      publicationLag: 1,
      orderedQueueDepth: 2,
      executedQueueDepth: 1,
      backpressureMode: 'throttle' as const,
    }
    transport.request.mockResolvedValue(status as never)
    await expect(
      diesisPublicActions(transport as never).getPipelineStatus(),
    ).resolves.toEqual(status)
    expect(transport.request).toHaveBeenCalledWith({
      method: 'diesis_getPipelineStatus',
      params: [],
    })
  })
  it('returns hex witness bytes or null, without constructing a witness DTO', async () => {
    const transport = client()
    const actions = diesisPublicActions(transport as never)
    transport.request
      .mockResolvedValueOnce('0x00aabb' as never)
      .mockResolvedValueOnce(null as never)
    await expect(actions.getBlockWitness({ blockHash: hash })).resolves.toBe(
      '0x00aabb',
    )
    await expect(
      actions.getBlockWitness({ blockHash: hash }),
    ).resolves.toBeNull()
    expect(transport.request).toHaveBeenCalledWith({
      method: 'diesis_getBlockWitness',
      params: [hash],
    })
  })
  it('rejects malformed B256 inputs before transport', async () => {
    const transport = client()
    for (const blockHash of ['0x12', hash + '00', '0x' + 'zz'.repeat(32), null])
      await expect(
        diesisPublicActions(transport as never).getBlockWitness({
          blockHash: blockHash as never,
        }),
      ).rejects.toThrow('B256')
    expect(transport.request).not.toHaveBeenCalled()
  })
})
it('rejects unsafe pipeline numbers, invented modes and witness objects', async () => {
  const transport = client(),
    actions = diesisPublicActions(transport as never)
  const status = {
    consensusHead: 18,
    executionHead: 16,
    publicationHead: 15,
    executionLag: 2,
    publicationLag: 1,
    orderedQueueDepth: 2,
    executedQueueDepth: 1,
    backpressureMode: 'healthy',
  }
  for (const invalid of [
    { ...status, consensusHead: Number.MAX_SAFE_INTEGER + 1 },
    { ...status, orderedQueueDepth: -1 },
    { ...status, backpressureMode: 'paused' },
  ]) {
    transport.request.mockResolvedValueOnce(invalid as never)
    await expect(actions.getPipelineStatus()).rejects.toThrow()
  }
  for (const invalid of [
    { blockHash: hash, witness: '0x00' },
    '0x123',
    undefined,
  ]) {
    transport.request.mockResolvedValueOnce(invalid as never)
    await expect(actions.getBlockWitness({ blockHash: hash })).rejects.toThrow(
      'bytes',
    )
  }
})
