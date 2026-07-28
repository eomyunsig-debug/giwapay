import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // PostgreSQL-backed suites may share TEST_DATABASE_URL in CI and include
    // explicit projection cleanup. Keep files serial to avoid cross-suite
    // deletion races while unit tests remain fast.
    fileParallelism: false,
  },
});
