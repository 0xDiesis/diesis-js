import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { decodeFunctionData, encodeAbiParameters } from 'viem'
import { readNativeName, decodeSignedActionError } from '@diesis/sdk'
import { diesis } from '@diesis/sdk/chains'
import {
  nameServiceContracts,
  readNativeName as namesRead,
} from '@diesis/sdk/names'
import {
  DiesisPublicResolverAbi,
  IDiesisNameRegistryAbi,
} from '@diesis/sdk/abi'
import { decodeSignedActionError as subpathDecode } from '@diesis/sdk/rpc-errors'
const loaded = await realpath(fileURLToPath(import.meta.resolve('@diesis/sdk')))
assert.ok(loaded.startsWith(process.cwd() + '/node_modules/'), loaded)
assert.equal(diesis.id, 1980)
assert.equal(namesRead, readNativeName)
assert.equal(subpathDecode, decodeSignedActionError)
const hash = '0x' + 'ab'.repeat(32),
  genesis = '0x' + 'cd'.repeat(32),
  owner = '0x' + '11'.repeat(20),
  recipient = '0x' + '22'.repeat(20)
let requests = 0
const server = createServer(async (req, res) => {
  try {
    let bytes = ''
    for await (const chunk of req) bytes += chunk
    const query = JSON.parse(bytes)
    requests++
    let result
    if (query.method === 'eth_chainId') result = '0x7bc'
    else if (query.method === 'eth_getBlockByNumber')
      result =
        query.params[0] === '0x0'
          ? { number: '0x0', hash: genesis, timestamp: '0x0' }
          : { number: '0xa', hash, timestamp: '0x64' }
    else {
      assert.deepEqual(query.params[1], {
        blockHash: hash,
        requireCanonical: true,
      })
      if (query.method === 'eth_getCode') result = '0x01'
      else {
        assert.equal(query.method, 'eth_call')
        const tx = query.params[0]
        const abi =
          tx.to === nameServiceContracts.registry.toLowerCase()
            ? IDiesisNameRegistryAbi
            : DiesisPublicResolverAbi
        const { functionName } = decodeFunctionData({ abi, data: tx.data })
        const values = {
          owner,
          resolver: nameServiceContracts.resolver,
          expiry: 100n,
          ownershipEpoch: 7n,
          registry: nameServiceContracts.registry,
          addr: recipient,
        }
        result = encodeAbiParameters(
          [
            {
              type: ['owner', 'resolver', 'registry', 'addr'].includes(
                functionName,
              )
                ? 'address'
                : 'uint256',
            },
          ],
          [values[functionName]],
        )
      }
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ jsonrpc: '2.0', id: query.id, result }))
  } catch (error) {
    res.statusCode = 500
    res.end(String(error))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${server.address().port}`
try {
  const rpc = {
    identity: () => 'packed-fixture-v1',
    request: async ({ method, params, signal, maxResponseBytes }) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      assert.equal(response.status, 200)
      const chunks = []
      let count = 0
      for await (const chunk of response.body) {
        count += chunk.byteLength
        if (count > maxResponseBytes) throw new Error('limit')
        chunks.push(chunk)
      }
      return JSON.parse(Buffer.concat(chunks).toString()).result
    },
  }
  const observation = await readNativeName(
    rpc,
    {
      chainId: 1980,
      expectedGenesisHash: genesis,
      expectedRpcIdentity: 'packed-fixture-v1',
    },
    'alice.ds',
  )
  assert.equal(observation.owner, owner)
  assert.deepEqual(observation.recipient, {
    status: 'resolved',
    address: recipient,
  })
  assert.equal(observation.status, 'active')
  assert.equal(
    decodeSignedActionError({
      code: -32017,
      message: 'opaque',
      data: {
        version: 1,
        kind: 'signed-action-error',
        reason: 'exchange_submission_outcome_unknown',
        retryable: false,
        admission: 'unknown',
      },
    }).status,
    'known',
  )
  console.log(
    JSON.stringify({
      entrypoints: ['root', 'chains', 'names', 'abi', 'rpc-errors'],
      read: 'canonical Names against explicit deterministic HTTP RPC fixture',
      requests,
      loadedPackageInsideConsumer: true,
      networkQualification: false,
    }),
  )
} finally {
  await new Promise((resolve) => server.close(resolve))
}
