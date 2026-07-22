import { recoverTypedDataAddress, toFunctionSelector } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import {
  computeActionsHash,
  getPerpActionsTypedData,
  perpActionsDigest,
  signPerpActions,
  type SignedPerpActionsV2Message,
} from '../src/exchange/perps-signed.js'
import {
  encodeRouterDeposit,
  encodeRouterWithdraw,
  encodeSetTokenAllowed,
} from '../src/settlement/router.js'

describe('signed perp actions envelope', () => {
  it('commits to the action bytes and recovers the trader', async () => {
    const trader = privateKeyToAccount(`0x${'e2'.repeat(32)}`)
    const actions = '0x0203aabbccdd' as const
    const message: SignedPerpActionsV2Message = {
      trader: trader.address,
      nonce: 7n,
      expiry: 0n,
      actionsHash: computeActionsHash(actions),
    }
    const signature = await signPerpActions(trader, message, 1980)
    const recovered = await recoverTypedDataAddress({
      ...getPerpActionsTypedData(message, 1980),
      signature,
    })
    expect(recovered).toBe(trader.address)
    expect(perpActionsDigest(message, 1980)).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('settlement router calldata', () => {
  it('encodes the router-only public selectors', () => {
    const token = '0x00000000000000000000000000000000000000a1' as const
    const to = '0x00000000000000000000000000000000000000b2' as const
    expect(
      encodeRouterDeposit(token, 1000n, to).startsWith(
        toFunctionSelector('deposit(address,uint256,address)'),
      ),
    ).toBe(true)
    expect(
      encodeRouterWithdraw(token, 1000n, to).startsWith(
        toFunctionSelector('withdraw(address,uint256,address)'),
      ),
    ).toBe(true)
    expect(
      encodeSetTokenAllowed(token, true).startsWith(
        toFunctionSelector('setTokenAllowed(address,bool)'),
      ),
    ).toBe(true)
  })
})
