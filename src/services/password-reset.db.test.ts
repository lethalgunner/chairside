import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, passwordSetupTokens, users } from '@/db/schema';
import { redeemInvite } from '@/lib/auth/invite';
import { createFixture, type Fixture } from '@/test/fixtures';
import { requestPasswordReset, RESET_EMAILS_PER_HOUR } from './password-reset';

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('forgot password by email (Sprint 7)', () => {
  it('emails a one-time link that sets a new password', async () => {
    const send = vi.fn().mockResolvedValue({ sent: true });
    await requestPasswordReset(`  ${f.emails.desk.toUpperCase()} `, 'https://app.test/', send);
    expect(send).toHaveBeenCalledTimes(1);
    const m = send.mock.calls[0]![0];
    expect(m.to).toBe(f.emails.desk);
    const token = /\/setup\?token=([\w-]+)/.exec(m.text)![1]!;
    expect(m.text).toContain('https://app.test/setup?token=');
    const r = await redeemInvite(token, 'a brand new password', 'a brand new password');
    expect(r.ok).toBe(true);
    const [u] = await getDb().select().from(users).where(eq(users.email, f.emails.desk));
    const audit = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, u!.id), eq(auditLog.action, 'auth.password_reset_requested')));
    expect(audit).toHaveLength(1);
  });
  it('says nothing and sends nothing for unknown, malformed or deactivated addresses', async () => {
    const send = vi.fn();
    await requestPasswordReset('nobody@nowhere.test', 'https://app.test', send);
    await requestPasswordReset('not an email', 'https://app.test', send);
    await getDb().update(users).set({ active: false }).where(eq(users.email, f.emails.accountant));
    await requestPasswordReset(f.emails.accountant, 'https://app.test', send);
    expect(send).not.toHaveBeenCalled();
  });
  it(`stops after ${RESET_EMAILS_PER_HOUR} emails an hour`, async () => {
    const send = vi.fn().mockResolvedValue({ sent: true });
    for (let i = 0; i < RESET_EMAILS_PER_HOUR + 2; i++) await requestPasswordReset(f.emails.manager, 'https://app.test', send);
    expect(send).toHaveBeenCalledTimes(RESET_EMAILS_PER_HOUR);
    const [u] = await getDb().select().from(users).where(eq(users.email, f.emails.manager));
    const open = await getDb().select().from(passwordSetupTokens).where(eq(passwordSetupTokens.userId, u!.id));
    expect(open.length).toBe(RESET_EMAILS_PER_HOUR);
  });
});
