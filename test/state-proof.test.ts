import { describe, expect, it, vi } from 'vitest'
import { bytesToHex, hexToBytes, keccak256, type Address, type Hex } from 'viem'
import vector from './fixtures/mpt-state-proof-epoch0.json' with { type: 'json' }
import { diesisPublicActions } from '../src/actions/public.js'
import {
  parseStateProof,
  verifyStateProof,
  type StateProof,
  type StateProofRequest,
} from '../src/state-proof.js'
import {
  hexPrefix,
  rawTrieRoot,
  rlpInteger,
  rlpList,
  rlpString,
  secureTrie,
} from './helpers/mpt-trie.js'

const word = (byte: number) => bytesToHex(new Uint8Array(32).fill(byte))
const EMPTY_ROOT =
  '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'
const EMPTY_CODE =
  '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'

const realRequest: StateProofRequest = {
  blockNumber: BigInt(vector.request.blockNumber),
  address: vector.request.address as Address,
  storageKeys: vector.request.storageKeys as Hex[],
}
const realProof = () => structuredClone(vector.response) as StateProof
const realHash = vector.expectedBlockHash as Hex

/** Flip one bit in the middle of a hex byte string. */
function tamper(hex: Hex): Hex {
  const bytes = hexToBytes(hex)
  bytes[Math.floor(bytes.length / 2)]! ^= 1
  return bytesToHex(bytes)
}

function header(stateRoot: Hex, number: bigint, timestamp = 1_700_000_000n) {
  const fields = [
    rlpString(hexToBytes(word(1))), // parent hash
    rlpString(hexToBytes(word(2))), // ommers hash
    rlpString(new Uint8Array(20)), // beneficiary
    rlpString(hexToBytes(stateRoot)),
    rlpString(hexToBytes(EMPTY_ROOT)),
    rlpString(hexToBytes(EMPTY_ROOT)),
    rlpString(new Uint8Array(256)), // logs bloom
    rlpInteger(0n),
    rlpInteger(number),
    rlpInteger(30_000_000n),
    rlpInteger(0n),
    rlpInteger(timestamp),
    rlpString(new Uint8Array()),
    rlpString(hexToBytes(word(3))),
    rlpString(new Uint8Array(8)),
    rlpInteger(7n), // base fee
  ]
  return bytesToHex(rlpList(fields))
}

const account = (
  nonce: bigint,
  balance: bigint,
  storageRoot: Hex,
  codeHash: Hex,
) =>
  rlpList([
    rlpInteger(nonce),
    rlpInteger(balance),
    rlpString(hexToBytes(storageRoot)),
    rlpString(hexToBytes(codeHash)),
  ])

/** A multi-account state with branch and extension nodes on both tries. */
function syntheticState() {
  const target = ('0x' + '11'.repeat(20)) as Address
  const slots = [word(3), word(4), word(5), word(6)]
  const values = [5n, 6n, 1n << 200n, 0xffn]
  const storageEntries = slots.map((key, i) => ({
    key,
    value: rlpInteger(values[i]!),
  }))
  const absentSlot = word(0)
  const storageRoot = secureTrie(storageEntries).root
  const codeHash = keccak256('0x6000')
  const others = Array.from({ length: 40 }, (_, i) => ({
    key: bytesToHex(new Uint8Array(20).fill(i + 0x20)),
    value: account(BigInt(i), BigInt(i) * 10n ** 18n, EMPTY_ROOT, EMPTY_CODE),
  }))
  const accounts = [
    ...others,
    { key: target, value: account(7n, 8n, storageRoot, codeHash) },
  ]
  const build = (address: Address, keys: Hex[]): StateProof => {
    const { root, proof } = secureTrie(accounts, address)
    const present = address.toLowerCase() === target.toLowerCase()
    const canonicalHeader = header(root, 9n)
    return {
      schemaVersion: 2,
      blockHash: keccak256(canonicalHeader),
      stateRoot: root,
      canonicalHeader,
      checkpoint: '0x4d50513700',
      proof: {
        address,
        nonce: present ? '0x7' : '0x0',
        balance: present ? '0x8' : '0x0',
        codeHash: present ? codeHash : EMPTY_CODE,
        storageHash: present ? storageRoot : EMPTY_ROOT,
        accountProof: proof,
        storageProof: keys.map((key) => {
          const index = slots.indexOf(key)
          return {
            key,
            value:
              present && index >= 0
                ? `0x${values[index]!.toString(16)}`
                : '0x0',
            proof: present ? secureTrie(storageEntries, key).proof : [],
          } as StateProof['proof']['storageProof'][number]
        }),
      },
    }
  }
  return { target, slots, values, absentSlot, codeHash, storageRoot, build }
}

