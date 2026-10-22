import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // .claude/** holds agent worktrees on some machines; their copies must not run here (QA Q23).
  test: { exclude: ['**/node_modules/**', '**/*.db.test.ts', 'e2e/**', '.claude/**'] },
});
