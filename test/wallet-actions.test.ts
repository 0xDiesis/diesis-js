import { createWalletClient, custom, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import { diesisWalletActions } from '../src/index.js'

const account = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)

const chain = {
  id: 1980,
  name: 'Diesis',
  nativeCurrency: { name: 'Diesis', symbol: 'DS', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
} as const

function walletWithRequests() {
  const requests: Array<{ method: string; params?: unknown }> = []
  const client = createWalletClient({
    account,
    chain,
    transport: custom({
      request: async (request) => {
        requests.push(request)
        if (
          request.method === 'diesis_sendRawTransaction' ||
          request.method === 'eth_sendRawTransaction'
        ) {
          return '0x2f5da44fc420b4960489cb3ea87920bd191f710ecd604e26cdfd823aede2e57a'
        }
        throw new Error(`unexpected RPC ${request.method}`)
      },
    }),
  }).extend(diesisWalletActions)
  return { client, requests }
}

describe('diesis wallet actions', () => {
  it('does not expose the legacy generic stealth-bundle shortcut', () => {
    const { client } = walletWithRequests()

    expect('sendStealthBundle' in client).toBe(false)
  })

  it('sendRawTransactionGated emits the gated Diesis method', async () => {
    const { client, requests } = walletWithRequests()
    const serialized =
      '0x02f8b08207bc0701648307a12094d1e5150000000000000000000000000000005901' as Hex

    await expect(client.sendRawTransactionGated(serialized)).resolves.toBe(
      '0x2f5da44fc420b4960489cb3ea87920bd191f710ecd604e26cdfd823aede2e57a',
    )

    expect(requests).toEqual([
      { method: 'diesis_sendRawTransaction', params: [serialized] },
    ])
  })

  it('preserves viem sendRawTransaction and its standard parameter shape', async () => {
    const { client, requests } = walletWithRequests()
    const serialized =
      '0x02f8b08207bc0701648307a12094d1e5150000000000000000000000000000005901' as Hex

    await expect(
      client.sendRawTransaction({ serializedTransaction: serialized }),
    ).resolves.toBe(
      '0x2f5da44fc420b4960489cb3ea87920bd191f710ecd604e26cdfd823aede2e57a',
    )

    expect(requests).toEqual([
      { method: 'eth_sendRawTransaction', params: [serialized] },
    ])
  })
})
