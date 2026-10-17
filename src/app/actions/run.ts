import 'server-only';
import { ForbiddenError, UserFacingError } from '@/services/context';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Wrap a server action body: staff-safe errors pass through, anything else is
 * logged without its payload (which may hold patient data) and shown generically.
 * Redirects thrown by Next.js (requireContext) are re-thrown untouched.
 */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    if (err instanceof UserFacingError || err instanceof ForbiddenError) return { ok: false, error: err.message };
    console.error('[action] unexpected error:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
    return { ok: false, error: 'Something went wrong and nothing was saved. Try again, or tell KS if it repeats.' };
  }
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown })?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_HTTP_ERROR'));
}
