import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeCustodyRead } from '../src/exchange/custody-reads.ts'
const user = '0x1111111111111111111111111111111111111111'
const token = '0x2222222222222222222222222222222222222222'
const hash = `0x${'ab'.repeat(32)}`
function fixture() {
  return {
    readVersion: 1,
    indexGeneration: '18446744073709551615',
    value: {
      user,
      assets: [
        {
          token,
          totalBalance: '0x64',
          lockedBalance: '0x1e',
          spendableBalance: '0x46',
          reservedUserMargin: '0xa',
          evaluatedPositionClaims: '0x5',
          accountValueRaw: '0x73',
        },
      ],
      margins: [
        {
          marketId: `0x${'01'.repeat(32)}`,
          token,
          reservedUserMargin: '0xa',
          evaluatedPositionClaim: '0x5',
        },
      ],
      coverage: {
        complete: true,
        genesisCustodyProvenEmpty: true,
        genesisPrestateHash: hash,
        gaps: [],
        gapRangesTruncated: false,
        inventoryTruncated: false,
      },
    },
  }
}
test('literal financial buckets are not added twice', () => {
  const read = decodeCustodyRead(fixture(), user, 42n)
  assert.equal(read.value.assets[0].accountValueRaw, 115n)
  assert.equal(read.value.assets[0].spendableBalance, 70n)
  assert.equal(read.indexGeneration, (1n << 64n) - 1n)
})
test('full U256 retains all 256 bits', () => {
  const wire = fixture()
  const max = `0x${'f'.repeat(64)}`
  wire.value.assets = [
    {
      token,
      totalBalance: max,
      lockedBalance: '0x0',
      spendableBalance: max,
      reservedUserMargin: '0x0',
      evaluatedPositionClaims: '0x0',
      accountValueRaw: max,
    },
  ]
  wire.value.margins = []
  assert.equal(
    decodeCustodyRead(wire, user, 42n).value.assets[0].totalBalance,
    (1n << 256n) - 1n,
  )
})
test('forged completeness and gaps beyond the anchor are rejected', () => {
  const wire = fixture()
  wire.value.coverage.inventoryTruncated = true
  assert.throws(() => decodeCustodyRead(wire, user, 42n))
  wire.value.coverage.complete = false
  wire.value.coverage.gaps = [{ fromBlock: 40, toBlock: 43 }]
  assert.throws(() => decodeCustodyRead(wire, user, 42n))
})
test('a missing nonzero market aggregate cannot become an empty account', () => {
  const wire = fixture()
  wire.value.assets = []
  assert.throws(() => decodeCustodyRead(wire, user, 42n))
})
test('all-zero registered markets survive without an asset row', () => {
  const wire = fixture()
  wire.value.assets = []
  wire.value.margins[0].reservedUserMargin = '0x0'
  wire.value.margins[0].evaluatedPositionClaim = '0x0'
  assert.equal(decodeCustodyRead(wire, user, 42n).value.margins.length, 1)
})
