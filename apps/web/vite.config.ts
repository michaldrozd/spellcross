import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const resolveFromRoot = (p: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), p);

// Vite configuration for the Spellcross tactical sandbox prototype.
export default defineConfig({
  plugins: [react()],
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
