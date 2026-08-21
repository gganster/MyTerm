import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared },
    },
    build: {
      rollupOptions: {
        // node-pty is a native module: it cannot be bundled and must be
        // resolved from node_modules at runtime (ARCHI ADR-002).
        external: ['node-pty'],
      },
    },
  },
  preload: {
    // No externalizeDepsPlugin here: with sandbox: true the preload must be a
    // single self-contained CJS bundle, it cannot require from node_modules.
    resolve: {
      alias: { '@shared': shared },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
})
