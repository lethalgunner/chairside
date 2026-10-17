import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Database integration tests. They run against DATABASE_URL_TEST, which is
// wiped and re-migrated at the start of every run. Files run one at a time
// because they share that database.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.db.test.ts'],
    globalSetup: ['./src/test/db-global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
