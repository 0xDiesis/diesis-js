import { hexToBytes, keccak256, toHex, type Address, type Hex } from 'viem'

/** Envelope version of the MPT `diesis_getStateProof` response. */
export const STATE_PROOF_SCHEMA_VERSION = 2
/** Most distinct storage slots in one request. */
export const MAX_STATE_PROOF_STORAGE_KEYS = 32

const EMPTY_ROOT_HASH =
  '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'
const EMPTY_CODE_HASH =
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
// One branch per key nibble plus a terminal node; each node fits within 1 KiB.
const MAX_PROOF_NODES = 65
const MAX_PROOF_NODE_BYTES = 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_UINT64 = 0xffffffffffffffffn

export interface StateProofRequest {
  blockNumber: bigint
  address: Address
  /** 32-byte slots, verified and returned in this order. */
  storageKeys?: readonly Hex[]
}

/** EIP-1186 storage path from Reth, in request order. */
export interface StateProofStorageEntry {
  key: Hex
  value: Hex
  proof: Hex[]
}

/** EIP-1186 account and storage proof from Reth. */
export interface AccountProof {
  address: Address
  nonce: Hex
  balance: Hex
  codeHash: Hex
  storageHash: Hex
  accountProof: Hex[]
  storageProof: StateProofStorageEntry[]
}

/**
 * Unverified `diesis_getStateProof` response: the canonical header, the raw
 * quorum-signed MPQ7 certificate and the MPT proof for the selected state.
 */
export interface StateProof {
  schemaVersion: typeof STATE_PROOF_SCHEMA_VERSION
  blockHash: Hex
  stateRoot: Hex
  /** Canonical RLP header whose Keccak hash is `blockHash`. */
  canonicalHeader: Hex
  /** Framed MPQ7 certificate. Verify it with `diesis-state-proof-verify`. */
  checkpoint: Hex
  proof: AccountProof
}

/** Account and storage values authenticated against the trusted block hash. */
export interface VerifiedStateProof {
  blockNumber: bigint
  blockHash: Hex
  stateRoot: Hex
  timestamp: bigint
  address: Address
  /** `null` when the proof shows the account does not exist. */
  account: {
    nonce: bigint
    balance: bigint
    codeHash: Hex
    storageRoot: Hex
  } | null
  /** Requested slots in request order. Proven absence is zero. */
  storage: { slot: Hex; value: bigint }[]
}

const addressHex = /^0x[0-9a-fA-F]{40}$/
const wordHex = /^0x[0-9a-fA-F]{64}$/
const byteHex = /^0x(?:[0-9a-fA-F]{2})+$/
const quantity = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/
const matches = (value: unknown, pattern: RegExp): value is Hex =>
  typeof value === 'string' && pattern.test(value)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

/** Validate a selection and encode the node's request object. */
export function stateProofRequest({
  blockNumber,
  address,
  storageKeys = [],
}: StateProofRequest) {
  if (
    typeof blockNumber !== 'bigint' ||
    blockNumber < 0n ||
    blockNumber > MAX_UINT64
  )
    throw new Error('State proof height must be a uint64')
  if (!matches(address, addressHex))
    throw new Error('Invalid state proof address')
  if (
    !Array.isArray(storageKeys) ||
    storageKeys.length > MAX_STATE_PROOF_STORAGE_KEYS ||
    !storageKeys.every((key) => matches(key, wordHex)) ||
    new Set(storageKeys.map((key) => key.toLowerCase())).size !==
      storageKeys.length
  )
    throw new Error('Expected up to 32 distinct 32-byte storage keys')
  return {
    blockNumber: `0x${blockNumber.toString(16)}` as Hex,
    address,
    storageKeys: [...storageKeys],
  }
}

function isPath(value: unknown): value is Hex[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PROOF_NODES &&
    value.every(
      (node) =>
        typeof node === 'string' &&
        node.length <= 2 + 2 * MAX_PROOF_NODE_BYTES &&
        matches(node, byteHex),
    )
  )
}

/**
 * Check the response shape and that it answers the request. This does not
 * authenticate anything; call {@link verifyStateProof} before using values.
 */
