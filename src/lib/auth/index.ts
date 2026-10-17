/**
 * The only module feature code uses for identity. Pilot 0 implementation is
 * in-app password sessions (ADR-012); Phase 1 swaps in emailed one-time codes
 * (ADR-011) behind these same functions.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { TenantContext } from '@/services/context';
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

/** Call at the top of every page and server action. Signed-out callers go to /login. */
export async function requireContext(): Promise<TenantContext> {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  return ctx;
}

export async function signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const result = await signInWithPassword(email, password);
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
