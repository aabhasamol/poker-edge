/**
 * Builds the side panel and the service worker as ES modules.
 *
 * The content script is built separately (see `vite.config.content.ts`) because
 * MV3 injects content scripts as classic scripts — an ES-module bundle would
 * fail at `import` before running a line.
 */

import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'extension'),
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'extension/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'extension/sidepanel.html'),
        background: resolve(__dirname, 'extension/src/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