export function parseStateProof(
  value: unknown,
  request: StateProofRequest,
): StateProof {
  const selection = stateProofRequest(request)
  if (
    !record(value) ||
    value.schemaVersion !== STATE_PROOF_SCHEMA_VERSION ||
    !exactKeys(value, [
      'schemaVersion',
      'blockHash',
      'stateRoot',
      'canonicalHeader',
      'checkpoint',
      'proof',
    ])
  )
    throw new Error('Expected a schemaVersion 2 MPT state proof')
  const proof = value.proof
  if (
    !matches(value.blockHash, wordHex) ||
    !matches(value.stateRoot, wordHex) ||
    !matches(value.canonicalHeader, byteHex) ||
    !matches(value.checkpoint, byteHex) ||
    !value.checkpoint.toLowerCase().startsWith('0x4d505137') ||
    !record(proof) ||
    !exactKeys(proof, [
      'address',
      'nonce',
      'balance',
      'codeHash',
      'storageHash',
      'accountProof',
      'storageProof',
    ]) ||
    !matches(proof.address, addressHex) ||
    !same(proof.address, selection.address) ||
    !matches(proof.nonce, quantity) ||
    BigInt(proof.nonce) > MAX_UINT64 ||
    !matches(proof.balance, quantity) ||
    !matches(proof.codeHash, wordHex) ||
    !matches(proof.storageHash, wordHex) ||
    !isPath(proof.accountProof) ||
    !Array.isArray(proof.storageProof) ||
    proof.storageProof.length !== selection.storageKeys.length
  )
    throw new Error('Invalid MPT state proof response')
  for (const [i, entry] of proof.storageProof.entries()) {
    if (
      !record(entry) ||
      !exactKeys(entry, ['key', 'value', 'proof']) ||
      !matches(entry.key, /^0x[0-9a-fA-F]{1,64}$/) ||
      BigInt(entry.key) !== BigInt(selection.storageKeys[i]!) ||
      !matches(entry.value, quantity) ||
      !isPath(entry.proof)
    )
      throw new Error('Invalid or out-of-order MPT storage proof')
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > MAX_RESPONSE_BYTES
  )
    throw new Error('State proof exceeds the response limit')
  return value as unknown as StateProof
}

/**
 * Authenticate the header, account and requested slots against `blockHash`.
 *
 * The caller must obtain `blockHash` from its own trusted source, such as a
 * finalized header it already follows or a certificate verified with
 * `diesis-state-proof-verify --mpt-trust-anchor`. This function does not check
 * the quorum signatures in `checkpoint`, so a hash copied from the same
 * response proves nothing.
 */
export function verifyStateProof(
  value: StateProof,
  request: StateProofRequest,
  trusted: { blockHash: Hex },
): VerifiedStateProof {
  const response = parseStateProof(value, request)
  const selection = stateProofRequest(request)
  if (!matches(trusted?.blockHash, wordHex))
    throw new Error('A trusted 32-byte block hash is required')
  const header = decodeHeader(hexToBytes(response.canonicalHeader))
  if (
    !same(keccak256(response.canonicalHeader), trusted.blockHash) ||
    !same(response.blockHash, trusted.blockHash) ||
    header.number !== request.blockNumber ||
    !same(header.stateRoot, response.stateRoot)
  )
    throw new Error('Canonical header differs from the trusted block')
  const proof = response.proof
  const leaf = verifyPath(
    header.stateRoot,
    nibbles(hexToBytes(keccak256(selection.address))),
    proof.accountProof.map((node) => hexToBytes(node)),
  )
  const account = leaf && decodeAccount(leaf)
  const fields = account ?? {
    nonce: 0n,
    balance: 0n,
    storageRoot: EMPTY_ROOT_HASH,
    codeHash: EMPTY_CODE_HASH,
  }
  if (
    fields.nonce !== BigInt(proof.nonce) ||
    fields.balance !== BigInt(proof.balance) ||
    !same(fields.storageRoot, proof.storageHash) ||
    !same(fields.codeHash, proof.codeHash)
  )
    throw new Error('MPT account fields differ from the proven account')
  const storage = selection.storageKeys.map((slot, i) => {
    const entry = proof.storageProof[i]!
    const encoded = verifyPath(
      fields.storageRoot,
      nibbles(hexToBytes(keccak256(slot))),
      entry.proof.map((node) => hexToBytes(node)),
    )
    const proven = encoded === null ? 0n : decodeStorage(encoded)
    if (proven !== BigInt(entry.value))
      throw new Error('MPT storage value differs from the proven slot')
    return { slot, value: proven }
  })
  return {
    blockNumber: header.number,
    blockHash: trusted.blockHash,
    stateRoot: header.stateRoot,
    timestamp: header.timestamp,
    address: selection.address,
    account,
    storage,
  }
}

