import type { Hex } from 'viem'

/** Arm one bounded, canonical cancel-on-disconnect schedule. */
export type ArmCancelScheduleActionV2 = {
  kind: 'armCancelSchedule'
  clientActionId: Hex
  scheduleId: Hex
  authorizationExpiry: bigint
  cancellationDeadline: bigint
  expectedRenewalCounter: bigint
  maxOrdersPerTrigger: number
  marketIds: readonly Hex[]
}

/** Renew a schedule only when its canonical counter still matches. */
export type RenewCancelScheduleActionV2 = {
  kind: 'renewCancelSchedule'
  clientActionId: Hex
  scheduleId: Hex
  expectedRenewalCounter: bigint
  newDeadline: bigint
}

/** Disarm a schedule only when its canonical counter still matches. */
export type DisarmCancelScheduleActionV2 = {
  kind: 'disarmCancelSchedule'
  clientActionId: Hex
  scheduleId: Hex
  expectedRenewalCounter: bigint
}

/** Permissionlessly trigger an eligible bounded schedule chunk. */
export type TriggerCancelScheduleActionV2 = {
  kind: 'triggerCancelSchedule'
  clientActionId: Hex
  scheduleId: Hex
}

export type CancelScheduleActionV2 =
  | ArmCancelScheduleActionV2
  | RenewCancelScheduleActionV2
  | DisarmCancelScheduleActionV2
  | TriggerCancelScheduleActionV2

type WithoutKind<T extends { kind: string }> = Omit<T, 'kind'>

export function armCancelScheduleV2(
  parameters: WithoutKind<ArmCancelScheduleActionV2>,
): ArmCancelScheduleActionV2 {
  return { kind: 'armCancelSchedule', ...parameters }
}

export function renewCancelScheduleV2(
  parameters: WithoutKind<RenewCancelScheduleActionV2>,
): RenewCancelScheduleActionV2 {
  return { kind: 'renewCancelSchedule', ...parameters }
}

export function disarmCancelScheduleV2(
  parameters: WithoutKind<DisarmCancelScheduleActionV2>,
): DisarmCancelScheduleActionV2 {
  return { kind: 'disarmCancelSchedule', ...parameters }
}

export function triggerCancelScheduleV2(
  parameters: WithoutKind<TriggerCancelScheduleActionV2>,
): TriggerCancelScheduleActionV2 {
  return { kind: 'triggerCancelSchedule', ...parameters }
}
