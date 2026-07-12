import { groth16 } from 'snarkjs'

import type { PrivacyProofEngineResult, PrivacyProofRequest } from './prover.js'
import type {
  PrivacyProofWorkerRequestV1,
  PrivacyProofWorkerResponseV1,
} from './worker.js'

export async function runSnarkjsProofRequest(
  request: PrivacyProofRequest,
): Promise<PrivacyProofEngineResult> {
  try {
    const { proof, publicSignals } = await groth16.fullProve(
      request.witness,
      request.wasm,
      request.zkey,
    )
    const verified = await groth16.verify(
      request.verificationKey,
      publicSignals,
      proof,
    )
    return { proof, publicSignals, verified }
  } catch {
    throw new Error('privacy proof generation failed')
  }
}

interface PrivacyWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<PrivacyProofWorkerRequestV1>) => void,
  ): void
  postMessage(message: PrivacyProofWorkerResponseV1): void
}

export function installPrivacyProofWorker(scope: PrivacyWorkerScope): void {
  scope.addEventListener('message', (event) => {
    const message = event.data
    if (message?.type !== 'diesis-privacy-proof-request-v1') return
    void runSnarkjsProofRequest(message.request).then(
      (result) =>
        scope.postMessage({
          type: 'diesis-privacy-proof-result-v1',
          id: message.id,
          result,
        }),
      () =>
        scope.postMessage({
          type: 'diesis-privacy-proof-error-v1',
          id: message.id,
        }),
    )
  })
}

const globalScope = globalThis as unknown as Partial<PrivacyWorkerScope>
if (
  typeof globalScope.addEventListener === 'function' &&
  typeof globalScope.postMessage === 'function' &&
  typeof globalThis.document === 'undefined'
) {
  installPrivacyProofWorker(globalScope as PrivacyWorkerScope)
}
