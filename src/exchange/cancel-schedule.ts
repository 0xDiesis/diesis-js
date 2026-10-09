import type { Hex } from 'viem'

/** Arm one bounded, canonical cancel-on-disconnect schedule. */
export type ArmCancelScheduleAction = {
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
export type RenewCancelScheduleAction = {
  kind: 'renewCancelSchedule'
  clientActionId: Hex
  scheduleId: Hex
  expectedRenewalCounter: bigint
  newDeadline: bigint
}

/** Disarm a schedule only when its canonical counter still matches. */
export type DisarmCancelScheduleAction = {
  kind: 'disarmCancelSchedule'
  clientActionId: Hex
  scheduleId: Hex
  expectedRenewalCounter: bigint
}

/** Permissionlessly trigger an eligible bounded schedule chunk. */
export type TriggerCancelScheduleAction = {
  kind: 'triggerCancelSchedule'
  clientActionId: Hex
  scheduleId: Hex
}

export type CancelScheduleAction =
  | ArmCancelScheduleAction
  | RenewCancelScheduleAction
  | DisarmCancelScheduleAction
  | TriggerCancelScheduleAction

type WithoutKind<T extends { kind: string }> = Omit<T, 'kind'>

export function armCancelSchedule(
  parameters: WithoutKind<ArmCancelScheduleAction>,
): ArmCancelScheduleAction {
  return { kind: 'armCancelSchedule', ...parameters }
}

export function renewCancelSchedule(
  parameters: WithoutKind<RenewCancelScheduleAction>,
): RenewCancelScheduleAction {
  return { kind: 'renewCancelSchedule', ...parameters }
}

export function disarmCancelSchedule(
  parameters: WithoutKind<DisarmCancelScheduleAction>,
): DisarmCancelScheduleAction {
  return { kind: 'disarmCancelSchedule', ...parameters }
}

export function triggerCancelSchedule(
  parameters: WithoutKind<TriggerCancelScheduleAction>,
): TriggerCancelScheduleAction {
  return { kind: 'triggerCancelSchedule', ...parameters }
}
