import { describe, expect, it } from 'vitest'

import {
  createWorkerProofEngine,
  type PrivacyWorkerLike,
} from '../../src/privacy/worker.js'

const proof = {
  protocol: 'groth16',
  curve: 'bn128',
  pi_a: ['1', '2', '1'],
  pi_b: [
    ['3', '4'],
    ['5', '6'],
    ['1', '0'],
  ],
  pi_c: ['7', '8', '1'],
}

class FakeWorker implements PrivacyWorkerLike {
  readonly messages: unknown[] = []
  readonly #listeners = new Set<(event: MessageEvent) => void>()

  postMessage(message: unknown): void {
    this.messages.push(message)
    const request = message as { id: number }
    queueMicrotask(() => {
      const event = {
        data: {
          type: 'diesis-privacy-proof-result-v1',
          id: request.id,
          result: { proof, publicSignals: ['1'], verified: true },
        },
      } as MessageEvent
      this.#listeners.forEach((listener) => listener(event))
    })
  }

  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void {
    if (type === 'message') this.#listeners.add(listener)
  }

  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void {
    if (type === 'message') this.#listeners.delete(listener)
  }
}

describe('privacy proof worker transport', () => {
  it('correlates proof requests without exposing worker implementation details', async () => {
    const worker = new FakeWorker()
    const engine = createWorkerProofEngine(worker)
    const result = await engine.proveAndVerify({
      witness: { spendSecret: 99n },
      wasm: Uint8Array.of(1),
      zkey: Uint8Array.of(2),
      verificationKey: {},
    })

    expect(result.verified).toBe(true)
    expect(worker.messages).toHaveLength(1)
    expect(worker.messages[0]).toMatchObject({
      type: 'diesis-privacy-proof-request-v1',
      id: 1,
    })
    engine.dispose()
  })

  it('redacts worker failure details', async () => {
    // A minimal worker that returns a hostile error string.
    const listeners = new Set<(event: MessageEvent) => void>()
    const worker: PrivacyWorkerLike = {
      postMessage(message) {
        const { id } = message as { id: number }
        queueMicrotask(() =>
          listeners.forEach((listener) =>
            listener({
              data: {
                type: 'diesis-privacy-proof-error-v1',
                id,
                error: 'spendSecret=99',
              },
            } as MessageEvent),
          ),
        )
      },
      addEventListener(_type, listener) {
        listeners.add(listener)
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener)
      },
    }
    const engine = createWorkerProofEngine(worker)
    const failed = engine.proveAndVerify({
      witness: { spendSecret: 99n },
      wasm: Uint8Array.of(1),
      zkey: Uint8Array.of(2),
      verificationKey: {},
    })
    await expect(failed).rejects.toThrow('privacy proof worker failed')
    await failed.catch((error: unknown) => {
      expect(String(error)).not.toContain('spendSecret=99')
    })
    engine.dispose()
  })
})