describe('MPT test trie builder', () => {
  it('matches the known Ethereum root for do/dog/doge/horse', () => {
    expect(
      rawTrieRoot([
        { key: 'do', value: 'verb' },
        { key: 'dog', value: 'puppy' },
        { key: 'doge', value: 'coin' },
        { key: 'horse', value: 'stallion' },
      ]),
    ).toBe('0x5991bb8c6514148a29db676a14ac506cd2cd5775ace63c30a4fe457715e9ac84')
  })
})

describe('verifyStateProof with the node-exported schema 7 vector', () => {
  it('returns the values the node verifier authenticated', () => {
    const verified = verifyStateProof(realProof(), realRequest, {
      blockHash: realHash,
    })
    expect(verified.blockNumber).toBe(BigInt(vector.expected.blockNumber))
    expect(verified.timestamp).toBe(BigInt(vector.expected.timestamp))
    expect(verified.stateRoot).toBe(vector.expected.stateRoot)
    expect(verified.account).toEqual({
      nonce: BigInt(vector.expected.account.nonce),
      balance: BigInt(vector.expected.account.balance),
      codeHash: vector.expected.account.codeHash,
      storageRoot: vector.expected.account.storageRoot,
    })
    expect(verified.storage).toEqual(
      vector.expected.storage.map((s) => ({
        slot: s.slot,
        value: BigInt(s.value),
      })),
    )
  })

  it('rejects a block hash that differs from the trusted one', () => {
    expect(() =>
      verifyStateProof(realProof(), realRequest, { blockHash: word(0xaa) }),
    ).toThrow('trusted block')
  })

  it('rejects a response whose root is not the header root', () => {
    const proof = realProof()
    proof.stateRoot = word(0xbb)
    expect(() =>
      verifyStateProof(proof, realRequest, { blockHash: realHash }),
    ).toThrow('trusted block')
  })

  it('rejects a header altered to carry a different root', () => {
    const proof = realProof()
    proof.canonicalHeader = proof.canonicalHeader.replace(
      proof.stateRoot.slice(2),
      word(0xcc).slice(2),
    ) as Hex
    proof.stateRoot = word(0xcc)
    expect(() =>
      verifyStateProof(proof, realRequest, { blockHash: realHash }),
    ).toThrow()
  })

  it('rejects tampered account and storage proofs and values', () => {
    const cases: ((p: StateProof) => void)[] = [
      (p) => (p.proof.accountProof[0] = tamper(p.proof.accountProof[0]!)),
      (p) =>
        (p.proof.storageProof[0]!.proof[0] = tamper(
          p.proof.storageProof[0]!.proof[0]!,
        )),
      (p) => (p.proof.storageProof[0]!.value = '0x1'),
      (p) => (p.proof.balance = '0x1'),
      (p) => (p.proof.storageHash = word(0xdd)),
      (p) => (p.proof.storageProof[0]!.proof = []),
    ]
    for (const change of cases) {
      const proof = realProof()
      change(proof)
      expect(() =>
        verifyStateProof(proof, realRequest, { blockHash: realHash }),
      ).toThrow()
    }
  })

  it('rejects a proof for a different selection', () => {
    expect(() =>
      verifyStateProof(
        realProof(),
        { ...realRequest, storageKeys: [word(9)] },
        { blockHash: realHash },
      ),
    ).toThrow('storage proof')
    expect(() =>
      verifyStateProof(
        realProof(),
        { ...realRequest, blockNumber: realRequest.blockNumber + 1n },
        { blockHash: realHash },
      ),
    ).toThrow('trusted block')
  })
})

