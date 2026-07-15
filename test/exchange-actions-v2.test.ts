import { readFile } from 'node:fs/promises'

import { createWalletClient, custom, keccak256, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  computeExchangeResultHashV2,
  decodeExchangeActionBatchV2,
  decodeExchangeActionsV2Result,
  encodeExchangeActionBatchV2,
  prepareExchangeActionsV2Transaction,
  sendExchangeActionsV2Transaction,
  signExchangeActionsV2Transaction,
  type ActionOutcomeV2,
  type ExchangeActionBatchV2,
  type PlaceActionV2,
  armCancelScheduleV2,
  disarmCancelScheduleV2,
  renewCancelScheduleV2,
  triggerCancelScheduleV2,
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

const place = (clientByte = 1): PlaceActionV2 => ({
  kind: 'place',
  clientActionId: repeated(clientByte, 16),
  marketId: repeated(0x11, 32),
  side: 'buy',
  orderKind: 'limit',
  timeInForce: { kind: 'gtc' },
  postOnly: false,
  reduceOnly: false,
  marginType: 'cross',
  priceTicks: 100n,
  quantityLots: 5n,
  maxFills: 2,
  maxPriceLevels: 1,
})

const canonicalBatches = (): Readonly<
  Record<string, ExchangeActionBatchV2>
> => {
  const atomicPlace: PlaceActionV2 = {
    ...place(),
    clientActionId: hex('000102030405060708090a0b0c0d0e0f'),
  }
  const marketIoc: PlaceActionV2 = {
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
        armCancelScheduleV2({
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
        renewCancelScheduleV2({
          clientActionId: repeated(2, 16),
          scheduleId,
          expectedRenewalCounter: 1n,
          newDeadline: 3_500n,
        }),
        disarmCancelScheduleV2({
          clientActionId: repeated(3, 16),
          scheduleId,
          expectedRenewalCounter: 2n,
        }),
        triggerCancelScheduleV2({
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
      const encoded = encodeExchangeActionBatchV2(batch)
      expect(encoded, name).toBe(hex(vector(name).encoded_hex))
      expect(decodeExchangeActionBatchV2(encoded), name).toEqual(batch)
    }
  })

  it('builds the exact Solidity ABI calldata and ordinary EIP-1559 transaction', async () => {
    const batch = canonicalBatches().atomic_spot_gtc_limit!
    const prepared = prepareExchangeActionsV2Transaction({
      book: 'spot',
      batch,
    })
    expect(prepared.data).toBe(
      hex(vector('atomic_spot_gtc_limit').abi!.calldata_hex),
    )
    expect(prepared).toMatchObject({
      to: '0xd1e515000000000000000000000000000000590d',
      value: 0n,
    })

    const account = privateKeyToAccount(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    )
    const raw = await signExchangeActionsV2Transaction(account, {
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
      '0x02f9016b8207bc0701648307a12094d1e515000000000000000000000000000000590d80b90104881c51de000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a444584132020000000001000001000098000102030405060708090a0b0c0d0e0f11111111111111111111111111111111111111111111111111111111111111110000000000000000000000000000006400000000000000050000000000000000000200010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c001a0c3f608fac8713c0c928026e0cc1df5e9206ba2c37b83037bad4d78799bf28768a0747b29dae6242718cc63b07d342ef16c3193f5247fe258d7eb65e7f2b6b670c5',
    )
    expect(keccak256(raw)).toBe(
      '0x2f5da44fc420b4960489cb3ea87920bd191f710ecd604e26cdfd823aede2e57a',
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
          if (request.method === 'eth_sendRawTransaction') {
            return '0x2f5da44fc420b4960489cb3ea87920bd191f710ecd604e26cdfd823aede2e57a'
          }
          throw new Error(`unexpected RPC ${request.method}`)
        },
      }),
    })
    await expect(
      sendExchangeActionsV2Transaction(client, {
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
      '0x2f5da44fc420b4960489cb3ea87920bd191f710ecd604e26cdfd823aede2e57a',
    )
    expect(requests).toEqual([
      { method: 'eth_sendRawTransaction', params: [raw] },
    ])
  })

  it('matches the frozen ordered outcome commitment and ABI return bytes', () => {
    const frozen = vector('continue_mixed_ordering')
    const expected = frozen.result!
    const outcomes: ActionOutcomeV2[] = expected.outcomes.map((outcome) =>
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
    expect(computeExchangeResultHashV2(hex(frozen.encoded_hex), outcomes)).toBe(
      hex(expected.result_hash_hex),
    )
    expect(
      decodeExchangeActionsV2Result(hex(expected.encoded_return_hex)),
    ).toEqual({
      resultHash: hex(expected.result_hash_hex),
      acceptedCount: expected.accepted_count,
      rejectedCount: expected.rejected_count,
    })

    expect(() =>
      computeExchangeResultHashV2(
        hex(frozen.encoded_hex),
        outcomes.slice(0, 1),
      ),
    ).toThrow(/outcome count/)
    expect(() =>
      computeExchangeResultHashV2(hex(frozen.encoded_hex), [
        { ...outcomes[0]!, accepted: 'false' } as never,
        ...outcomes.slice(1),
      ]),
    ).toThrow(/accepted must be a boolean/)
    expect(() =>
      computeExchangeResultHashV2(hex(frozen.encoded_hex), [
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
  })

  it('rejects malformed, ambiguous, and over-bound batches before submission', () => {
    const base = place()
    expect(() =>
      prepareExchangeActionsV2Transaction({
        book: 'options' as never,
        batch: { atomicity: 'atomicAll', actions: [base] },
      }),
    ).toThrow(/unknown exchange book/)
    for (const field of ['postOnly', 'reduceOnly'] as const) {
      expect(() =>
        encodeExchangeActionBatchV2({
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
        encodeExchangeActionBatchV2({
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
      encodeExchangeActionBatchV2({ atomicity: 'atomicAll', actions: [] }),
    ).toThrow(/nonempty/)
    expect(() =>
      encodeExchangeActionBatchV2({
        atomicity: 'atomicAll',
        actions: [base, { ...base }],
      }),
    ).toThrow(/duplicate client action id/)
    expect(() =>
      encodeExchangeActionBatchV2({
        atomicity: 'atomicAll',
        actions: Array.from({ length: 33 }, (_, index) => ({
          ...base,
          clientActionId: repeated(index + 1, 16),
        })),
      }),
    ).toThrow(/at most 32 actions/)
    expect(() =>
      encodeExchangeActionBatchV2({
        atomicity: 'atomicAll',
        actions: [{ ...base, marketId: '0x11' }],
      }),
    ).toThrow(/marketId.*32 bytes/)
    expect(() =>
      encodeExchangeActionBatchV2({
        atomicity: 'atomicAll',
        actions: [{ ...base, signature: repeated(1, 65), nonce: 1n } as never],
      }),
    ).toThrow(/unknown.*signature/)

    const encoded = encodeExchangeActionBatchV2({
      atomicity: 'atomicAll',
      actions: [base],
    })
    expect(() => decodeExchangeActionBatchV2(`${encoded}00`)).toThrow(
      /trailing bytes/,
    )
  })
})
