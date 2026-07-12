import type {
  Groth16Proof,
  PrivacyProofEngine,
  PrivacyProofEngineResult,
  PrivacyProofRequest,
} from './prover.js'

interface ProofRequestMessageV1 {
  type: 'diesis-privacy-proof-request-v1'
  id: number
  request: PrivacyProofRequest
}

interface ProofResultMessageV1 {
  type: 'diesis-privacy-proof-result-v1'
  id: number
  result: PrivacyProofEngineResult
}

interface ProofErrorMessageV1 {
  type: 'diesis-privacy-proof-error-v1'
  id: number
  error?: unknown
}

export type PrivacyProofWorkerRequestV1 = ProofRequestMessageV1
export type PrivacyProofWorkerResponseV1 =
  | ProofResultMessageV1
  | ProofErrorMessageV1

export interface PrivacyWorkerLike {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void
  terminate?(): void
}

export interface DisposablePrivacyProofEngine extends PrivacyProofEngine {
  dispose(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProof(value: unknown): value is Groth16Proof {
  return (
    isRecord(value) &&
    typeof value.protocol === 'string' &&
    typeof value.curve === 'string' &&
    Array.isArray(value.pi_a) &&
    Array.isArray(value.pi_b) &&
    Array.isArray(value.pi_c)
  )
}

function parseResult(value: unknown): PrivacyProofEngineResult | undefined {
  if (
    !isRecord(value) ||
    !isProof(value.proof) ||
    !Array.isArray(value.publicSignals) ||
    !value.publicSignals.every((signal) => typeof signal === 'string') ||
    typeof value.verified !== 'boolean'
  ) {
    return undefined
  }
  return value as unknown as PrivacyProofEngineResult
}

export function createWorkerProofEngine(
  worker: PrivacyWorkerLike,
): DisposablePrivacyProofEngine {
  let nextId = 1
  let disposed = false
  const pending = new Map<
    number,
    {
      resolve(value: PrivacyProofEngineResult): void
      reject(reason: Error): void
    }
  >()

  const onMessage = (event: MessageEvent): void => {
    const message = event.data as unknown
    if (!isRecord(message) || !Number.isSafeInteger(message.id)) return
    const id = message.id as number
    const request = pending.get(id)
    if (request === undefined) return
    if (message.type === 'diesis-privacy-proof-result-v1') {
      const result = parseResult(message.result)
      if (result !== undefined) {
        pending.delete(id)
        request.resolve(result)
        return
      }
    }
    if (message.type === 'diesis-privacy-proof-error-v1') {
      pending.delete(id)
      request.reject(new Error('privacy proof worker failed'))
    }
  }
  worker.addEventListener('message', onMessage)

  return {
    proveAndVerify(request) {
      if (disposed)
        return Promise.reject(new Error('privacy proof worker disposed'))
      const id = nextId
      nextId += 1
      const wasm = request.wasm.slice()
      const zkey = request.zkey.slice()
      const message: PrivacyProofWorkerRequestV1 = {
        type: 'diesis-privacy-proof-request-v1',
        id,
        request: { ...request, wasm, zkey },
      }
      const response = new Promise<PrivacyProofEngineResult>(
        (resolve, reject) => {
          pending.set(id, { resolve, reject })
        },
      )
      try {
        worker.postMessage(message, [wasm.buffer, zkey.buffer])
      } catch {
        pending.delete(id)
        return Promise.reject(new Error('privacy proof worker failed'))
      }
      return response
    },
    dispose() {
      if (disposed) return
      disposed = true
      worker.removeEventListener('message', onMessage)
      for (const request of pending.values()) {
        request.reject(new Error('privacy proof worker disposed'))
      }
      pending.clear()
      worker.terminate?.()
    },
  }
}
