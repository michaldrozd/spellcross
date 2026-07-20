import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const resolveFromRoot = (p: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), p);

export default defineConfig({
  plugins: [react()],
  build: {
    // pixi.js is intentionally isolated behind the battle route; its 617 kB minified vendor chunk is
    // downloaded only when combat starts and compresses to about 190 kB.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // The tactical renderer loads on demand; keep its two large framework families in stable cacheable
        // chunks so a content or campaign change does not make players download Pixi again.
        manualChunks: {
          'pixi-vendor': ['@pixi/react', 'pixi.js'],
          'react-vendor': ['i18next', 'react', 'react-dom', 'react-i18next']
        }
      }
    }
  },
  server: {
    port: 5173
  },
  resolve: {
    alias: {
      '@core': resolveFromRoot('../../packages/core/src/index.ts'),
      '@spellcross/core': resolveFromRoot('../../packages/core/src/index.ts'),
      '@spellcross/data': resolveFromRoot('../../packages/data/src/index.ts')
    }
  }
});
