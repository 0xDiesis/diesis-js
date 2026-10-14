import { UnknownRpcError } from 'viem'

/** Version 1 signed-action failures. Retry/admission authority is deliberately conservative. */
export const signedActionErrorReasons = [
  'invalid_signed_action',
  'signed_action_route_mismatch',
  'signed_action_expired',
  'exchange_relayer_unconfigured',
  'exchange_replay_conflict',
  'exchange_principal_capacity',
  'exchange_global_capacity',
  'exchange_tracker_unavailable',
  'exchange_admission_failed',
  'exchange_submission_outcome_unknown',
] as const
export type SignedActionErrorReason = (typeof signedActionErrorReasons)[number]
export interface DecodedSignedActionError {
  status: 'known' | 'unknown'
  original: unknown
  code: unknown
  message: unknown
  data: unknown
  cause: unknown
  reason?: SignedActionErrorReason
  retryable: false
  admission: 'unknown'
}
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.value
  } catch {
    return undefined
  }
}
/** Accept raw JSON-RPC errors or viem cause chains. Never dispatches or interprets English diagnostics. */
export function decodeSignedActionError(
  original: unknown,
): DecodedSignedActionError {
  let raw = original
  const seen = new Set<unknown>()
  for (
    let depth = 0;
    depth < 16 && raw && typeof raw === 'object' && !seen.has(raw);
    depth++
  ) {
    seen.add(raw)
    // viem's provider wrapper owns a fallback (or copied HTTP) code,
    // but keeps the structured provider error only in its cause.
    let isTransportWrapper = false
    try {
      isTransportWrapper =
        raw instanceof UnknownRpcError && field(raw, 'data') === undefined
    } catch {
      // Hostile prototypes must not make unknown errors throw.
    }
    if (field(raw, 'code') !== undefined && !isTransportWrapper) break
    const cause = field(raw, 'cause')
    if (cause === undefined || depth === 15) break
    raw = cause
  }
  const code = field(raw, 'code'),
    message = field(raw, 'message'),
    data = field(raw, 'data')
  const result: DecodedSignedActionError = {
    status: 'unknown',
    original,
    code,
    message,
    data,
    cause: field(original, 'cause'),
    retryable: false,
    admission: 'unknown',
  }
  try {
    if (
      !data ||
      typeof data !== 'object' ||
      Object.getPrototypeOf(data) !== Object.prototype
    )
      return result
    if (Reflect.ownKeys(data).length !== 5) return result
    const keys = Object.keys(data).sort()
    if (keys.join(',') !== 'admission,kind,reason,retryable,version')
      return result
    if (
      keys.some(
        (key) =>
          !Object.getOwnPropertyDescriptor(data, key)?.enumerable ||
          !('value' in Object.getOwnPropertyDescriptor(data, key)!),
      )
    )
      return result
    const reason = field(data, 'reason')
    if (
      !Number.isInteger(code) ||
      typeof message !== 'string' ||
      field(data, 'version') !== 1 ||
      field(data, 'kind') !== 'signed-action-error' ||
      field(data, 'retryable') !== false ||
      field(data, 'admission') !== 'unknown' ||
      !signedActionErrorReasons.includes(reason as SignedActionErrorReason)
    )
      return result
    const expectedCode =
      reason === 'exchange_submission_outcome_unknown'
        ? -32017
        : typeof reason === 'string' &&
            [
              'invalid_signed_action',
              'signed_action_route_mismatch',
              'signed_action_expired',
            ].includes(reason)
          ? -32015
          : -32016
    if (code !== expectedCode) return result
    return {
      ...result,
      status: 'known',
      reason: reason as SignedActionErrorReason,
    }
  } catch {
    return result
  }
}
