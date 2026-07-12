import {
  poseidon2,
  poseidon3,
  poseidon4,
  poseidon5,
  poseidon6,
  poseidon7,
  poseidon8,
  poseidon9,
} from 'poseidon-lite'

import { assertFieldElement } from './field.js'

export async function poseidonHash(inputs: readonly bigint[]): Promise<bigint> {
  for (const input of inputs) assertFieldElement(input)
  const values = [...inputs]
  const value = (() => {
    switch (inputs.length) {
      case 2:
        return poseidon2(values)
      case 3:
        return poseidon3(values)
      case 4:
        return poseidon4(values)
      case 5:
        return poseidon5(values)
      case 6:
        return poseidon6(values)
      case 7:
        return poseidon7(values)
      case 8:
        return poseidon8(values)
      case 9:
        return poseidon9(values)
      default:
        throw new RangeError('Poseidon input arity must be between 2 and 9')
    }
  })()
  return assertFieldElement(value)
}