// --- Canonical RLP -----------------------------------------------------------

interface RlpItem {
  list: boolean
  /** Payload bytes for a string; the whole encoded item for a list. */
  payload: Uint8Array
  /** The whole encoded item. */
  raw: Uint8Array
}

function invalid(): never {
  throw new Error('Invalid MPT proof encoding')
}

function readLength(bytes: Uint8Array, start: number, size: number) {
  if (size > 4 || start + size > bytes.length || bytes[start] === 0) invalid()
  let length = 0
  for (let i = 0; i < size; i++) length = length * 256 + bytes[start + i]!
  if (length < 56) invalid()
  return length
}

/** Decode one canonical RLP item at `offset` and return it with its end. */
function rlpItem(bytes: Uint8Array, offset: number): [RlpItem, number] {
  const prefix = bytes[offset]
  if (prefix === undefined) invalid()
  let list = false
  let start: number
  let length: number
  if (prefix < 0x80) {
    start = offset
    length = 1
  } else if (prefix <= 0xb7) {
    start = offset + 1
    length = prefix - 0x80
    if (length === 1 && (bytes[start] ?? 0) < 0x80) invalid()
  } else if (prefix <= 0xbf) {
    length = readLength(bytes, offset + 1, prefix - 0xb7)
    start = offset + 1 + prefix - 0xb7
  } else if (prefix <= 0xf7) {
    list = true
    start = offset + 1
    length = prefix - 0xc0
  } else {
    list = true
    length = readLength(bytes, offset + 1, prefix - 0xf7)
    start = offset + 1 + prefix - 0xf7
  }
  const end = start + length
  if (end > bytes.length) invalid()
  const raw = bytes.subarray(offset, end)
  return [{ list, payload: list ? raw : bytes.subarray(start, end), raw }, end]
}

/** Decode an exact RLP list into its raw items. */
function rlpList(bytes: Uint8Array): RlpItem[] {
  const [outer, end] = rlpItem(bytes, 0)
  if (!outer.list || end !== bytes.length) invalid()
  const headerSize = bytes[0]! <= 0xf7 ? 1 : 1 + bytes[0]! - 0xf7
  const items: RlpItem[] = []
  for (let offset = headerSize; offset < end; ) {
    const [item, next] = rlpItem(bytes, offset)
    items.push(item)
    offset = next
  }
  return items
}

function rlpString(item: RlpItem): Uint8Array {
  if (item.list) invalid()
  return item.payload
}

function rlpInteger(item: RlpItem, maxBytes: number): bigint {
  const bytes = rlpString(item)
  if (bytes.length > maxBytes || bytes[0] === 0) invalid()
  return bytes.length === 0 ? 0n : BigInt(toHex(bytes))
}

function rlpWord(item: RlpItem): Hex {
  const bytes = rlpString(item)
  if (bytes.length !== 32) invalid()
  return toHex(bytes)
}

function decodeHeader(bytes: Uint8Array) {
  const fields = rlpList(bytes)
  // Pre-London headers have 15 fields; later forks append fields.
  if (fields.length < 15) invalid()
  return {
    stateRoot: rlpWord(fields[3]!),
    number: rlpInteger(fields[8]!, 8),
    timestamp: rlpInteger(fields[11]!, 8),
  }
}

function decodeAccount(encoded: Uint8Array) {
  const fields = rlpList(encoded)
  if (fields.length !== 4) throw new Error('Invalid MPT account encoding')
  return {
    nonce: rlpInteger(fields[0]!, 8),
    balance: rlpInteger(fields[1]!, 32),
    storageRoot: rlpWord(fields[2]!),
    codeHash: rlpWord(fields[3]!),
  }
}

function decodeStorage(encoded: Uint8Array): bigint {
  const [item, end] = rlpItem(encoded, 0)
  if (end !== encoded.length) invalid()
  const value = rlpInteger(item, 32)
  if (value === 0n) throw new Error('Invalid MPT storage encoding')
  return value
}

// --- Merkle Patricia path ----------------------------------------------------

