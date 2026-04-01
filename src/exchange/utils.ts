import { keccak256, encodePacked, type Address, type Hex } from 'viem'

/** Compute the canonical market ID from base token, quote token, and market type. */
export function marketId(baseToken: Address, quoteToken: Address, marketType: number = 0): Hex {
  return keccak256(encodePacked(['address', 'address', 'uint8'], [baseToken, quoteToken, marketType]))
}
