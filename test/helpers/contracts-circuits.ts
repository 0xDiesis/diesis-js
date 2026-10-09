import { access, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MANIFEST_PATH = join('manifests', 'test', 'transfer-v1.json')

async function isCircuitsRoot(path: string): Promise<boolean> {
  try {
    await access(join(path, MANIFEST_PATH))
    return true
  } catch {
    return false
  }
}

async function linkedWorktreeCircuits(parent: string): Promise<string[]> {
  const roots = [
    join(parent, '.worktrees'),
    join(parent, 'diesis', '.worktrees'),
  ]
  const candidates: string[] = []
  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        candidates.push(
          root.endsWith(join('diesis', '.worktrees'))
            ? join(root, entry.name, 'contracts', 'circuits')
            : join(root, entry.name, 'circuits'),
        )
      }
    } catch {
      // This ancestor has no linked worktree directory.
    }
  }
  return candidates
}

/** Resolve integration-test artifacts from either an override or a core checkout ancestor. */
export async function resolveContractsCircuitsRoot(
  anchor: string | URL,
): Promise<URL> {
  const override = process.env.DIESIS_CONTRACTS_DIR
  if (override !== undefined) {
    const circuits = resolve(override, 'circuits')
    if (!(await isCircuitsRoot(circuits))) {
      throw new Error(
        `DIESIS_CONTRACTS_DIR has no test circuit manifest: ${override}`,
      )
    }
    return pathToFileURL(`${circuits}/`)
  }

  let cursor = dirname(fileURLToPath(anchor))
  for (;;) {
    const canonical = join(cursor, 'diesis', 'contracts', 'circuits')
    if (await isCircuitsRoot(canonical)) {
      return pathToFileURL(`${canonical}/`)
    }
    const linkedCandidates = await linkedWorktreeCircuits(cursor)
    const linkedMatches: string[] = []
    for (const circuits of linkedCandidates) {
      if (await isCircuitsRoot(circuits)) linkedMatches.push(circuits)
    }
    if (linkedMatches.length > 1) {
      throw new Error(
        'multiple linked contracts worktrees contain artifacts; set DIESIS_CONTRACTS_DIR',
      )
    }
    if (linkedMatches[0] !== undefined) {
      return pathToFileURL(`${linkedMatches[0]}/`)
    }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  throw new Error(
    'unable to locate diesis/contracts/circuits; set DIESIS_CONTRACTS_DIR',
  )
}
