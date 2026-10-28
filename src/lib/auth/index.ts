/**
 * The only module feature code uses for identity. Pilot 0 implementation is
 * in-app password sessions (ADR-012); Phase 1 swaps in emailed one-time codes
 * (ADR-011) behind these same functions.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { TenantContext } from '@/services/context';
import { loginHref, PATH_HEADER } from '@/lib/nav/safe-next';
import { redeemInvite } from './invite';
import { contextFromSession, revokeSession, signInWithPassword } from './session';

export const SESSION_COOKIE = 'cs_session';
export const BRANCH_COOKIE = 'cs_branch';

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
    path: '/',
    expires,
  };
}

/** The current user's context, or null when signed out. */
export async function getContext(): Promise<TenantContext | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const resolved = await contextFromSession(sid, jar.get(BRANCH_COOKIE)?.value);
  if (!resolved) return null;
  if (resolved.refreshedExpiry) {
    try {
      jar.set(SESSION_COOKIE, sid, cookieOptions(resolved.refreshedExpiry));
    } catch {
      // Cookies are read-only while a server component renders; the next
      // server action refreshes it instead.
    }
  }
  return resolved.ctx;
}

/**
 * Call at the top of every page. Signed-out callers go to /login with `next`
 * set to this page, so signing in brings them back (T29, QA Q13). The login
 * page says "You were signed out" only when a session cookie was sent but is
 * no longer valid (or a server action found none): someone who never signed in
 * just sees the sign-in form. Server actions that return an ActionResult use
 * getContext() and answer signedOut() instead, so the form can navigate itself.
 */
export async function requireContext(): Promise<TenantContext> {
  const ctx = await getContext();
  if (!ctx) {
    const jar = await cookies();
    const h = await headers();
    const expired = !!jar.get(SESSION_COOKIE) || h.has('next-action');
    redirect(loginHref(h.get(PATH_HEADER), expired));
  }
  return ctx;
}

export async function signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const result = await signInWithPassword(email, password);
  if (!result.ok) return { ok: false, error: result.error };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.sessionId, cookieOptions(result.expiresAt));
  return { ok: true };
}

/** Set a password from an invite link and sign straight in. */
export async function acceptInvite(token: string, password: string, confirm: string): Promise<{ ok: boolean; error?: string }> {
  const result = await redeemInvite(token, password, confirm);
  if (!result.ok) return { ok: false, error: result.error };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.sessionId, cookieOptions(result.expiresAt));
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) await revokeSession(sid);
  jar.delete(SESSION_COOKIE);
}

export async function setActiveBranch(branchId: string): Promise<void> {
  const jar = await cookies();
  jar.set(BRANCH_COOKIE, branchId, cookieOptions(new Date(Date.now() + 365 * 86_400_000)));
}
