/**
 * Invite links (Pilot 0). An administrator creates a login without a password;
 * the person opens a one-time link and chooses their own. Nobody else ever
 * knows the password, and no password travels over chat or sits in a log.
 * Only the SHA-256 of the 256-bit token is stored.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { passwordSetupTokens, sessions, users } from '@/db/schema';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password';
import { createSession } from './session';

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create a fresh invite for a user, cancelling any earlier unused one. Returns the raw token (show it once). */
export async function createInvite(db: DB | Tx, params: { orgId: string; userId: string }): Promise<{ token: string; expiresAt: Date }> {
  const now = new Date();
  await db
    .update(passwordSetupTokens)
    .set({ expiresAt: now })
    .where(and(eq(passwordSetupTokens.userId, params.userId), isNull(passwordSetupTokens.usedAt), gt(passwordSetupTokens.expiresAt, now)));
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  await db.insert(passwordSetupTokens).values({ orgId: params.orgId, userId: params.userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

async function findValid(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const [row] = await getDb()
    .select({ t: passwordSetupTokens, u: users })
    .from(passwordSetupTokens)
    .innerJoin(users, eq(users.id, passwordSetupTokens.userId))
    .where(and(eq(passwordSetupTokens.tokenHash, hashToken(token)), isNull(passwordSetupTokens.usedAt), gt(passwordSetupTokens.expiresAt, new Date())))
    .limit(1);
  if (!row || !row.u.active || !row.u.email) return null;
  return row;
}

/** For the setup page: whose invite is this, if it is still valid. */
export async function describeInvite(token: string): Promise<{ fullName: string; email: string } | null> {
  const row = await findValid(token);
  return row ? { fullName: row.u.fullName, email: row.u.email! } : null;
}

export type RedeemResult = { ok: true; sessionId: string; expiresAt: Date } | { ok: false; error: string };

/** Set the password from a valid invite, burn the token, end other sessions, and sign the person in. */
export async function redeemInvite(token: string, password: string, confirm: string): Promise<RedeemResult> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { ok: false, error: 'The two passwords don’t match.' };
  const row = await findValid(token);
  if (!row) return { ok: false, error: 'This link has expired or was already used. Ask for a new one.' };
  const passwordHash = await hashPassword(password);
  const claimed = await getDb().transaction(async (tx) => {
    const res = await tx
      .update(passwordSetupTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordSetupTokens.id, row.t.id), isNull(passwordSetupTokens.usedAt)))
      .returning({ id: passwordSetupTokens.id });
    if (res.length === 0) return false; // lost a race with another use of the same link
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.u.id));
    await tx.delete(sessions).where(eq(sessions.userId, row.u.id));
    return true;
  });
  if (!claimed) return { ok: false, error: 'This link has expired or was already used. Ask for a new one.' };
  return { ok: true, ...(await createSession(row.u.orgId, row.u.id, 'password_set_from_invite')) };
}
