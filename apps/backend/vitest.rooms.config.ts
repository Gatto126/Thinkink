import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/runtime/**/*.test.ts'],
    testTimeout: 25000,
    hookTimeout: 15000,
    fileParallelism: false,
  },
});
