import { hexToBytes, type Hex } from 'viem'

export const UINT64_MAX = (1n << 64n) - 1n
export const UINT256_MAX = (1n << 256n) - 1n

export class Writer {
  readonly bytes: number[] = []

  push(bytes: Uint8Array): void {
    this.bytes.push(...bytes)
  }

  u8(value: number, name: string): void {
    integerNumber(value, 0xff, name)
    this.bytes.push(value)
  }

  u16(value: number, name: string): void {
    integerNumber(value, 0xffff, name)
    this.bytes.push(value >>> 8, value & 0xff)
  }

  u32(value: number, name: string): void {
    integerNumber(value, 0xffff_ffff, name)
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    )
  }

  u64(value: bigint, name: string): void {
    this.big(value, 8, UINT64_MAX, name)
  }

  u256(value: bigint, name: string): void {
    this.big(value, 32, UINT256_MAX, name)
  }

  private big(value: bigint, width: number, max: bigint, name: string): void {
    if (typeof value !== 'bigint' || value < 0n || value > max) {
      throw new Error(`${name} is outside uint${width * 8}`)
    }
    const bytes = new Uint8Array(width)
    let remaining = value
    for (let index = width - 1; index >= 0; index -= 1) {
      bytes[index] = Number(remaining & 0xffn)
      remaining >>= 8n
    }
    this.push(bytes)
  }

  output(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

export class Reader {
  offset = 0

  constructor(readonly bytes: Uint8Array) {}

  take(length: number, name: string): Uint8Array {
    const end = this.offset + length
    if (!Number.isSafeInteger(end) || end > this.bytes.length) {
      throw new Error(`truncated ${name}`)
    }
    const value = this.bytes.slice(this.offset, end)
    this.offset = end
    return value
  }

  u8(name: string): number {
    return this.take(1, name)[0]!
  }

  u16(name: string): number {
    const value = this.take(2, name)
    return value[0]! * 0x100 + value[1]!
  }

  u64(name: string): bigint {
    return this.big(8, name)
  }

  u256(name: string): bigint {
    return this.big(32, name)
  }

  private big(width: number, name: string): bigint {
    let value = 0n
    for (const byte of this.take(width, name)) {
      value = (value << 8n) | BigInt(byte)
    }
    return value
  }
}

export function integerNumber(value: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} is outside its unsigned integer range`)
  }
}

export function fixedBytes(
  value: Hex,
  length: number,
  name: string,
): Uint8Array {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${name} must be hexadecimal`)
  }
  const bytes = hexToBytes(value)
  if (bytes.length !== length) {
    throw new Error(`${name} must be ${length} bytes`)
  }
  return bytes
}

export function nonzeroBytes(
  value: Hex,
  length: number,
  name: string,
): Uint8Array {
  const bytes = fixedBytes(value, length, name)
  if (bytes.every((byte) => byte === 0)) {
    throw new Error(`${name} must be nonzero`)
  }
  return bytes
}
