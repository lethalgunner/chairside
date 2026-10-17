/**
 * Database-backed sessions (ADR-012). Framework-free so tests can call it;
 * src/lib/auth/index.ts adds the Next.js cookie handling.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { branches, loginFailures, memberships, sessions, users } from '@/db/schema';
import { accessibleBranches, type Grant, type Role } from '@/domain/permissions';
import { writeAudit } from '@/services/audit';
import type { TenantContext } from '@/services/context';
import { dummyVerify, verifyPassword } from './password';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REFRESH_WHEN_REMAINING_MS = 11 * 60 * 60 * 1000;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export type SignInResult =
  | { ok: true; sessionId: string; expiresAt: Date }
  | { ok: false; error: string };

export async function signInWithPassword(emailRaw: string, password: string): Promise<SignInResult> {
  const db = getDb();
  const email = emailRaw.trim().toLowerCase();
  const generic = 'Email or password is incorrect.';
  if (!email || !password) return { ok: false, error: generic };

  const since = new Date(Date.now() - FAILURE_WINDOW_MS);
  const [failures] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginFailures)
    .where(and(eq(loginFailures.email, email), gt(loginFailures.occurredAt, since)));
  if ((failures?.n ?? 0) >= MAX_FAILURES) {
    return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' };
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let valid = false;
  if (user && user.active && user.passwordHash) {
    valid = await verifyPassword(password, user.passwordHash);
  } else {
    await dummyVerify(password);
  }

  if (!valid || !user) {
    await db.insert(loginFailures).values({ email });
    return { ok: false, error: generic };
  }

  await db.delete(loginFailures).where(eq(loginFailures.email, email));
  const sessionId = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: sessionId, orgId: user.orgId, userId: user.id, expiresAt });
  await writeAudit(db, { orgId: user.orgId, userId: user.id }, {
    action: 'sign_in',
    entityType: 'user',
    entityId: user.id,
  });
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { ok: true, sessionId, expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Resolve a session id to a tenant context, sliding the expiry forward.
 * Returns null for unknown, expired or deactivated sessions, or a user with no grants.
 */
export async function contextFromSession(
  sessionId: string,
  requestedBranch: string | undefined,
): Promise<{ ctx: TenantContext; refreshedExpiry: Date | null } | null> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || !row.user.active || !row.user.passwordHash) return null;

  const grantRows = await db
    .select({ role: memberships.role, branchId: memberships.branchId })
    .from(memberships)
    .where(and(eq(memberships.userId, row.user.id), eq(memberships.orgId, row.user.orgId)));
  const grants: Grant[] = grantRows.map((g) => ({ role: g.role as Role, branchId: g.branchId }));
  if (grants.length === 0) return null;

  const orgBranches = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.orgId, row.user.orgId))
    .orderBy(asc(branches.name));
  const branchIds = accessibleBranches(
    grants,
    orgBranches.map((b) => b.id),
  );
  if (branchIds.length === 0) return null;

  let activeBranchId: string | 'all';
  if (requestedBranch && branchIds.includes(requestedBranch)) activeBranchId = requestedBranch;
  else if (requestedBranch === 'all' && branchIds.length > 1) activeBranchId = 'all';
  else activeBranchId = branchIds.length === 1 ? branchIds[0]! : 'all';

  let refreshedExpiry: Date | null = null;
  if (row.session.expiresAt.getTime() - now.getTime() < REFRESH_WHEN_REMAINING_MS) {
    refreshedExpiry = new Date(now.getTime() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt: refreshedExpiry }).where(eq(sessions.id, sessionId));
  }

  return {
    ctx: {
      orgId: row.user.orgId,
      userId: row.user.id,
      userName: row.user.fullName,
      grants,
      branchIds,
      activeBranchId,
    },
    refreshedExpiry,
  };
}
