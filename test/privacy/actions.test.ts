import { decodeFunctionData, toFunctionSelector, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { DiesisShieldedPoolAbi } from '../../src/abi/index.js'
import {
  encodeDepositShieldedV1,
  encodeTransactShieldedV1,
  encodeWithdrawShieldedV1,
} from '../../src/privacy/actions.js'

const bytes32 = (lastByte: number): `0x${string}` =>
  `0x${'00'.repeat(31)}${lastByte.toString(16).padStart(2, '0')}`
const bytes = (length: number): `0x${string}` =>
  `0x${Array.from({ length }, (_, index) => (index & 0xff).toString(16).padStart(2, '0')).join('')}`

describe('fixed privacy transaction calldata', () => {
  it('encodes a deposit with one exact encrypted note', () => {
    const data = encodeDepositShieldedV1({
      commitment: bytes32(1),
      encryptedNote: bytes(169),
    })
    expect(decodeFunctionData({ abi: DiesisShieldedPoolAbi, data })).toEqual({
      functionName: 'deposit',
      args: [bytes32(1), bytes(169)],
    })
    expect(() =>
      encodeDepositShieldedV1({
        commitment: bytes32(1),
        encryptedNote: bytes(168),
      }),
    ).toThrow(/169 bytes/)
  })

  it('encodes fixed two-slot transfers and rejects inactive-slot confusion', () => {
    const data = encodeTransactShieldedV1({
      proof: bytes(256),
      merkleRoot: bytes32(1),
      nullifiers: [bytes32(2), bytes32(0)],
      commitments: [bytes32(3), bytes32(0)],
      activeCount: 1,
      encryptedOutputs: bytes(169),
    })
    expect(decodeFunctionData({ abi: DiesisShieldedPoolAbi, data })).toEqual({
      functionName: 'transact',
      args: [
        bytes(256),
        bytes32(1),
        [bytes32(2), bytes32(0)],
        [bytes32(3), bytes32(0)],
        1,
        bytes(169),
      ],
    })
    expect(() =>
      encodeTransactShieldedV1({
        proof: bytes(256),
        merkleRoot: bytes32(1),
        nullifiers: [bytes32(2), bytes32(4)],
        commitments: [bytes32(3), bytes32(0)],
        activeCount: 1,
        encryptedOutputs: bytes(169),
      }),
    ).toThrow(/inactive transfer slots/)
  })

  it('encodes full-denomination withdrawal without an amount argument', () => {
    const data = encodeWithdrawShieldedV1({
      proof: bytes(256),
      merkleRoot: bytes32(1),
      nullifier: bytes32(2),
      recipient: '0x0000000000000000000000000000000000001234',
      relayer: zeroAddress,
      fee: 0n,
    })
    const decoded = decodeFunctionData({ abi: DiesisShieldedPoolAbi, data })
    expect(decoded.functionName).toBe('withdraw')
    expect(decoded.args).toHaveLength(6)
  })

  it('does not expose the retired dynamic transfer selector', () => {
    const oldSelector = toFunctionSelector(
      'transact(bytes,bytes32,bytes32[],bytes32[],bytes32)',
    )
    const fixed = encodeTransactShieldedV1({
      proof: bytes(256),
      merkleRoot: bytes32(1),
      nullifiers: [bytes32(2), bytes32(0)],
      commitments: [bytes32(3), bytes32(0)],
      activeCount: 1,
      encryptedOutputs: bytes(169),
    })
    expect(fixed.slice(0, 10)).not.toBe(oldSelector)
  })
})
