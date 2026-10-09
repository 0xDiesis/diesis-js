import { readFile } from 'node:fs/promises'

import {
  bytesToHex,
  createWalletClient,
  hexToBytes,
  custom,
  keccak256,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import type { CancelReplaceAction } from '../src/exchange/actions-v2.js'

import {
  computeExchangeResultHash,
  decodeExchangeActionBatch,
  decodeExchangeActionsResult,
  encodeExchangeActionBatch,
  exchangeActionBatchAdmissionWork,
  EXCHANGE_ACTION_LIMITS,
  prepareExchangeActionsTransaction,
  sendExchangeActionsTransaction,
  signExchangeActionsTransaction,
  type ActionOutcome,
  type ExchangeActionBatch,
  type PlaceAction,
  armCancelSchedule,
  disarmCancelSchedule,
  renewCancelSchedule,
  triggerCancelSchedule,
} from '../src/exchange/index.js'

type Vector = {
  name: string
  encoded_hex: string
  abi?: { calldata_hex: string }
  result?: {
    outcomes: Array<{
      action_index: number
      action_tag: number
      accepted: boolean
      reason_code: number
      result_id_or_context_hex: string
    }>
    result_hash_hex: string
    accepted_count: number
    rejected_count: number
    encoded_return_hex: string
  }
}

const vectors = JSON.parse(
  await readFile(
    new URL('./fixtures/exchange-actions-v2.json', import.meta.url),
    'utf8',
  ),
) as Vector[]

const vector = (name: string): Vector => {
  const value = vectors.find((candidate) => candidate.name === name)
  if (value === undefined) throw new Error(`missing vector ${name}`)
  return value
}
const hex = (value: string): Hex => `0x${value.replace(/^0x/, '')}`
const repeated = (byte: number, length: number): Hex =>
  hex(byte.toString(16).padStart(2, '0').repeat(length))
const resultTuple = (accepted: number, rejected: number): Hex =>
  hex(
    `${'00'.repeat(32)}${accepted.toString(16).padStart(64, '0')}${rejected
      .toString(16)
      .padStart(64, '0')}`,
  )

const place = (clientByte = 1): PlaceAction => ({
  kind: 'place',
  clientActionId: repeated(clientByte, 16),
  marketId: repeated(0x11, 32),
  side: 'buy',
  orderKind: 'limit',
  timeInForce: { kind: 'gtc' },
  postOnly: false,
  reduceOnly: false,
  pricingVersion: 0,
  marginType: 'cross',
  priceTicks: 100n,
  quantityLots: 5n,
  maxFills: 2,
  maxPriceLevels: 1,
})

const canonicalBatches = (): Readonly<Record<string, ExchangeActionBatch>> => {
  const atomicPlace: PlaceAction = {
    ...place(),
    clientActionId: hex('000102030405060708090a0b0c0d0e0f'),
  }
  const marketIoc: PlaceAction = {
    ...place(2),
    orderKind: 'market',
    timeInForce: { kind: 'ioc' },
    priceTicks: 0n,
  }
  const scheduleId = repeated(0x31, 32)

  return {
    atomic_spot_gtc_limit: {
      atomicity: 'atomicAll',
      actions: [atomicPlace],
    },
    continue_mixed_ordering: {
      atomicity: 'continueOnReject',
      actions: [
        place(),
        marketIoc,
        {
          kind: 'cancelByOrderId',
          clientActionId: repeated(3, 16),
          marketId: repeated(0x11, 32),
          orderId: repeated(0x21, 32),
        },
        {
          kind: 'cancelByClientOrderId',
          clientActionId: repeated(4, 16),
          marketId: repeated(0x11, 32),
          clientOrderId: repeated(0x22, 32),
        },
        {
          kind: 'cancelReplace',
          clientActionId: repeated(5, 16),
          marketId: repeated(0x11, 32),
          cancelTarget: 'clientOrderId',
          targetId: repeated(0x23, 32),
          replacementSide: 'sell',
          replacementOrderKind: 'limit',
          replacementTimeInForce: { kind: 'gtc' },
          replacementPostOnly: false,
          replacementReduceOnly: false,
          replacementPricingVersion: 0,
          replacementMarginType: 'cross',
          replacementPriceTicks: 101n,
          replacementQuantityLots: 3n,
          maxFills: 2,
          maxPriceLevels: 1,
          newClientOrderId: repeated(0x24, 32),
        },
      ],
    },
    spot_post_only: {
      atomicity: 'atomicAll',
      actions: [{ ...place(), postOnly: true, maxFills: 0, maxPriceLevels: 0 }],
    },
    spot_fok: {
      atomicity: 'atomicAll',
      actions: [{ ...place(), timeInForce: { kind: 'fok' } }],
    },
    spot_gtd_with_client_order_id: {
      atomicity: 'atomicAll',
      actions: [
        {
          ...place(),
          timeInForce: { kind: 'gtd', expiry: 999n },
          clientOrderId: repeated(0x44, 32),
        },
      ],
    },
    perpetual_reduce_only_margin: {
      atomicity: 'atomicAll',
      actions: [
        {
          ...place(),
          reduceOnly: true,
          marginType: 'unified',
          marginContribution: 0x1234n,
        },
      ],
    },
    maximum_schedule_tail_and_operations: {
      atomicity: 'atomicAll',
      actions: [
        armCancelSchedule({
          clientActionId: repeated(1, 16),
          scheduleId,
          authorizationExpiry: 4_000n,
          cancellationDeadline: 3_000n,
          expectedRenewalCounter: 0n,
          maxOrdersPerTrigger: 4,
          marketIds: Array.from({ length: 16 }, (_, index) =>
            repeated(index + 1, 32),
          ),
        }),
        renewCancelSchedule({
          clientActionId: repeated(2, 16),
          scheduleId,
          expectedRenewalCounter: 1n,
          newDeadline: 3_500n,
        }),
        disarmCancelSchedule({
          clientActionId: repeated(3, 16),
          scheduleId,
          expectedRenewalCounter: 2n,
        }),
        triggerCancelSchedule({
          clientActionId: repeated(4, 16),
          scheduleId,
        }),
      ],
    },
    cancel_market_chunk: {
      atomicity: 'atomicAll',
      actions: [
        {
          kind: 'cancelMarketChunk',
          clientActionId: repeated(1, 16),
          marketId: repeated(0x11, 32),
          maxOrders: 7,
        },
      ],
    },
  }
}

describe('canonical exchange action V2 wire', () => {
  it('matches and decodes every Task 5 JSON vector byte-for-byte', () => {
    for (const [name, batch] of Object.entries(canonicalBatches())) {
      const encoded = encodeExchangeActionBatch(batch)
      expect(encoded, name).toBe(hex(vector(name).encoded_hex))
      expect(decodeExchangeActionBatch(encoded), name).toEqual(batch)
    }
  })

  it('builds the exact Solidity ABI calldata and ordinary EIP-1559 transaction', async () => {
    const batch = canonicalBatches().atomic_spot_gtc_limit!
    const prepared = prepareExchangeActionsTransaction({
      book: 'spot',
      batch,
    })
    expect(prepared.data).toBe(
      '0xd47b704f000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a444584132020000000001000001000098000102030405060708090a0b0c0d0e0f11111111111111111111111111111111111111111111111111111111111111110000000000000000000000000000006400000000000000050000000000000000000200010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    )
    expect(prepared).toMatchObject({
      to: '0xd1e515000000000000000000000000000000590d',
      value: 0n,
    })

    const account = privateKeyToAccount(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    )
    const raw = await signExchangeActionsTransaction(account, {
      book: 'spot',
      batch,
      transaction: {
        type: 'eip1559',
        chainId: 1980,
        nonce: 7,
        gas: 500_000n,
        maxFeePerGas: 100n,
        maxPriorityFeePerGas: 1n,
      },
    })
    expect(raw).toBe(
      '0x02f9016b8207bc0701648307a12094d1e515000000000000000000000000000000590d80b90104d47b704f000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a444584132020000000001000001000098000102030405060708090a0b0c0d0e0f11111111111111111111111111111111111111111111111111111111111111110000000000000000000000000000006400000000000000050000000000000000000200010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c001a055ef7bad7428e90a02127a28fffd7009f46d19595e0acccb958509feb9063bdea034a1381f9fa2d729450dc7a6bab350ec020804e009ad9810d1c83d42173ee9ac',
    )
    expect(keccak256(raw)).toBe(
      '0x8b5f921196737c558c5f0e11067d7f3e66370a8a986dcdfc64825c7704b159ba',
    )

    const requests: Array<{ method: string; params?: unknown }> = []
    const client = createWalletClient({
      account,
      chain: {
        id: 1980,
        name: 'Diesis',
        nativeCurrency: { name: 'Diesis', symbol: 'DS', decimals: 18 },
        rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
      },
      transport: custom({
        request: async (request) => {
          requests.push(request)
          if (request.method === 'diesis_sendRawTransaction') {
            return '0x8b5f921196737c558c5f0e11067d7f3e66370a8a986dcdfc64825c7704b159ba'
          }
          throw new Error(`unexpected RPC ${request.method}`)
        },
      }),
    })
    await expect(
      sendExchangeActionsTransaction(client, {
        book: 'spot',
        batch,
        transaction: {
          nonce: 7,
          gas: 500_000n,
          maxFeePerGas: 100n,
          maxPriorityFeePerGas: 1n,
        },
      }),
    ).resolves.toBe(
      '0x8b5f921196737c558c5f0e11067d7f3e66370a8a986dcdfc64825c7704b159ba',
    )
    expect(requests).toEqual([
      { method: 'diesis_sendRawTransaction', params: [raw] },
    ])
  })

  it('falls back to eth_sendRawTransaction when the gated method is unavailable', async () => {
    const batch = canonicalBatches().atomic_spot_gtc_limit!
    const account = privateKeyToAccount(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    )
    const raw = await signExchangeActionsTransaction(account, {
      book: 'spot',
      batch,
      transaction: {
        type: 'eip1559',
        chainId: 1980,
        nonce: 7,
        gas: 500_000n,
        maxFeePerGas: 100n,
        maxPriorityFeePerGas: 1n,
      },
    })
    const requests: Array<{ method: string; params?: unknown }> = []
    const hash =
      '0x8b5f921196737c558c5f0e11067d7f3e66370a8a986dcdfc64825c7704b159ba'
    const client = createWalletClient({
      account,
      chain: {
        id: 1980,
        name: 'Diesis',
        nativeCurrency: { name: 'Diesis', symbol: 'DS', decimals: 18 },
        rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
      },
      transport: custom({
        request: async (request) => {
          requests.push(request)
          if (request.method === 'diesis_sendRawTransaction') {
            throw Object.assign(new Error('Method not found'), { code: -32601 })
          }
          if (request.method === 'eth_sendRawTransaction') return hash
          throw new Error(`unexpected RPC ${request.method}`)
        },
      }),
    })

    await expect(
      sendExchangeActionsTransaction(client, {
        book: 'spot',
        batch,
        transaction: {
          nonce: 7,
          gas: 500_000n,
          maxFeePerGas: 100n,
          maxPriorityFeePerGas: 1n,
        },
      }),
    ).resolves.toBe(hash)
    expect(requests).toEqual([
      { method: 'diesis_sendRawTransaction', params: [raw] },
      { method: 'eth_sendRawTransaction', params: [raw] },
    ])
  })

  it('does not fall back when the gated method fails for another reason', async () => {
    const batch = canonicalBatches().atomic_spot_gtc_limit!
    const account = privateKeyToAccount(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    )
    const requests: Array<{ method: string; params?: unknown }> = []
    const client = createWalletClient({
      account,
      chain: {
        id: 1980,
        name: 'Diesis',
        nativeCurrency: { name: 'Diesis', symbol: 'DS', decimals: 18 },
        rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
      },
      transport: custom({
        request: async (request) => {
          requests.push(request)
          throw Object.assign(new Error('admission rejected'), { code: -32000 })
        },
      }),
    })

    await expect(
      sendExchangeActionsTransaction(client, {
        book: 'spot',
        batch,
        transaction: {
          nonce: 7,
          gas: 500_000n,
          maxFeePerGas: 100n,
          maxPriorityFeePerGas: 1n,
        },
      }),
    ).rejects.toThrow('admission rejected')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.method).toBe('diesis_sendRawTransaction')
  })

  it('matches the frozen ordered outcome commitment and ABI return bytes', () => {
    const frozen = vector('continue_mixed_ordering')
    const expected = frozen.result!
    const outcomes: ActionOutcome[] = expected.outcomes.map((outcome) =>
      outcome.accepted
        ? {
            accepted: true,
            actionIndex: outcome.action_index,
            actionTag: outcome.action_tag,
            resultId: hex(outcome.result_id_or_context_hex),
          }
        : {
            accepted: false,
            actionIndex: outcome.action_index,
            actionTag: outcome.action_tag,
            reasonCode: outcome.reason_code,
            context: hex(outcome.result_id_or_context_hex),
          },
    )
    expect(computeExchangeResultHash(hex(frozen.encoded_hex), outcomes)).toBe(
      hex(expected.result_hash_hex),
    )
    expect(
      decodeExchangeActionsResult(
        hex(expected.encoded_return_hex),
        outcomes.length,
      ),
    ).toEqual({
      resultHash: hex(expected.result_hash_hex),
      acceptedCount: expected.accepted_count,
      rejectedCount: expected.rejected_count,
    })

    expect(() =>
      computeExchangeResultHash(hex(frozen.encoded_hex), outcomes.slice(0, 1)),
    ).toThrow(/outcome count/)
    expect(() =>
      computeExchangeResultHash(hex(frozen.encoded_hex), [
        { ...outcomes[0]!, accepted: 'false' } as never,
        ...outcomes.slice(1),
      ]),
    ).toThrow(/accepted must be a boolean/)
    expect(() =>
      computeExchangeResultHash(hex(frozen.encoded_hex), [
        outcomes[0]!,
        {
          accepted: false,
          actionIndex: 1,
          actionTag: 1,
          reasonCode: 0x15,
          context: repeated(1, 32),
        },
        ...outcomes.slice(2),
      ]),
    ).toThrow(/reason code/)

    expect(() => decodeExchangeActionsResult(resultTuple(0, 0), 1)).toThrow(
      /result count mismatch/,
    )
    expect(() => decodeExchangeActionsResult(resultTuple(33, 0), 32)).toThrow(
      /more than 32 actions/,
    )
    expect(() => decodeExchangeActionsResult(resultTuple(1, 1), 1)).toThrow(
      /result count mismatch/,
    )
    expect(() => decodeExchangeActionsResult(resultTuple(1, 0), 0)).toThrow(
      /expected action count.*between 1 and 32/,
    )
    expect(() =>
      decodeExchangeActionsResult(
        hex(`${'00'.repeat(32)}01${'00'.repeat(31)}${'00'.repeat(32)}`),
        1,
      ),
    ).toThrow(/noncanonical exchange V2 result count/)
  })

  it('matches the frozen Rust work formulas at cross-language boundaries', () => {
    expect(EXCHANGE_ACTION_LIMITS).toMatchObject({
      version: 2,
      maxRadixWrites: 2_048,
      maxStorageOperations: 4_096,
      maxLogBytes: 32_768,
      maxLogs: 256,
      maxSessionAuthorizationsPerPrincipal: 8,
      maxSchedulesPerPrincipal: 8,
      replayHorizonBlocks: 256,
      maxActiveOrdersPerMarket: 32_768,
      maxActiveOrdersPerBook: 262_144,
    })
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [{ ...place(), maxFills: 14, maxPriceLevels: 1 }],
      }),
    ).not.toThrow()
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [{ ...place(), maxFills: 15, maxPriceLevels: 1 }],
      }),
    ).toThrow(/radix writes.*2112.*2048/)

    const cancelChunk = (
      clientByte: number,
    ): ExchangeActionBatch['actions'][number] => ({
      kind: 'cancelMarketChunk',
      clientActionId: repeated(clientByte, 16),
      marketId: repeated(0x11, 32),
      maxOrders: 32,
    })
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [cancelChunk(1)],
      }),
    ).not.toThrow()
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [cancelChunk(1), cancelChunk(2)],
      }),
    ).toThrow(/radix writes.*4096.*2048/)
  })

  it('reserves one extra L3 Remove only for IOC and market places', () => {
    const l3For = (configure: (p: PlaceAction) => PlaceAction): number =>
      exchangeActionBatchAdmissionWork({
        atomicity: 'atomicAll',
        actions: [configure(place())],
      }).l3Logs

    // GTC/GTD/FOK limit rest without a remainder cancel: 2*fills + 1 = 5.
    expect(l3For((p) => p)).toBe(5)
    expect(
      l3For((p) => ({ ...p, timeInForce: { kind: 'gtd', expiry: 9n } })),
    ).toBe(5)
    expect(l3For((p) => ({ ...p, timeInForce: { kind: 'fok' } }))).toBe(5)
    // Post-only rests with zero fills: exactly one AddTail.
    expect(
      l3For((p) => ({
        ...p,
        postOnly: true,
        maxFills: 0,
        maxPriceLevels: 0,
      })),
    ).toBe(1)
    // IOC and market (IOC) reserve the extra remainder Remove: 6.
    expect(l3For((p) => ({ ...p, timeInForce: { kind: 'ioc' } }))).toBe(6)
    expect(
      l3For((p) => ({
        ...p,
        orderKind: 'market',
        timeInForce: { kind: 'ioc' },
        priceTicks: 0n,
      })),
    ).toBe(6)
    // Market FOK reserves the extra slot conservatively (over-reservation is safe).
    expect(
      l3For((p) => ({
        ...p,
        orderKind: 'market',
        timeInForce: { kind: 'fok' },
        priceTicks: 0n,
      })),
    ).toBe(6)
  })

  it('reserves the extra L3 for IOC/market cancel-replace replacements', () => {
    const replace = (
      timeInForce: PlaceAction['timeInForce'],
      replacementOrderKind: PlaceAction['orderKind'],
      priceTicks: bigint,
    ): ExchangeActionBatch => ({
      atomicity: 'atomicAll',
      actions: [
        {
          kind: 'cancelReplace',
          clientActionId: repeated(1, 16),
          marketId: repeated(0x11, 32),
          cancelTarget: 'orderId',
          targetId: repeated(0x21, 32),
          replacementSide: 'sell',
          replacementOrderKind,
          replacementTimeInForce: timeInForce,
          replacementPostOnly: false,
          replacementReduceOnly: false,
          replacementMarginType: 'cross',
          replacementPriceTicks: priceTicks,
          replacementQuantityLots: 3n,
          maxFills: 2,
          maxPriceLevels: 1,
        },
      ],
    })
    // GTC replacement: cancel Remove (1) + place 2*2+1 = 5 -> 6 total.
    expect(
      exchangeActionBatchAdmissionWork(replace({ kind: 'gtc' }, 'limit', 101n))
        .l3Logs,
    ).toBe(6)
    // IOC/market replacement: one extra remainder Remove -> 7 total.
    expect(
      exchangeActionBatchAdmissionWork(replace({ kind: 'ioc' }, 'limit', 101n))
        .l3Logs,
    ).toBe(7)
    expect(
      exchangeActionBatchAdmissionWork(replace({ kind: 'ioc' }, 'market', 0n))
        .l3Logs,
    ).toBe(7)
  })

  it('reserves one OrderCancelled economic log for every bounded cancel', () => {
    const cancelByOrderId = exchangeActionBatchAdmissionWork({
      atomicity: 'atomicAll',
      actions: [
        {
          kind: 'cancelByOrderId',
          clientActionId: repeated(1, 16),
          marketId: repeated(0x11, 32),
          orderId: repeated(0x21, 32),
        },
      ],
    })
    expect(cancelByOrderId).toMatchObject({
      l3Logs: 1,
      l3LogBytes: 288,
      economicLogs: 1,
      economicLogBytes: 256,
      totalLogs: 3,
      totalLogBytes: 800,
    })

    const cancelChunk = exchangeActionBatchAdmissionWork({
      atomicity: 'atomicAll',
      actions: [
        {
          kind: 'cancelMarketChunk',
          clientActionId: repeated(2, 16),
          marketId: repeated(0x11, 32),
          maxOrders: 7,
        },
      ],
    })
    expect(cancelChunk).toMatchObject({
      l3Logs: 7,
      l3LogBytes: 2_016,
      economicLogs: 7,
      economicLogBytes: 1_792,
      totalLogs: 15,
      totalLogBytes: 4_064,
    })

    const cancelReplace = exchangeActionBatchAdmissionWork({
      atomicity: 'atomicAll',
      actions: [
        {
          kind: 'cancelReplace',
          clientActionId: repeated(3, 16),
          marketId: repeated(0x11, 32),
          cancelTarget: 'orderId',
          targetId: repeated(0x21, 32),
          replacementSide: 'sell',
          replacementOrderKind: 'limit',
          replacementTimeInForce: { kind: 'gtc' },
          replacementPostOnly: false,
          replacementReduceOnly: false,
          replacementMarginType: 'cross',
          replacementPriceTicks: 101n,
          replacementQuantityLots: 3n,
          maxFills: 2,
          maxPriceLevels: 1,
        },
      ],
    })
    expect(cancelReplace).toMatchObject({
      l3Logs: 6,
      l3LogBytes: 1_728,
      economicLogs: 5,
      economicLogBytes: 1_280,
      totalLogs: 12,
      totalLogBytes: 3_264,
    })
  })

  it('marks every schedule trigger for canonical-state work refinement', () => {
    const trigger = (clientByte: number, scheduleByte: number) =>
      triggerCancelSchedule({
        clientActionId: repeated(clientByte, 16),
        scheduleId: repeated(scheduleByte, 32),
      })
    const admission = exchangeActionBatchAdmissionWork({
      atomicity: 'continueOnReject',
      actions: [trigger(1, 0x31), trigger(2, 0x32)],
    })

    expect(admission).toEqual({
      l3Logs: 0,
      l3LogBytes: 0,
      economicLogs: 0,
      economicLogBytes: 0,
      totalLogs: 2,
      totalLogBytes: 512,
      statefulScheduleRefinements: 2,
      requiresStatefulPreflight: true,
    })

    expect(() =>
      exchangeActionBatchAdmissionWork({
        atomicity: 'continueOnReject',
        actions: Array.from(
          { length: EXCHANGE_ACTION_LIMITS.maxActions + 1 },
          (_, index) => trigger(index + 1, index + 1),
        ),
      }),
    ).toThrow(/stateful schedule refinements.*unsigned integer range/)
  })

  it('bounds IOC emission within max_log_bytes at the reservation boundary', () => {
    // Four IOC places at seven fills each: the corrected 2*fills + 2
    // reservation totals 34816 log bytes including remainder-cancel events,
    // and its true emission equals the
    // reservation, so the reserved total is what any log-byte ceiling checks.
    // The equivalent GTC batch reserves exactly 32640 (<= max_log_bytes).
    const iocPlace = (client: number): PlaceAction => ({
      ...place(client),
      timeInForce: { kind: 'ioc' },
      maxFills: 7,
      maxPriceLevels: 7,
    })
    const gtcPlace = (client: number): PlaceAction => ({
      ...place(client),
      maxFills: 7,
      maxPriceLevels: 7,
    })
    const ioc = exchangeActionBatchAdmissionWork({
      atomicity: 'continueOnReject',
      actions: [iocPlace(1), iocPlace(2), iocPlace(3), iocPlace(4)],
    })
    const gtc = exchangeActionBatchAdmissionWork({
      atomicity: 'continueOnReject',
      actions: [gtcPlace(1), gtcPlace(2), gtcPlace(3), gtcPlace(4)],
    })
    expect(gtc.totalLogBytes).toBe(32_640)
    expect(gtc.totalLogBytes).toBeLessThanOrEqual(
      EXCHANGE_ACTION_LIMITS.maxLogBytes,
    )
    expect(ioc.totalLogBytes).toBe(34_816)
    expect(ioc.totalLogBytes).toBeGreaterThan(
      EXCHANGE_ACTION_LIMITS.maxLogBytes,
    )
  })

  it('rejects hostile wire shape before bounded decode allocation', () => {
    expect(() => decodeExchangeActionBatch('0x0' as Hex)).toThrow(
      /even-length hex/,
    )
    expect(() => decodeExchangeActionBatch('0xzz' as Hex)).toThrow(
      /invalid hex/,
    )
    expect(() =>
      decodeExchangeActionBatch(
        hex('00'.repeat(EXCHANGE_ACTION_LIMITS.maxEncodedBytes + 1)),
      ),
    ).toThrow(/encoded batch exceeds 16384 bytes/)
    expect(() =>
      decodeExchangeActionBatch(hex('445841320200000000000000')),
    ).toThrow(/actions must be nonempty/)
    expect(() =>
      decodeExchangeActionBatch(hex('445841320200000000210000')),
    ).toThrow(/at most 32 actions/)
    expect(() =>
      decodeExchangeActionBatch(hex('445841320200000000010000')),
    ).toThrow(/minimum record footprint/)

    const impossibleSchedule = new Uint8Array(12 + 80)
    impossibleSchedule.set([0x44, 0x58, 0x41, 0x32, 2, 0, 0, 0, 0, 1], 0)
    impossibleSchedule.set([6, 0, 0, 80], 12)
    impossibleSchedule[12 + 78] = 0xff
    impossibleSchedule[12 + 79] = 0xff
    expect(() =>
      decodeExchangeActionBatch(bytesToHex(impossibleSchedule)),
    ).toThrow(/arm schedule record length/)

    const overMarketSchedule = new Uint8Array(12 + 80 + 17 * 32)
    overMarketSchedule.set([0x44, 0x58, 0x41, 0x32, 2, 0, 0, 0, 0, 1], 0)
    overMarketSchedule.set([6, 0, 0x02, 0x70], 12)
    overMarketSchedule[12 + 78] = 0
    overMarketSchedule[12 + 79] = 17
    expect(() =>
      decodeExchangeActionBatch(bytesToHex(overMarketSchedule)),
    ).toThrow(/wire schedule market count must be between 1 and 16/)
  })

  it('checks result input length before hex conversion', () => {
    const oversizedResultWithInvalidTail = `0x${'00'.repeat(96)}zz` as Hex
    expect(() =>
      decodeExchangeActionsResult(oversizedResultWithInvalidTail, 1),
    ).toThrow(/exchange V2 result must be 96 bytes/)
  })

  it('checks result-hash batch bounds before hex conversion', () => {
    const oversizedBatchWithInvalidTail =
      `0x${'00'.repeat(EXCHANGE_ACTION_LIMITS.maxEncodedBytes + 1)}zz` as Hex
    expect(() =>
      computeExchangeResultHash(oversizedBatchWithInvalidTail, [
        {
          accepted: true,
          actionIndex: 0,
          actionTag: 1,
          resultId: repeated(1, 32),
        },
      ]),
    ).toThrow(/encoded batch exceeds 16384 bytes/)
  })

  it('rejects malformed, ambiguous, and over-bound batches before submission', () => {
    const base = place()
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [base],
        nonce: 1n,
      } as never),
    ).toThrow(/unknown batch field nonce/)
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [
          {
            ...base,
            timeInForce: { kind: 'gtc', nonce: 1n },
          } as never,
        ],
      }),
    ).toThrow(/unknown gtc timeInForce field nonce/)
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [
          {
            ...base,
            timeInForce: { kind: 'ioc', expiry: 99n },
          } as never,
        ],
      }),
    ).toThrow(/unknown ioc timeInForce field expiry/)
    expect(() =>
      prepareExchangeActionsTransaction({
        book: 'options' as never,
        batch: { atomicity: 'atomicAll', actions: [base] },
      }),
    ).toThrow(/unknown exchange book/)
    for (const field of ['postOnly', 'reduceOnly'] as const) {
      expect(() =>
        encodeExchangeActionBatch({
          atomicity: 'atomicAll',
          actions: [{ ...base, [field]: 'false' } as never],
        }),
      ).toThrow(new RegExp(`${field} must be a boolean`))
    }
    for (const field of [
      'replacementPostOnly',
      'replacementReduceOnly',
    ] as const) {
      expect(() =>
        encodeExchangeActionBatch({
          atomicity: 'atomicAll',
          actions: [
            {
              ...canonicalBatches().continue_mixed_ordering!.actions[4]!,
              [field]: 'false',
            } as never,
          ],
        }),
      ).toThrow(new RegExp(`${field} must be a boolean`))
    }
    expect(() =>
      encodeExchangeActionBatch({ atomicity: 'atomicAll', actions: [] }),
    ).toThrow(/nonempty/)
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [base, { ...base }],
      }),
    ).toThrow(/duplicate client action id/)
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: Array.from({ length: 33 }, (_, index) => ({
          ...base,
          clientActionId: repeated(index + 1, 16),
        })),
      }),
    ).toThrow(/at most 32 actions/)
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [{ ...base, marketId: '0x11' }],
      }),
    ).toThrow(/marketId.*32 bytes/)
    expect(() =>
      encodeExchangeActionBatch({
        atomicity: 'atomicAll',
        actions: [{ ...base, signature: repeated(1, 65), nonce: 1n } as never],
      }),
    ).toThrow(/unknown.*signature/)

    const encoded = encodeExchangeActionBatch({
      atomicity: 'atomicAll',
      actions: [base],
    })
    expect(() => decodeExchangeActionBatch(`${encoded}00`)).toThrow(
      /trailing bytes/,
    )
  })
})

