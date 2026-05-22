import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@road42/core': resolve(__dirname, '../core/src/index.ts'),
      '@road42/server': resolve(__dirname, '../server/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
