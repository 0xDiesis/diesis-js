import { describe, expect, it } from 'vitest'
import { type Hex } from 'viem'
import {
  computeExchangeResultHashV2,
  decodeExchangeActionsV2Result,
  type ActionOutcomeV2,
} from '../src/exchange/actions-v2-results.js'
import { encodeExchangeActionBatchV2 } from '../src/exchange/actions-v2.js'
import fixture from './fixtures/core-v2-results-44bed.json'
const hex = (value: string): Hex => `0x${value}`
describe('public V2 result codec node44bed provenance', () => {
  it('matches pinned node canonical mixed outcomes and ABI bytes', () => {
    expect(fixture.nodeCommit).toBe('44bed910b4fd18c29e287ecd49a12982a90ac5bb')
    for (const vector of fixture.vectors) {
      const outcomes: ActionOutcomeV2[] = vector.result.outcomes.map(
        (outcome) =>
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
      expect(
        computeExchangeResultHashV2(hex(vector.encoded_hex), outcomes),
      ).toBe(hex(vector.result.result_hash_hex))
      expect(
        decodeExchangeActionsV2Result(
          hex(vector.result.encoded_return_hex),
          outcomes.length,
        ),
      ).toEqual({
        resultHash: hex(vector.result.result_hash_hex),
        acceptedCount: vector.result.accepted_count,
        rejectedCount: vector.result.rejected_count,
      })
    }
  })
  it('accepts collateral action tag10 and rejects unrecognized tags', () => {
    const batch = encodeExchangeActionBatchV2({
      atomicity: 'atomicAll',
      actions: [
        {
          kind: 'adjustPositionCollateral',
          clientActionId: `0x${'11'.repeat(16)}`,
          marketId: `0x${'22'.repeat(32)}`,
          collateralDelta: -1n,
        },
      ],
    })
    const outcome = {
      accepted: true as const,
      actionIndex: 0,
      actionTag: 10,
      resultId: `0x${'33'.repeat(32)}` as Hex,
    }
    expect(computeExchangeResultHashV2(batch, [outcome])).toMatch(
      /^0x[0-9a-f]{64}$/,
    )
    expect(() =>
      computeExchangeResultHashV2(batch, [{ ...outcome, actionTag: 11 }]),
    ).toThrow('unknown action tag')
  })
})
