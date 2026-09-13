/**
 * Process-wide store for the dev seed.
 *
 * Why this exists rather than plain module-level arrays: Next.js bundles server
 * actions and page components into SEPARATE server chunks, and each chunk gets
 * its own instance of any module it imports. A `PATIENTS.push()` inside a server
 * action therefore mutates a different array than the one the list page renders
 * from, and the new record silently vanishes — which is exactly what happened
 * the first time registration was wired up.
 *
 * Hanging the arrays off `globalThis` gives every chunk the same references. It
 * also survives hot reload in dev, so a code edit no longer wipes anything
 * registered while testing.
 *
 * This is a development scaffold and nothing more. It is per-process, so it does
 * not survive a restart and would not work across serverless instances. All of
 * it is replaced by Drizzle queries when the data layer lands.
 */

declare global {
  // eslint-disable-next-line no-var
  var __chairsideStore: Record<string, unknown[]> | undefined;
}

const store: Record<string, unknown[]> = (globalThis.__chairsideStore ??= {});

/**
 * Returns the one shared array for `key`, initialising it from `seed` the first
 * time it is requested in this process.
 */
export function shared<T>(key: string, seed: T[]): T[] {
  if (!store[key]) {
    store[key] = seed as unknown[];
  }
  return store[key] as T[];
}
