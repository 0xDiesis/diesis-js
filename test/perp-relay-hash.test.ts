import { describe, expect, it } from 'vitest'
import {
  computePerpRelayActionHash,
  type SignedPerpRelayEnvelope,
} from '../src/exchange/perps-signed.js'

const envelope: SignedPerpRelayEnvelope = {
  trader: '0x1111111111111111111111111111111111111111',
  nonce: '0x01',
  expiry: 0,
  chainId: 1980,
  verifyingContract: '0x2222222222222222222222222222222222222222',
  actionsHash: `0x${'33'.repeat(32)}`,
  actions: '0xAaBb',
  signature: { r: `0x${'44'.repeat(32)}`, s: `0x${'55'.repeat(32)}`, v: 27 },
}

describe('signed perp relay action hash', () => {
  it('matches the Rust normalized action hash vector', () => {
    expect(computePerpRelayActionHash(envelope)).toBe(
      '0xe0636e334d84cc16a2eb915d99888347550df8c423fd1d8e6da4898932295347',
    )
  })

  it('commits to exact inner string representation', () => {
    expect(
      computePerpRelayActionHash({ ...envelope, actions: '0xaabb' }),
    ).not.toBe(computePerpRelayActionHash(envelope))
    expect(computePerpRelayActionHash({ ...envelope, nonce: '0x1' })).not.toBe(
      computePerpRelayActionHash(envelope),
    )
  })

  it('rejects unsupported envelope shapes and out-of-range integers', () => {
    expect(() =>
      computePerpRelayActionHash({ ...envelope, nonce: '0x' }),
    ).toThrow()
    expect(() =>
      computePerpRelayActionHash({
        ...envelope,
        chainId: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow()
    expect(() =>
      computePerpRelayActionHash({
        ...envelope,
        extra: 1,
      } as SignedPerpRelayEnvelope),
    ).toThrow()
  })
})
