import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (relativePath: string) => (
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), relativePath)
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@spellcross/data': resolveFromRoot('../../packages/data/src/index.ts')
    }
  },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**']
  }
});
