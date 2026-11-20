// Minimal Merkle Patricia trie builder used only to produce test proofs.
import { bytesToHex, hexToBytes, keccak256, type Hex } from 'viem'

function rlpLength(length: number, offset: number): Uint8Array {
  if (length < 56) return Uint8Array.of(offset + length)
  const bytes: number[] = []
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256)
  return Uint8Array.of(offset + 55 + bytes.length, ...bytes)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function rlpString(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && bytes[0]! < 0x80) return bytes
  return concat([rlpLength(bytes.length, 0x80), bytes])
}

/** Encode a list of already encoded items. */
export function rlpList(items: Uint8Array[]): Uint8Array {
  const payload = concat(items)
  return concat([rlpLength(payload.length, 0xc0), payload])
}

export function rlpInteger(value: bigint): Uint8Array {
  if (value === 0n) return rlpString(new Uint8Array())
  let hex = value.toString(16)
  if (hex.length % 2) hex = '0' + hex
  return rlpString(hexToBytes(`0x${hex}`))
}

const nibbles = (bytes: Uint8Array) =>
  [...bytes].flatMap((b) => [b >> 4, b & 15])

export function hexPrefix(path: number[], leaf: boolean): Uint8Array {
  const odd = path.length % 2
  const all = odd ? [(leaf ? 2 : 0) + 1, ...path] : [leaf ? 2 : 0, 0, ...path]
  const out = new Uint8Array(all.length / 2)
  for (let i = 0; i < out.length; i++)
    out[i] = all[2 * i]! * 16 + all[2 * i + 1]!
  return out
}

type Entry = { key: number[]; value: Uint8Array }
type Node =
  | { kind: 'leaf'; path: number[]; value: Uint8Array }
  | { kind: 'extension'; path: number[]; child: Node }
  | { kind: 'branch'; children: (Node | undefined)[]; value?: Uint8Array }

function make(entries: Entry[], depth: number): Node {
  if (entries.length === 1)
    return {
      kind: 'leaf',
      path: entries[0]!.key.slice(depth),
      value: entries[0]!.value,
    }
  let prefix = 0
  for (;;) {
    const nibble = entries[0]!.key[depth + prefix]
    if (
      nibble === undefined ||
      !entries.every((e) => e.key[depth + prefix] === nibble)
    )
      break
    prefix++
  }
  if (prefix > 0)
    return {
      kind: 'extension',
      path: entries[0]!.key.slice(depth, depth + prefix),
      child: make(entries, depth + prefix),
    }
  const children = Array.from({ length: 16 }, (_, n) => {
    const group = entries.filter((e) => e.key[depth] === n)
    return group.length ? make(group, depth + 1) : undefined
  })
  return {
    kind: 'branch',
    children,
    value: entries.find((e) => e.key.length === depth)?.value,
  }
}

function encode(node: Node): Uint8Array {
  const reference = (child: Node) => {
    const encoded = encode(child)
    return encoded.length < 32
      ? encoded
      : rlpString(hexToBytes(keccak256(encoded)))
  }
  if (node.kind === 'leaf')
    return rlpList([
      rlpString(hexPrefix(node.path, true)),
      rlpString(node.value),
    ])
  if (node.kind === 'extension')
    return rlpList([
      rlpString(hexPrefix(node.path, false)),
      reference(node.child),
    ])
  return rlpList([
    ...node.children.map((c) =>
      c ? reference(c) : rlpString(new Uint8Array()),
    ),
    rlpString(node.value ?? new Uint8Array()),
  ])
}

/** Root node first, then each hashed node on the path to `key`. */
function proofFor(root: Node, key: number[]): Hex[] {
  const nodes = [bytesToHex(encode(root))]
  let node: Node | undefined = root
  let rest = key
  while (node) {
    let next: Node | undefined
    if (node.kind === 'extension' && node.path.every((n, i) => rest[i] === n)) {
      next = node.child
      rest = rest.slice(node.path.length)
    } else if (node.kind === 'branch' && rest.length > 0) {
      next = node.children[rest[0]!]
      rest = rest.slice(1)
    }
    if (next) {
      const encoded = encode(next)
      if (encoded.length >= 32) nodes.push(bytesToHex(encoded))
    }
    node = next
  }
  return nodes
}

/** Build a trie from raw nibble keys and return its root and the proof for `target`. */
export function trie(entries: Entry[], target?: number[]) {
  const root = make(entries, 0)
  return {
    root: keccak256(encode(root)),
    proof: target ? proofFor(root, target) : [],
  }
}

/** Secure trie keyed by keccak(key), as used by Ethereum account and storage tries. */
export function secureTrie(
  entries: { key: Hex; value: Uint8Array }[],
  target?: Hex,
) {
  const hashed = (key: Hex) => nibbles(hexToBytes(keccak256(key)))
  return trie(
    entries.map((e) => ({ key: hashed(e.key), value: e.value })),
    target && hashed(target),
  )
}

/** Root of a trie with UTF-8 keys and values, for comparing with known vectors. */
export function rawTrieRoot(entries: { key: string; value: string }[]): Hex {
  const encoder = new TextEncoder()
  return trie(
    entries.map((e) => ({
      key: nibbles(encoder.encode(e.key)),
      value: encoder.encode(e.value),
    })),
  ).root
}
