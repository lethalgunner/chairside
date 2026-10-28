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

  // Don't advertise the framework (QA 28 Oct, production check).
  poweredByHeader: false,

  /**
   * Baseline browser protections on every response (QA 28 Oct: none were set).
   * - No framing: the login and invite pages can't be wrapped in someone else's page.
   * - Referrer: same-origin only, so the one-time /setup?token=… link never leaks in a Referer header.
   * - nosniff and a closed permissions policy (no camera, mic or location in Pilot 0).
   * HSTS is already sent by Vercel. A full Content-Security-Policy needs nonces for
   * Next's inline scripts and is left for G1.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default config;
