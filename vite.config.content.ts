/**
 * Builds the content script as a single self-contained IIFE.
 *
 * MV3 content scripts are classic scripts: no `import`, no code splitting, and
 * no separate chunk files. Everything the reader needs — the log parser, the
 * hand state machine, the poller — is inlined into one file.
 */

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'extension/dist'),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'extension/src/content.ts'),
      formats: ['iife'],
      name: 'PokerEdgeContent',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true, extend: true },
    },
  },
});
