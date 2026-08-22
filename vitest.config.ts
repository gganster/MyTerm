import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Only the pure logic is tested here (ARCHI § Tests): validation, path
 * resolution, the status machine, the batcher and the trust hash. Those are the
 * things that break silently. The terminal itself is verified by running the
 * app, where a screenshot says more than any assertion.
 *
 * No Electron mock exists on purpose: if a test needs one, the code under test
 * is not pure and should be split, as trust-hash was.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
})
