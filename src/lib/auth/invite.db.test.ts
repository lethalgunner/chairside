import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { passwordSetupTokens, users } from '@/db/schema';
import { createFixture, type Fixture } from '@/test/fixtures';
import { createInvite, describeInvite, redeemInvite } from './invite';
import { contextFromSession, signInWithPassword } from './session';

let f: Fixture;
let userId: string;
const email = `invitee-${Date.now()}@test.local`;

beforeAll(async () => {
  f = await createFixture();
  const [u] = await getDb().insert(users).values({ orgId: f.orgId, fullName: 'New Desk', email }).returning();
  userId = u!.id;
  const { memberships } = await import('@/db/schema');
  await getDb().insert(memberships).values({ orgId: f.orgId, userId, branchId: f.pune.id, role: 'front_desk' });
});
afterAll(async () => {
  await closeDb();
});

describe('invite links', () => {
  it('cannot sign in before the invite is used', async () => {
    const r = await signInWithPassword(email, 'anything at all');
    expect(r.ok).toBe(false);
  });

  it('sets the password once, signs in, and burns the token', async () => {
    const { token } = await createInvite(getDb(), { orgId: f.orgId, userId });
    expect(await describeInvite(token)).toEqual({ fullName: 'New Desk', email });
    expect(await redeemInvite(token, 'short', 'short')).toMatchObject({ ok: false });
    expect(await redeemInvite(token, 'a good long password', 'a different one!!')).toMatchObject({ ok: false });
    const ok = await redeemInvite(token, 'a good long password', 'a good long password');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await contextFromSession(ok.sessionId, undefined))?.ctx.branchIds).toEqual([f.pune.id]);
    expect(await describeInvite(token)).toBeNull();
    expect((await redeemInvite(token, 'another long password', 'another long password')).ok).toBe(false);
    expect((await signInWithPassword(email, 'a good long password')).ok).toBe(true);
    const stored = await getDb().select().from(passwordSetupTokens).where(eq(passwordSetupTokens.userId, userId));
    expect(stored.every((t) => t.tokenHash !== token && t.tokenHash.length === 64)).toBe(true);
  });

  it('a newer invite cancels the older one, and expired links fail', async () => {
    const first = await createInvite(getDb(), { orgId: f.orgId, userId });
    const second = await createInvite(getDb(), { orgId: f.orgId, userId });
    expect(await describeInvite(first.token)).toBeNull();
    expect(await describeInvite(second.token)).not.toBeNull();
    await getDb().update(passwordSetupTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordSetupTokens.userId, userId));
    expect((await redeemInvite(second.token, 'yet another password', 'yet another password')).ok).toBe(false);
    expect(await describeInvite('garbage')).toBeNull();
  });
});
