import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublicClient, custom } from 'viem'
import * as root from '@diesis/sdk'
import * as exchange from '@diesis/sdk/exchange'

// Exercise package exports and built distribution, rather than source aliases.
test('built root and Exchange entry points expose the same lifecycle and RPC actions', () => {
  assert.equal(root.createPerpLifecycle, exchange.createPerpLifecycle)
  assert.equal(root.exchangePublicActions, exchange.exchangePublicActions)
  assert.equal(typeof exchange.createUnpricedPerpRegistration, 'function')
})

test('built consumer unwraps anchored market data and handles absent markets', async () => {
  const blockHash = `0x${'42'.repeat(32)}`
  const indexDigest = `0x${'99'.repeat(32)}`
  const marketId = `0x${'11'.repeat(32)}`
  const client = createPublicClient({
    transport: custom({
      request: async ({ method }) => {
        if (method === 'exchange_getMarkets')
          return { blockNumber: 42, blockHash, indexDigest, data: [] }
        if (method === 'exchange_getMarket') return null
        if (method === 'exchange_getOperatorBalance')
          return '0x10000000000000000'
        throw new Error(`Unexpected fixture request ${method}`)
      },
    }),
  }).extend(exchange.exchangePublicActions)
  const markets = await client.exchange.getMarkets()
  assert.deepEqual(markets.data, [])
  assert.deepEqual(
    [markets.blockNumber, markets.blockHash, markets.indexDigest],
    [42n, blockHash, indexDigest],
  )
  assert.equal(await client.exchange.getMarket({ marketId }), null)
  assert.equal(
    await client.exchange.getOperatorBalance({
      operator: `0x${'22'.repeat(20)}`,
    }),
    18446744073709551616n,
  )
})
