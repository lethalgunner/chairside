import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * Pin the workspace root to this project.
   *
   * Next.js walks up the tree looking for lockfiles to infer a monorepo root.
   * A stray package-lock.json anywhere above us — in a home directory, say —
   * gets picked instead, and file tracing then resolves against the wrong root.
   * Harmless in dev, but it can quietly break a production build's traced
   * output, so it is worth pinning rather than tolerating the warning.
   */
  outputFileTracingRoot: process.cwd(),
};

export default config;
