import { describe, expect, it, vi } from 'vitest'
import { diesisPublicActions } from '../src/actions/public.js'
import { DIESIS_POSITION } from '../src/addresses.js'

const hash = `0x${'31'.repeat(32)}` as const
const address = `0x${'42'.repeat(20)}` as const
function fixture() {
  return {
    readVersion: 1,
    anchor: {
      chainId: '1980',
      blockNumber: 7,
      blockHash: hash,
      stateRoot: hash,
      timestamp: '9007199254740993',
    },
    binding: {
      status: 'verified',
      positionAddress: DIESIS_POSITION,
      positionCodeHash: hash,
      positionOwner: address,
      shareAddress: address,
      shareCodeHash: hash,
      supportedArtifact: 'validatorShareV1',
      semantics: 'oneTimeOwnerBinding',
    },
    validator: {
      id: '4294967295',
      registration: 'retired',
      operator: address,
      marks: '16',
      inactive: false,
    },
  }
}
function setup(reply: unknown = fixture()) {
  const request = vi.fn(async () => reply)
  const actions = diesisPublicActions({
    request,
    chain: { id: 1980 },
  } as never) as unknown as {
    getValidatorShareBinding: (params: {
      validatorId: bigint
      blockHash?: `0x${string}`
    }) => Promise<unknown>
  }
  return { request, actions }
}
describe('governed validator-share binding observation', () => {
  it('exposes the registered read, binds the exact hash and preserves large decimal values', async () => {
    const { request, actions } = setup()
    expect(typeof actions.getValidatorShareBinding).toBe('function')
    await expect(
      actions.getValidatorShareBinding({
        validatorId: 4294967295n,
        blockHash: hash,
      }),
    ).resolves.toEqual(fixture())
    expect(request).toHaveBeenCalledWith({
      method: 'diesis_getValidatorShareBinding',
      params: [{ validatorId: '4294967295', blockHash: hash }],
    })
  })
  it('rejects invalid IDs and hashes before transport', async () => {
    const { request, actions } = setup()
    for (const validatorId of [0n, -1n, 4294967296n, 1 as never])
      await expect(
        actions.getValidatorShareBinding({ validatorId }),
      ).rejects.toThrow()
    await expect(
      actions.getValidatorShareBinding({ validatorId: 1n, blockHash: '0x1' }),
    ).rejects.toThrow()
    await expect(
      actions.getValidatorShareBinding({
        validatorId: 1n,
        blockHash: `${hash}\n`,
      }),
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
  it('binds the reply to the original query while the transport is pending', async () => {
    let release!: (value: unknown) => void
    const pending = new Promise((resolve) => {
      release = resolve
    })
    const request = vi.fn(async () => pending)
    const actions = diesisPublicActions({
      request,
      chain: { id: 1980 },
    } as never)
    const query = { validatorId: 4294967295n, blockHash: hash as `0x${string}` }
    const read = actions.getValidatorShareBinding(query)
    const altered = fixture()
    altered.anchor.blockHash = `0x${'51'.repeat(32)}`
    query.blockHash = altered.anchor.blockHash
    release(altered)
    await expect(read).rejects.toThrow()
  })
  it('refuses malformed, mismatched and internally inconsistent observations', async () => {
    const changes: Array<(value: ReturnType<typeof fixture>) => void> = [
      (v) => {
        v.readVersion = 2
      },
      (v) => {
        v.anchor.blockNumber = Number.MAX_SAFE_INTEGER + 1
      },
      (v) => {
        v.anchor.chainId = '19803'
      },
      (v) => {
        v.anchor.blockHash = `0x${'51'.repeat(32)}`
      },
      (v) => {
        v.anchor.timestamp = '01'
      },
      (v) => {
        v.anchor.timestamp = '1\n'
      },
      (v) => {
        v.validator.marks = '0\n'
      },
      (v) => {
        v.binding.positionOwner = `${address}\n`
      },
      (v) => {
        v.binding.shareCodeHash = `${hash}\n`
      },
      (v) => {
        v.validator.id = '1'
      },
      (v) => {
        v.validator.inactive = true
      },
      (v) => {
        v.validator.marks = '65536'
      },
      (v) => {
        v.binding.positionAddress = address
      },
      (v) => {
        v.binding.status = 'unbound'
      },
      (v) => {
        v.binding.supportedArtifact = 'unknown'
      },
      (v) => {
        Object.assign(v.binding, {
          status: 'invalidBinding',
          supportedArtifact: null,
          shareCodeHash: null,
        })
      },
      (v) => {
        Object.assign(v.validator, { secret: 'unexpected' })
      },
      (v) => {
        Object.assign(v, { extra: true })
      },
    ]
    for (const change of changes) {
      const value = fixture()
      change(value)
      const { actions } = setup(value)
      await expect(
        actions.getValidatorShareBinding({
          validatorId: 4294967295n,
          blockHash: hash,
        }),
      ).rejects.toThrow()
    }
  })
  it('keeps unbound, unsupported and unknown states explicit', async () => {
    for (const status of ['unbound', 'unsupportedRuntime', 'invalidBinding']) {
      const value = fixture()
      Object.assign(value.binding, {
        status,
        shareAddress: null,
        shareCodeHash: null,
        supportedArtifact: null,
        ...(status === 'unsupportedRuntime' ? { positionOwner: null } : {}),
      })
      Object.assign(value.validator, {
        registration: 'unknown',
        operator: null,
        marks: null,
        inactive: null,
      })
      const { actions } = setup(value)
      await expect(
        actions.getValidatorShareBinding({ validatorId: 4294967295n }),
      ).resolves.toEqual(value)
    }
  })
  it('preserves renounced ownership and distinguishes probation from inactivity', async () => {
    for (const [marks, inactive] of [
      ['0', false],
      ['16', false],
      ['32', false],
      ['1', true],
      ['64', true],
      ['128', true],
      ['256', true],
    ] as const) {
      const value = fixture()
      value.binding.positionOwner = `0x${'00'.repeat(20)}`
      Object.assign(value.validator, {
        registration: 'registered',
        marks,
        inactive,
      })
      const { actions } = setup(value)
      await expect(
        actions.getValidatorShareBinding({ validatorId: 4294967295n }),
      ).resolves.toEqual(value)
    }
  })
})
