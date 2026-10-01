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
  it('exposes only real node finality reads with exact hash parameters', async () => {
    const transport = client()
    const actions = diesisPublicActions(transport as never)
    expect('getPipelineStatus' in actions).toBe(false)
    expect('getBlockWitness' in actions).toBe(false)
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
