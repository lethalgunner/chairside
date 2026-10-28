/**
 * Where to send someone after they sign in (T29, QA Q13).
 *
 * `next` arrives from the address bar, so it is attacker-controlled: an open
 * redirect would let a phishing link go through our sign-in page and land on
 * someone else's site. safeNext() accepts only a same-origin relative path
 * that starts with exactly one "/" and falls back to "/" for anything else.
 * Pure and framework-free: the middleware, the login page and the login form
 * all use it.
 */

export const NEXT_MAX_LENGTH = 512;

/** Request header the middleware sets to the page path and query, read by requireContext(). Always overwritten there. */
export const PATH_HEADER = 'x-cs-path';

/** Query value on /login that shows "You were signed out. Nothing was saved." */
export const EXPIRED_REASON = 'expired';

/** Message shown on the login page after a session ran out mid-task. */
export const SIGNED_OUT_MESSAGE = 'You were signed out. Nothing was saved.';

// C0 controls, DEL and C1 controls. Browsers silently drop tab/CR/LF inside URLs,
// so "/\t/evil.com" would become "//evil.com".
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function acceptable(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.includes('\\')) return false;
  if (CONTROL.test(path)) return false;
  return true;
}

/** The validated path, or "/" when the value is missing or unsafe. */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (value.length === 0 || value.length > NEXT_MAX_LENGTH) return '/';
  if (!acceptable(value)) return '/';
  // Check every decoded form too, so "/%2F%2Fevil.com" or "/%5Cevil" can't be
  // turned into "//evil.com" or "/\evil" by a later decode. Malformed escapes are refused.
  let current = value;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return '/';
    }
    if (decoded === current) break;
    if (!acceptable(decoded)) return '/';
    current = decoded;
  }
  // Belt and braces: resolved against a placeholder origin, it must stay there.
  try {
    const base = 'http://chairside.invalid';
    if (new URL(value, base).origin !== base) return '/';
  } catch {
    return '/';
  }
  return value;
}

/** The sign-in URL that brings the person back to `path` afterwards. */
export function loginHref(path: string | null | undefined, expired: boolean): string {
  const params = new URLSearchParams();
  const next = safeNext(path);
  if (next !== '/') params.set('next', next);
  if (expired) params.set('reason', EXPIRED_REASON);
  const qs = params.toString();
  return qs ? `/login?${qs}` : '/login';
}

/** True for the result a server action returns when it found no valid session. */
export function isSignedOutResult(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { signedOut?: unknown }).signedOut === true;
}
