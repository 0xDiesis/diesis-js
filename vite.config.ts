import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
  resolve: {
    // snarkjs publishes a self-contained browser ESM export. Keep the worker
    // graph on that condition so Node-only CLI dependencies cannot enter it.
    conditions: ['browser', 'module', 'import', 'default'],
    alias: {
      // Vite dev prebundling does not honor snarkjs's browser condition when
      // this SDK is tested from a linked pnpm worktree. Point the harness at
      // the exact browser export that normal installed-package bundlers select.
      snarkjs: fileURLToPath(
        new URL('./node_modules/snarkjs/build/browser.esm.js', import.meta.url),
      ),
    },
  },
})