describe('verifyStateProof with branch and extension paths', () => {
  const state = syntheticState()

  it('verifies a present account, present slots and an absent slot', () => {
    const keys = [state.slots[2]!, state.absentSlot, state.slots[0]!]
    const proof = state.build(state.target, keys)
    expect(proof.proof.accountProof.length).toBeGreaterThan(1)
    expect(proof.proof.storageProof[0]!.proof.length).toBeGreaterThan(1)
    const verified = verifyStateProof(
      proof,
      { blockNumber: 9n, address: state.target, storageKeys: keys },
      { blockHash: proof.blockHash },
    )
    expect(verified.account).toEqual({
      nonce: 7n,
      balance: 8n,
      codeHash: state.codeHash,
      storageRoot: state.storageRoot,
    })
    expect(verified.storage.map((s) => s.value)).toEqual([
      state.values[2],
      0n,
      state.values[0],
    ])
  })

  it('verifies a proven missing account as null with zero storage', () => {
    const missing = ('0x' + '99'.repeat(20)) as Address
    const proof = state.build(missing, [state.slots[0]!])
    const verified = verifyStateProof(
      proof,
      { blockNumber: 9n, address: missing, storageKeys: [state.slots[0]!] },
      { blockHash: proof.blockHash },
    )
    expect(verified.account).toBeNull()
    expect(verified.storage).toEqual([{ slot: state.slots[0], value: 0n }])
  })

  it('rejects truncated, extended, reordered and rerooted paths', () => {
    const keys = [state.slots[1]!]
    const request = {
      blockNumber: 9n,
      address: state.target,
      storageKeys: keys,
    }
    const cases: ((p: StateProof) => void)[] = [
      (p) => p.proof.accountProof.pop(),
      (p) => p.proof.accountProof.push(p.proof.accountProof[0]!),
      (p) => p.proof.accountProof.reverse(),
      (p) => p.proof.storageProof[0]!.proof.pop(),
      (p) => (p.proof.accountProof[1] = tamper(p.proof.accountProof[1]!)),
      (p) => (p.proof.nonce = '0x8'),
      (p) => (p.proof.codeHash = EMPTY_CODE),
    ]
    for (const change of cases) {
      const proof = state.build(state.target, keys)
      change(proof)
      expect(() =>
        verifyStateProof(proof, request, { blockHash: proof.blockHash }),
      ).toThrow()
    }
    const proof = state.build(state.target, keys)
    // A valid header for a different root cannot authenticate this proof.
    proof.canonicalHeader = header(word(0xee), 9n)
    proof.stateRoot = word(0xee)
    proof.blockHash = keccak256(proof.canonicalHeader)
    expect(() =>
      verifyStateProof(proof, request, { blockHash: proof.blockHash }),
    ).toThrow('Invalid MPT proof path')
  })

  it('rejects a one-child branch and a hashed reference to a short node', () => {
    const address = ('0x' + '46'.repeat(20)) as Address
    const key = [...hexToBytes(keccak256(address))].flatMap((b) => [
      b >> 4,
      b & 15,
    ])
    const leafFor = (path: number[], value: Uint8Array) =>
      rlpList([rlpString(hexPrefix(path, true)), rlpString(value)])
    const empty = rlpString(new Uint8Array())
    const branch = (children: Map<number, Uint8Array>) =>
      rlpList([
        ...Array.from({ length: 16 }, (_, n) => children.get(n) ?? empty),
        empty,
      ])
    const prove = (nodes: Uint8Array[]) => {
      const root = keccak256(nodes[0]!)
      const canonicalHeader = header(root, 1n)
      const proof: StateProof = {
        schemaVersion: 2,
        blockHash: keccak256(canonicalHeader),
        stateRoot: root,
        canonicalHeader,
        checkpoint: '0x4d50513700',
        proof: {
          address,
          nonce: '0x0',
          balance: '0x1',
          codeHash: EMPTY_CODE,
          storageHash: EMPTY_ROOT,
          accountProof: nodes.map((n) => bytesToHex(n)),
          storageProof: [],
        },
      }
      return () =>
        verifyStateProof(
          proof,
          { blockNumber: 1n, address },
          { blockHash: proof.blockHash },
        )
    }
    const leaf = leafFor(key.slice(1), account(0n, 1n, EMPTY_ROOT, EMPTY_CODE))
    const hashOf = (node: Uint8Array) => rlpString(hexToBytes(keccak256(node)))
    // Canonical control: two children verify.
    const sibling = leafFor(
      key.slice(1),
      account(0n, 2n, EMPTY_ROOT, EMPTY_CODE),
    )
    const otherNibble = (key[0]! + 1) % 16
    expect(
      prove([
        branch(
          new Map([
            [key[0]!, hashOf(leaf)],
            [otherNibble, hashOf(sibling)],
          ]),
        ),
        leaf,
      ])().account?.balance,
    ).toBe(1n)
    expect(prove([branch(new Map([[key[0]!, hashOf(leaf)]])), leaf])).toThrow(
      'Invalid MPT proof path',
    )
    // A short node must be inlined, never referenced by hash.
    const slot = word(0x31)
    const skey = [...hexToBytes(keccak256(slot))].flatMap((b) => [
      b >> 4,
      b & 15,
    ])
    const near = (skey[60]! + 1) % 16
    const shortLeaf = leafFor(
      skey.slice(61),
      rlpInteger(BigInt(`0x${'11'.repeat(20)}`)),
    )
    const otherLeaf = leafFor(
      skey.slice(61),
      rlpInteger(BigInt(`0x${'22'.repeat(20)}`)),
    )
    expect(shortLeaf.length).toBeLessThan(32)
    const storageWith = (reference: (node: Uint8Array) => Uint8Array) => {
      const inner = branch(
        new Map([
          [skey[60]!, reference(shortLeaf)],
          [near, reference(otherLeaf)],
        ]),
      )
      const root = rlpList([
        rlpString(hexPrefix(skey.slice(0, 60), false)),
        hashOf(inner),
      ])
      return { root: keccak256(root), nodes: [root, inner] }
    }
    const check = (
      reference: (node: Uint8Array) => Uint8Array,
      extra: Uint8Array[],
    ) => {
      const storage = storageWith(reference)
      const accountLeaf = leafFor(
        key,
        account(0n, 0n, storage.root, EMPTY_CODE),
      )
      const root = keccak256(accountLeaf)
      const canonicalHeader = header(root, 1n)
      const proof: StateProof = {
        schemaVersion: 2,
        blockHash: keccak256(canonicalHeader),
        stateRoot: root,
        canonicalHeader,
        checkpoint: '0x4d50513700',
        proof: {
          address,
          nonce: '0x0',
          balance: '0x0',
          codeHash: EMPTY_CODE,
          storageHash: storage.root,
          accountProof: [bytesToHex(accountLeaf)],
          storageProof: [
            {
              key: slot,
              value: `0x${'11'.repeat(20)}`,
              proof: [...storage.nodes, ...extra].map((n) => bytesToHex(n)),
            },
          ],
        },
      }
      return () =>
        verifyStateProof(
          proof,
          { blockNumber: 1n, address, storageKeys: [slot] },
          { blockHash: proof.blockHash },
        )
    }
    const expected = BigInt(`0x${'11'.repeat(20)}`)
    expect(check((n) => n, [])().storage[0]!.value).toBe(expected)
    expect(check((n) => n, [shortLeaf])().storage[0]!.value).toBe(expected)
    expect(check(hashOf, [shortLeaf])).toThrow('Invalid MPT proof path')
  })

  it('rejects an included zero storage leaf', () => {
    const slot = word(7)
    const storage = [
      { key: slot, value: rlpInteger(0n) },
      { key: word(8), value: rlpInteger(1n) },
    ]
    const storageRoot = secureTrie(storage).root
    const address = ('0x' + '44'.repeat(20)) as Address
    const { root, proof: accountProof } = secureTrie(
      [
        { key: address, value: account(0n, 0n, storageRoot, EMPTY_CODE) },
        {
          key: ('0x' + '45'.repeat(20)) as Address,
          value: account(0n, 1n, EMPTY_ROOT, EMPTY_CODE),
        },
      ],
      address,
    )
    const canonicalHeader = header(root, 1n)
    const proof: StateProof = {
      schemaVersion: 2,
      blockHash: keccak256(canonicalHeader),
      stateRoot: root,
      canonicalHeader,
      checkpoint: '0x4d50513700',
      proof: {
        address,
        nonce: '0x0',
        balance: '0x0',
        codeHash: EMPTY_CODE,
        storageHash: storageRoot,
        accountProof,
        storageProof: [
          { key: slot, value: '0x0', proof: secureTrie(storage, slot).proof },
        ],
      },
    }
    expect(() =>
      verifyStateProof(
        proof,
        { blockNumber: 1n, address, storageKeys: [slot] },
        { blockHash: proof.blockHash },
      ),
    ).toThrow('storage encoding')
  })
})

describe('getStateProof', () => {
  it('sends the selection and rejects a response for another account', async () => {
    const request = vi.fn(async () => realProof())
    const actions = diesisPublicActions({ request } as never)
    await expect(actions.getStateProof(realRequest)).resolves.toEqual(
      realProof(),
    )
    expect(request).toHaveBeenCalledWith({
      method: 'diesis_getStateProof',
      params: [vector.request],
    })
    await expect(
      actions.getStateProof({
        ...realRequest,
        address: ('0x' + '12'.repeat(20)) as Address,
      }),
    ).rejects.toThrow('Invalid MPT state proof response')
  })

  it('rejects unknown envelope versions and extra fields', () => {
    expect(() =>
      parseStateProof({ ...realProof(), schemaVersion: 1 }, realRequest),
    ).toThrow('schemaVersion 2')
    expect(() =>
      parseStateProof({ ...realProof(), witness: '0x00' }, realRequest),
    ).toThrow('schemaVersion 2')
  })

  it('no longer exposes the retired block witness read', () => {
    const actions = diesisPublicActions({ request: vi.fn() } as never)
    expect('getBlockWitness' in actions).toBe(false)
  })
})
