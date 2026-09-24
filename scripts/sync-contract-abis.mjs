#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractsRoot = process.env.DIESIS_CONTRACTS_DIR
  ? path.resolve(process.env.DIESIS_CONTRACTS_DIR)
  : path.resolve(sdkRoot, '../../diesis/contracts')
const upstreamAbiRoot = path.join(contractsRoot, 'src/abi')
const destinationAbiRoot = path.join(sdkRoot, 'src/abi')
const providers = ['viem', 'wagmi', 'ethers', 'web3js']

const arguments_ = process.argv.slice(2)
if (
  arguments_.length > 1 ||
  (arguments_.length === 1 &&
    !['--check', '--generate'].includes(arguments_[0]))
) {
  throw new Error('usage: sync-contract-abis.mjs [--check|--generate]')
}
const checkOnly = arguments_[0] === '--check'
const generateFirst = arguments_[0] === '--generate'

async function generateContractAbis() {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--dir', contractsRoot, 'abi:generate'], {
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `contract ABI generation failed (${signal ?? `exit ${code}`})`,
          ),
        )
      }
    })
  })
}

async function listFiles(root) {
  const files = []

  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relative = path.posix.join(prefix, entry.name)
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relative)
      } else if (entry.isFile()) {
        files.push(relative)
      } else {
        throw new Error(`refusing non-regular ABI source: ${relative}`)
      }
    }
  }

  await visit(root)
  return files
}

async function sameBytes(left, right) {
  try {
    const [leftBytes, rightBytes] = await Promise.all([
      readFile(left),
      readFile(right),
    ])
    return leftBytes.equals(rightBytes)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function assertProviderParity() {
  const canonicalRoot = path.join(upstreamAbiRoot, 'generated/viem')
  const canonicalFiles = await listFiles(canonicalRoot)

  for (const provider of providers.slice(1)) {
    const providerRoot = path.join(upstreamAbiRoot, `generated/${provider}`)
    const providerFiles = await listFiles(providerRoot)
    if (
      providerFiles.length !== canonicalFiles.length ||
      providerFiles.some((file, index) => file !== canonicalFiles[index])
    ) {
      throw new Error(
        `upstream ${provider} ABI file set differs from canonical viem`,
      )
    }
    for (const file of canonicalFiles) {
      if (
        !(await sameBytes(
          path.join(canonicalRoot, file),
          path.join(providerRoot, file),
        ))
      ) {
        throw new Error(
          `upstream ${provider} ABI bytes differ from viem: ${file}`,
        )
      }
    }
  }

  return canonicalFiles
}

async function checkVendor(canonicalFiles) {
  const differences = []
  const sourceIndex = path.join(upstreamAbiRoot, 'index.ts')
  const destinationIndex = path.join(destinationAbiRoot, 'index.ts')
  if (!(await sameBytes(sourceIndex, destinationIndex))) {
    differences.push('src/abi/index.ts differs')
  }

  const destinationRoot = path.join(destinationAbiRoot, 'generated/viem')
  let destinationFiles = []
  try {
    destinationFiles = await listFiles(destinationRoot)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
  const canonicalSet = new Set(canonicalFiles)
  for (const file of canonicalFiles) {
    if (
      !(await sameBytes(
        path.join(upstreamAbiRoot, 'generated/viem', file),
        path.join(destinationRoot, file),
      ))
    ) {
      differences.push(`src/abi/generated/viem/${file} differs`)
    }
  }
  for (const file of destinationFiles) {
    if (!canonicalSet.has(file)) {
      differences.push(`src/abi/generated/viem/${file} is stale`)
    }
  }

  if (differences.length > 0) {
    throw new Error(`ABI vendor is stale:\n${differences.join('\n')}`)
  }
}

async function syncFile(source, destination) {
  if (await sameBytes(source, destination)) {
    return
  }
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  console.log(`synced ${path.relative(sdkRoot, destination)}`)
}

async function syncVendor(canonicalFiles) {
  await syncFile(
    path.join(upstreamAbiRoot, 'index.ts'),
    path.join(destinationAbiRoot, 'index.ts'),
  )

  const sourceRoot = path.join(upstreamAbiRoot, 'generated/viem')
  const destinationRoot = path.join(destinationAbiRoot, 'generated/viem')
  const canonicalSet = new Set(canonicalFiles)
  let destinationFiles = []
  try {
    destinationFiles = await listFiles(destinationRoot)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
  for (const file of canonicalFiles) {
    await syncFile(
      path.join(sourceRoot, file),
      path.join(destinationRoot, file),
    )
  }
  for (const file of destinationFiles) {
    if (!canonicalSet.has(file)) {
      await unlink(path.join(destinationRoot, file))
      console.log(`removed ${path.posix.join('src/abi/generated/viem', file)}`)
    }
  }
}

if (generateFirst) {
  await generateContractAbis()
}
const canonicalFiles = await assertProviderParity()
if (checkOnly) {
  await checkVendor(canonicalFiles)
} else {
  await syncVendor(canonicalFiles)
}
