import { buildPoseidon } from 'circomlibjs'

import { assertFieldElement } from './field.js'

const poseidonPromise = buildPoseidon()

export async function poseidonHash(inputs: readonly bigint[]): Promise<bigint> {
  for (const input of inputs) assertFieldElement(input)
  const instance = await poseidonPromise
  return assertFieldElement(instance.F.toObject(instance(inputs)))
}