function nibbles(bytes: Uint8Array): number[] {
  const out: number[] = []
  for (const byte of bytes) out.push(byte >> 4, byte & 0x0f)
  return out
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

function startsWith(key: number[], prefix: number[]) {
  return prefix.length <= key.length && prefix.every((n, i) => key[i] === n)
}

function decodePath(item: RlpItem): { leaf: boolean; path: number[] } {
  const bytes = rlpString(item)
  const flag = bytes[0]
  if (flag === undefined) invalid()
  const odd = (flag & 0x10) !== 0
  const padding = flag & 0x0f
  const length = (bytes.length - 1) * 2 + (odd ? 1 : 0)
  if (flag >= 0x40 || (!odd && padding !== 0) || length >= MAX_PROOF_NODES)
    invalid()
  const packed = nibbles(bytes.subarray(1))
  return {
    leaf: (flag & 0x20) !== 0,
    path: odd ? [padding, ...packed] : packed,
  }
}

type Child = { inline: Uint8Array } | { hash: Hex }

function childReference(item: RlpItem): Child {
  const raw = item.raw
  if (raw[0] === 0xa0 && raw.length === 33)
    return { hash: toHex(raw.subarray(1)) }
  if (raw[0]! >= 0xc0 && raw[0]! <= 0xde && raw.length < 32)
    return { inline: raw }
  return invalid()
}

const isEmpty = (item: RlpItem) => item.raw.length === 1 && item.raw[0] === 0x80

/**
 * Follow `key` from `root` through `nodes` (root first, then hashed descendants
 * in order). Return the leaf value, or `null` for proven absence. The path must
 * end at a leaf or a missing child, with no extra nodes.
 */
function verifyPath(
  root: Hex,
  key: number[],
  nodes: Uint8Array[],
): Uint8Array | null {
  if (
    nodes.length > MAX_PROOF_NODES ||
    nodes.some((node) => node.length > MAX_PROOF_NODE_BYTES)
  )
    throw new Error('MPT proof exceeds its node budget')
  if (same(root, EMPTY_ROOT_HASH)) {
    if (
      nodes.length === 0 ||
      (nodes.length === 1 && nodes[0]!.length === 1 && nodes[0]![0] === 0x80)
    )
      return null
    throw new Error('Invalid MPT proof path')
  }
  let next = 0
  let encoded = nodes[next++]
  if (!encoded || !same(keccak256(encoded), root))
    throw new Error('Invalid MPT proof path')
  let followsExtension = false
  let value: Uint8Array | null
  for (;;) {
    const fields = rlpList(encoded)
    let child: Child
    if (fields.length === 2 && !followsExtension) {
      const { leaf, path } = decodePath(fields[0]!)
      if (leaf) {
        const data = rlpString(fields[1]!)
        if (path.length !== key.length || data.length === 0)
          throw new Error('Invalid MPT proof path')
        value = startsWith(key, path) ? data : null
        break
      }
      if (path.length === 0 || path.length >= key.length)
        throw new Error('Invalid MPT proof path')
      child = childReference(fields[1]!)
      if (!startsWith(key, path)) {
        value = null
        break
      }
      key = key.slice(path.length)
      followsExtension = true
    } else if (fields.length === 17 && isEmpty(fields[16]!)) {
      const nibble = key[0]
      if (nibble === undefined) throw new Error('Invalid MPT proof path')
      let occupied = 0
      let selected: Child | undefined
      for (const [index, item] of fields.slice(0, 16).entries()) {
        if (isEmpty(item)) continue
        const reference = childReference(item)
        occupied++
        if (index === nibble) selected = reference
      }
      if (occupied < 2) throw new Error('Invalid MPT proof path')
      if (!selected) {
        value = null
        break
      }
      child = selected
      key = key.slice(1)
      followsExtension = false
    } else throw new Error('Invalid MPT proof path')
    if ('inline' in child) {
      const candidate = nodes[next]
      if (candidate && equalBytes(candidate, child.inline)) next++
      encoded = child.inline
    } else {
      const candidate = nodes[next++]
      if (
        !candidate ||
        candidate.length < 32 ||
        !same(keccak256(candidate), child.hash)
      )
        throw new Error('Invalid MPT proof path')
      encoded = candidate
    }
  }
  if (next !== nodes.length) throw new Error('Invalid MPT proof path')
  return value
}
