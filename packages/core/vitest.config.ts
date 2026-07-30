import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const resolveFromRoot = (relativePath: string) => (
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), relativePath)
);

export default defineConfig({
  resolve: {
    alias: {
      // Tests read the data package from source so they never assert against a
      // previous build's content when only packages/data has been edited.
      '@spellcross/data': resolveFromRoot('../data/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts']
  }
});
