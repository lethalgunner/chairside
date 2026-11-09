import { and, count, eq, gt } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { passwordSetupTokens, users } from '@/db/schema';
import { createInvite } from '@/lib/auth/invite';
import type { EmailSender } from '@/lib/email';
import { writeAudit } from './audit';

/** At most this many reset emails per person per hour (abuse and cost guard). */
export const RESET_EMAILS_PER_HOUR = 3;

/**
 * "Forgot password?" (Sprint 7, self-serve). Emails a one-time link (the same
 * 72-hour link the owner can make on the Team page) to an active person who
 * has set a password. The answer on screen is the same whether or not the
 * address exists, so the page can't be used to find out who has an account.
 */
export async function requestPasswordReset(emailRaw: string, baseUrl: string, send: EmailSender): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return;
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u || !u.active || !u.passwordHash) return;
  const since = new Date(Date.now() - 3_600_000);
  const [{ n }] = (await db.select({ n: count() }).from(passwordSetupTokens).where(and(eq(passwordSetupTokens.userId, u.id), gt(passwordSetupTokens.createdAt, since)))) as [{ n: number }];
  if (n >= RESET_EMAILS_PER_HOUR) return;
  const { token, expiresAt } = await db.transaction(async (tx) => {
    const t = await createInvite(tx, { orgId: u.orgId, userId: u.id });
    await writeAudit(tx, { orgId: u.orgId, userId: u.id }, { action: 'auth.password_reset_requested', entityType: 'user', entityId: u.id, after: { expiresAt: t.expiresAt } });
    return t;
  });
  await send({
    to: email,
    subject: 'Reset your Chairside password',
    text: [
      `Hello ${u.fullName},`,
      '',
      'Use this link to choose a new password. It works once and expires in 72 hours:',
      `${baseUrl.replace(/\/$/, '')}/setup?token=${token}`,
      '',
      `If you didn't ask for this, ignore this email; your password stays the same. (Expires ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.)`,
      '',
      'Chairside',
    ].join('\n'),
  });
}
