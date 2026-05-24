import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nimrobo/superdense-core': resolve(__dirname, '../core/src/index.ts'),
      '@nimrobo/superdense-server': resolve(__dirname, '../server/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
