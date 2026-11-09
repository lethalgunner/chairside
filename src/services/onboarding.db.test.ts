import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { closeDb, getDb } from '@/db/client';
import { auditLog, branches, memberships, organisations, providers, users } from '@/db/schema';
import { checkSignup, type SignupInput } from '@/domain/signup';
import { contextFromSession, signInWithPassword } from '@/lib/auth/session';
import { createFixture } from '@/test/fixtures';
import { REQUIRED_STEPS, setupProgress, signUpClinic } from './onboarding';

afterAll(async () => {
  await closeDb();
});

const tag = randomUUID().slice(0, 8);
const input = (over: Partial<SignupInput> = {}): SignupInput => ({
  clinicName: `Smile ${tag}`, fullName: 'Dr Meera Rao', email: `meera-${tag}@signup.test`, password: 'long enough pw', confirm: 'long enough pw',
  branchCode: 'SMC', branchName: 'Smile Baner', city: 'Pune', state: 'Maharashtra', gstRegistered: false, gstin: '', isDentist: true, ...over,
});
const values = (over: Partial<SignupInput> = {}) => {
  const c = checkSignup(input(over));
  if (!c.ok) throw new Error(JSON.stringify(c.fieldErrors));
  return c.value;
};

describe('clinic sign-up (Sprint 7)', () => {
  it('creates the clinic, branch, owner login and doctor profile; signs in; parallel run off; audited', async () => {
    const res = await signUpClinic(values());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const db = getDb();
    const [org] = await db.select().from(organisations).where(eq(organisations.id, res.orgId));
    expect(org).toMatchObject({ name: `Smile ${tag}`, parallelRun: false });
    const [b] = await db.select().from(branches).where(eq(branches.orgId, res.orgId));
    expect(b).toMatchObject({ code: 'SMC', name: 'Smile Baner', state: 'Maharashtra', gstRegistered: false });
    const grants = await db.select().from(memberships).where(eq(memberships.userId, res.userId));
    expect(grants.map((g) => [g.role, g.branchId])).toEqual([['owner', null]]);
    const [p] = await db.select().from(providers).where(eq(providers.userId, res.userId));
    expect(p).toMatchObject({ engagementType: 'owner_partner', orgId: res.orgId });
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, res.orgId), eq(auditLog.action, 'org.signup')));
    expect(audit).toHaveLength(1);

    const signed = await signInWithPassword(`meera-${tag}@signup.test`, 'long enough pw');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const ctx = (await contextFromSession(signed.sessionId, undefined))!.ctx;
    expect(ctx.branchIds).toEqual([b!.id]);
    const steps = await setupProgress(ctx);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['doctors']);
    expect(REQUIRED_STEPS.filter((k) => !steps.find((s) => s.key === k)!.done)).toEqual(['prices', 'patient', 'bill']);
  });

  it('a non-dentist owner gets no doctor profile', async () => {
    const res = await signUpClinic(values({ email: `owner2-${tag}@signup.test`, isDentist: false, clinicName: `Owner2 ${tag}` }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await getDb().select().from(providers).where(eq(providers.userId, res.userId))).toHaveLength(0);
  });

  it('an email already in use is refused on the field, and nothing is created', async () => {
    const f = await createFixture();
    const before = (await getDb().select().from(organisations)).length;
    const res = await signUpClinic(values({ email: f.emails.desk, clinicName: `Dup ${tag}` }));
    expect(res.ok ? null : res.fieldErrors.email).toContain('already exists');
    expect((await getDb().select().from(organisations)).length).toBe(before);
    expect(await getDb().select().from(users).where(eq(users.fullName, 'nobody'))).toHaveLength(0);
  });

  it('an existing, set-up clinic counts its steps as done', async () => {
    const f = await createFixture();
    const steps = await setupProgress(f.ctx('owner'));
    // The fixture has prices and doctors; no patients or bills yet.
    expect(steps.find((s) => s.key === 'prices')!.done).toBe(true);
    expect(steps.find((s) => s.key === 'doctors')!.done).toBe(true);
  });
});
