import 'server-only';
import { ForbiddenError, UserFacingError } from '@/services/context';
import { SIGNED_OUT_MESSAGE } from '@/lib/nav/safe-next';

/** The answer when the session ran out (T29): useActionForm sees `signedOut` and sends the person to sign in, then back. */
export type SignedOut = { ok: false; error: string; signedOut: true };

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string } | SignedOut;

/** Actions slower than this are logged as warnings (QA Q5: registration stuck on "Saving…"). */
export const SLOW_ACTION_MS = 3000;

/**
 * The one line logged per action. Only the action's fixed name, its duration
 * and the outcome: never arguments, results or error text, which may hold
 * patient data. A name that is not a plain identifier is replaced, so a
 * caller can't leak data through it by mistake.
 */
export function actionLogLine(name: string, ms: number, outcome: 'ok' | 'error' | 'signed_out'): string {
  const safe = /^[a-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : 'unnamed';
  return `[action] ${safe} ${Math.max(0, Math.round(ms))}ms ${outcome}`;
}

/**
 * Wrap a server action body: staff-safe errors pass through, anything else is
 * logged without its payload (which may hold patient data) and shown generically.
 * Redirects thrown by Next.js (requireContext) are re-thrown untouched.
 * Every call logs one timing line (see actionLogLine).
 */
export async function run<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  const started = performance.now();
  let outcome: 'ok' | 'error' = 'error';
  try {
    const data = await fn();
    outcome = 'ok';
    return { ok: true, data };
  } catch (err) {
    if (isNextControlFlow(err)) {
      outcome = 'ok';
      throw err;
    }
    if (err instanceof UserFacingError || err instanceof ForbiddenError) return { ok: false, error: err.message };
    console.error('[action] unexpected error:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
    return { ok: false, error: 'Something went wrong and nothing was saved. Try again, or tell KS if it repeats.' };
  } finally {
    const ms = performance.now() - started;
    const line = actionLogLine(name, ms, outcome);
    if (ms > SLOW_ACTION_MS) console.warn(line);
    else console.info(line);
  }
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown })?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_HTTP_ERROR'));
}

/**
 * Return this from an action whose getContext() came back empty, before doing
 * anything else. Nothing has been read or written, so nothing was saved.
 */
export function signedOut(name: string): SignedOut {
  console.info(actionLogLine(name, 0, 'signed_out'));
  return { ok: false, error: SIGNED_OUT_MESSAGE, signedOut: true };
}
