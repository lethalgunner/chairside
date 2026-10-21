/**
 * Self-healing navigation after a server action (QA Q5/Q8, Slice 3 T18).
 *
 * The action itself returns in milliseconds, but the soft navigation or
 * refresh that follows sometimes never commits in Next 15.5, leaving the
 * button on "Saving…". So every form navigates through afterAction(): it does
 * the soft router.push / router.refresh and, if the page has not changed within
 * NAV_FALLBACK_MS, falls back to a full page load. Only the form's fixed name
 * is logged (`[nav-fallback] <form>`), never data.
 */

export const NAV_FALLBACK_MS = 2500;
const POLL_MS = 100;

/** Rendered by the (app) layout with a fresh value on every server render; a change means a refresh committed. */
export const RENDER_KEY_ID = 'render-key';

export interface SettleDeps {
  /** True once the soft navigation has visibly happened. */
  isDone: () => boolean;
  /** The full page load used when it has not. */
  hardNavigate: () => void;
  warn: (line: string) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
}

/**
 * Wait for the soft navigation, else hard-navigate. Resolves 'soft' or 'hard'.
 * Framework-free so it can be unit-tested with fake timers.
 */
export function settle(form: string, deps: SettleDeps, timeoutMs = NAV_FALLBACK_MS): Promise<'soft' | 'hard'> {
  const started = deps.now();
  return new Promise((resolve) => {
    const handle = deps.setInterval(() => {
      if (deps.isDone()) {
        deps.clearInterval(handle);
        resolve('soft');
      } else if (deps.now() - started >= timeoutMs) {
        deps.clearInterval(handle);
        deps.warn(`[nav-fallback] ${/^[a-z][A-Za-z0-9_.-]{0,63}$/.test(form) ? form : 'unnamed'}`);
        deps.hardNavigate();
        resolve('hard');
      }
    }, POLL_MS);
  });
}

function renderKey(): string | null {
  return document.getElementById(RENDER_KEY_ID)?.getAttribute('data-k') ?? null;
}

interface SoftRouter {
  push: (href: string) => void;
  refresh: () => void;
}

/**
 * Navigate to `to` (or refresh the current page) after an action succeeded.
 * Call it outside any transition; keep the submit button disabled until it
 * resolves (or the page unloads).
 */
export function afterAction(router: SoftRouter, opts: { form: string; to?: string }): Promise<'soft' | 'hard'> {
  const deps = { setInterval: (fn: () => void, ms: number) => window.setInterval(fn, ms), clearInterval: (h: unknown) => window.clearInterval(h as number), now: () => performance.now(), warn: (l: string) => console.warn(l) };
  if (opts.to) {
    const target = new URL(opts.to, window.location.href);
    router.push(opts.to);
    return settle(opts.form, {
      ...deps,
      isDone: () => window.location.pathname === target.pathname && window.location.search === target.search,
      hardNavigate: () => window.location.assign(target.href),
    });
  }
  const before = renderKey();
  router.refresh();
  return settle(opts.form, {
    ...deps,
    // No key on the page (outside the app shell): nothing to wait for.
    isDone: () => before === null || renderKey() !== before,
    hardNavigate: () => window.location.reload(),
  });
}
