import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ['src/payment-flow.anvil.integration.test.ts'],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 120_000,
  },
});