// Pricing changes only flags bit 0x04, preserving all record lengths and option bytes.
describe('signed DXA2 pricing version', () => {
  const replacement = (): CancelReplaceAction => ({
    ...(canonicalBatches().continue_mixed_ordering!
      .actions[4] as CancelReplaceAction),
  })
  const encodeSingle = (action: PlaceAction | CancelReplaceAction): Hex =>
    encodeExchangeActionBatch({ atomicity: 'atomicAll', actions: [action] })

  it('keeps omitted and explicit zero place bytes equal to the legacy fixture', () => {
    const original = canonicalBatches().atomic_spot_gtc_limit!
      .actions[0] as PlaceAction
    const { pricingVersion: _version, ...omitted } = original
    const encoded = encodeSingle(omitted)
    expect(encoded).toBe(hex(vector('atomic_spot_gtc_limit').encoded_hex))
    expect(encodeSingle({ ...omitted, pricingVersion: 0 })).toBe(encoded)
    expect(decodeExchangeActionBatch(encoded).actions[0]).toMatchObject({
      pricingVersion: 0,
    })
  })

  it('keeps omitted and explicit zero replacement bytes identical', () => {
    const { replacementPricingVersion: _version, ...omitted } = replacement()
    const encoded = encodeSingle(omitted)
    expect(encodeSingle({ ...omitted, replacementPricingVersion: 0 })).toBe(
      encoded,
    )
    expect(decodeExchangeActionBatch(encoded).actions[0]).toMatchObject({
      replacementPricingVersion: 0,
    })
  })

  it.each(['place', 'replacement'] as const)(
    'refuses prospective %s pricing before transaction preparation or signing',
    (kind) => {
      const action =
        kind === 'place'
          ? { ...place(), pricingVersion: 1 as const }
          : { ...replacement(), replacementPricingVersion: 1 as const }
      const batch: ExchangeActionBatch = {
        atomicity: 'atomicAll',
        actions: [action],
      }
      // The wire codec remains available for independent future-native fixtures.
      expect(encodeExchangeActionBatch(batch)).toMatch(/^0x44584132/)
      expect(() =>
        prepareExchangeActionsTransaction({ book: 'perpetual', batch }),
      ).toThrow('Pricing version 1 requires qualified native admission')
      let signatures = 0
      const account = {
        signTransaction: async () => {
          signatures += 1
          return '0x00' as Hex
        },
      }
      expect(() =>
        signExchangeActionsTransaction(account, {
          book: 'perpetual',
          batch,
          transaction: {
            chainId: 1980,
            nonce: 7,
            gas: 500_000n,
            maxFeePerGas: 100n,
            maxPriorityFeePerGas: 1n,
          },
        }),
      ).toThrow('Pricing version 1 requires qualified native admission')
      expect(signatures).toBe(0)
    },
  )

  it('sets version 1 only at place flags offset 55 and round-trips it', () => {
    const legacy = hexToBytes(encodeSingle(place()))
    const priced = {
      ...place(),
      pricingVersion: 1 as const,
      reduceOnly: true,
      postOnly: true,
      maxFills: 0,
      maxPriceLevels: 0,
    }
    const expected = hexToBytes(encodeSingle({ ...priced, pricingVersion: 0 }))
    expected[12 + 55] = 0x07
    const encoded = encodeSingle(priced)
    expect(hexToBytes(encoded)).toEqual(expected)
    expect(hexToBytes(encoded).length).toBe(legacy.length)
    expect(decodeExchangeActionBatch(encoded).actions[0]).toEqual(priced)
  })

  it('sets version 1 only at replacement flags offset 56 and round-trips it', () => {
    const priced = {
      ...replacement(),
      replacementPricingVersion: 1 as const,
      replacementReduceOnly: true,
      replacementPostOnly: true,
      maxFills: 0,
      maxPriceLevels: 0,
    }
    const expected = hexToBytes(
      encodeSingle({ ...priced, replacementPricingVersion: 0 }),
    )
    expected[12 + 56] = 0x07
    const encoded = encodeSingle(priced)
    expect(hexToBytes(encoded)).toEqual(expected)
    expect(decodeExchangeActionBatch(encoded).actions[0]).toEqual(priced)
  })

  it.each([0x08, 0x10, 0x20, 0x40, 0x80])(
    'rejects unknown flags bit %i on either order leg',
    (bit) => {
      for (const [action, offset] of [
        [place(), 55],
        [replacement(), 56],
      ] as const) {
        const bytes = hexToBytes(encodeSingle(action))
        bytes[12 + offset] |= bit
        expect(() => decodeExchangeActionBatch(bytesToHex(bytes))).toThrow(
          'reserved order bits',
        )
      }
    },
  )

  it.each([2, -1, 1.5, null, '1', true])(
    'rejects malformed pricing version %s on either order leg',
    (version) => {
      expect(() =>
        encodeSingle({ ...place(), pricingVersion: version } as PlaceAction),
      ).toThrow('pricingVersion')
      expect(() =>
        encodeSingle({
          ...replacement(),
          replacementPricingVersion: version,
        } as CancelReplaceAction),
      ).toThrow('pricingVersion')
    },
  )

  it('rejects replacement pricing under the place field name', () => {
    expect(() =>
      encodeSingle({
        ...replacement(),
        pricingVersion: 1,
      } as CancelReplaceAction),
    ).toThrow('unknown cancelReplace field pricingVersion')
  })

  it('does not reinterpret version 1 as the margin option', () => {
    const bytes = hexToBytes(encodeSingle({ ...place(), pricingVersion: 1 }))
    bytes[12 + 56] |= 0x04
    expect(() => decodeExchangeActionBatch(bytesToHex(bytes))).toThrow(
      'noncanonical margin option',
    )
  })
})
