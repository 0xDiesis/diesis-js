import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveContractsCircuitsRoot } from '../helpers/contracts-circuits.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

describe('contracts circuit artifact discovery', () => {
  it('finds the core checkout from an isolated SDK worktree without a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diesis-sdk-artifacts-'))
    temporaryRoots.push(root)
    const sdkTest = join(
      root,
      'diesis-core',
      '.worktrees',
      'sdk-hft-v2',
      'test',
      'privacy',
      'anchor.ts',
    )
    const manifest = join(
      root,
      'diesis-core',
      'diesis',
      'contracts',
      'circuits',
      'manifests',
      'test',
      'transfer-v1.json',
    )
    await mkdir(dirname(manifest), { recursive: true })
    await writeFile(manifest, '{}')

    await expect(
      resolveContractsCircuitsRoot(pathToFileURL(sdkTest)),
    ).resolves.toEqual(
      pathToFileURL(
        `${join(root, 'diesis-core', 'diesis', 'contracts', 'circuits')}/`,
      ),
    )
  })

  it('finds artifacts in a linked contracts worktree when the main checkout lacks them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'diesis-sdk-artifacts-'))
    temporaryRoots.push(root)
    const sdkTest = join(
      root,
      'diesis-core',
      '.worktrees',
      'sdk-hft-v2',
      'test',
      'privacy',
      'anchor.ts',
    )
    const circuits = join(
      root,
      'diesis-core',
      '.worktrees',
      'contracts-feature',
      'circuits',
    )
    const manifest = join(circuits, 'manifests', 'test', 'transfer-v1.json')
    await mkdir(dirname(manifest), { recursive: true })
    await writeFile(manifest, '{}')

    await expect(
      resolveContractsCircuitsRoot(pathToFileURL(sdkTest)),
    ).resolves.toEqual(pathToFileURL(`${circuits}/`))
  })
})
