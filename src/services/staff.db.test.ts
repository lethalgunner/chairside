import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, memberships, sessions, users } from '@/db/schema';
import { describeInvite, redeemInvite } from '@/lib/auth/invite';
import { contextFromSession, signInWithPassword } from '@/lib/auth/session';
import { createFixture, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError, type TenantContext } from './context';
import { inviteStaff, listStaff, listWithoutLogin, reissueInvite, setStaffActive } from './staff';

let f: Fixture;
let other: Fixture;
let owner: TenantContext;
const tag = Date.now().toString(36);
const email = (who: string) => `${who}-${tag}@test.local`;

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
  owner = f.ctx('owner');
});
afterAll(async () => {
  await closeDb();
});

describe('team: invite (T14)', () => {
  it('creates a front desk login whose link sets a password once', async () => {
    const r = await inviteStaff(owner, { fullName: 'Ravi New', email: ` ${email('ravi').toUpperCase()} `, role: 'front_desk', branchId: f.kanpur.id, linkUserId: null });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.token) throw new Error('no token');
    const [u] = await getDb().select().from(users).where(eq(users.id, r.userId));
    expect(u!.email).toBe(email('ravi'));
    expect(u!.passwordHash).toBeNull();

    let row = (await listStaff(owner)).find((p) => p.id === r.userId)!;
    expect(row.status).toBe('pending');
    expect(row.grants).toEqual([{ role: 'front_desk', branchName: 'Kanpur' }]);

    const redeemed = await redeemInvite(r.token, 'ravi has a long password', 'ravi has a long password');
    expect(redeemed.ok).toBe(true);
    if (redeemed.ok) expect((await contextFromSession(redeemed.sessionId, undefined))?.ctx.branchIds).toEqual([f.kanpur.id]);
    row = (await listStaff(owner)).find((p) => p.id === r.userId)!;
    expect(row.status).toBe('set_up');

    // The raw token is nowhere in the audit trail.
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, r.userId));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['staff.create', 'staff.invite']));
    expect(JSON.stringify(audits)).not.toContain(r.token);
  });

  it('adds a role to someone who already signs in, without issuing a reset link', async () => {
    const r = await inviteStaff(owner, { fullName: 'Desk Pune', email: f.emails.desk, role: 'assistant', branchId: f.pune.id, linkUserId: null });
    expect(r).toMatchObject({ ok: true, token: null });
    expect((await signInWithPassword(f.emails.desk, f.password)).ok).toBe(true);
  });

  it('refuses an email that belongs to another organisation', async () => {
    await expect(inviteStaff(owner, { fullName: 'Spy', email: other.emails.desk, role: 'front_desk', branchId: f.pune.id, linkUserId: null })).rejects.toThrow(UserFacingError);
  });

  it('refuses a branch from another organisation', async () => {
    await expect(inviteStaff(owner, { fullName: 'Lost', email: email('lost'), role: 'front_desk', branchId: other.pune.id, linkUserId: null })).rejects.toThrow(UserFacingError);
  });

  it('returns field errors for an owner tied to a branch', async () => {
    const r = await inviteStaff(owner, { fullName: 'Co Owner', email: email('co'), role: 'owner', branchId: f.pune.id, linkUserId: null });
    expect(r).toMatchObject({ ok: false, fieldErrors: { branchId: expect.any(String) } });
  });

  it('gives an existing doctor record a login instead of creating a second person', async () => {
    const before = await listWithoutLogin(owner);
    expect(before.map((p) => p.id)).toContain(f.doctorId);
    const r = await inviteStaff(owner, { fullName: '', email: email('assoc'), role: 'associate_doctor', branchId: f.pune.id, linkUserId: f.doctorId });
    expect(r).toMatchObject({ ok: true, userId: f.doctorId, fullName: 'Dr Associate' });
    expect((await listWithoutLogin(owner)).map((p) => p.id)).not.toContain(f.doctorId);
  });

  it('is owner only: a branch manager and the front desk are refused', async () => {
    const input = { fullName: 'X Y', email: email('x'), role: 'front_desk', branchId: f.pune.id, linkUserId: null };
    await expect(inviteStaff(f.ctx('manager'), input)).rejects.toThrow(ForbiddenError);
    await expect(inviteStaff(f.ctx('desk'), input)).rejects.toThrow(ForbiddenError);
    await expect(listStaff(f.ctx('manager'))).rejects.toThrow(ForbiddenError);
  });
});

describe('team: new link', () => {
  it('cancels the old link and refuses once a password is set', async () => {
    const r = await inviteStaff(owner, { fullName: 'Meera Late', email: email('meera'), role: 'front_desk', branchId: f.pune.id, linkUserId: null });
    if (!r.ok || !r.token) throw new Error('no token');
    const second = await reissueInvite(owner, r.userId);
    expect(await describeInvite(r.token)).toBeNull();
    expect(await describeInvite(second.token)).not.toBeNull();
    expect((await redeemInvite(second.token, 'meera long password', 'meera long password')).ok).toBe(true);
    await expect(reissueInvite(owner, r.userId)).rejects.toThrow(/already set a password/);
  });

  it('cannot reach a user in another organisation', async () => {
    await expect(reissueInvite(owner, other.ownerId)).rejects.toThrow(ForbiddenError);
    await expect(setStaffActive(owner, other.ownerId, false)).rejects.toThrow(ForbiddenError);
  });
});

describe('team: deactivate and reactivate', () => {
  it('signs the person out everywhere, blocks sign-in, and can be undone', async () => {
    const r = await inviteStaff(owner, { fullName: 'Sunil Leaving', email: email('sunil'), role: 'front_desk', branchId: f.pune.id, linkUserId: null });
    if (!r.ok || !r.token) throw new Error('no token');
    const s = await redeemInvite(r.token, 'sunil long password', 'sunil long password');
    if (!s.ok) throw new Error('redeem failed');

    await setStaffActive(owner, r.userId, false);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, r.userId))).toHaveLength(0);
    expect(await contextFromSession(s.sessionId, undefined)).toBeNull();
    expect((await signInWithPassword(email('sunil'), 'sunil long password')).ok).toBe(false);
    expect((await listStaff(owner)).find((p) => p.id === r.userId)!.active).toBe(false);

    await setStaffActive(owner, r.userId, true);
    expect((await signInWithPassword(email('sunil'), 'sunil long password')).ok).toBe(true);
    const actions = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, r.userId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['staff.deactivate', 'staff.reactivate']));
  });

  it('cancels an unused link on deactivation', async () => {
    const r = await inviteStaff(owner, { fullName: 'Never Came', email: email('never'), role: 'front_desk', branchId: f.pune.id, linkUserId: null });
    if (!r.ok || !r.token) throw new Error('no token');
    await setStaffActive(owner, r.userId, false);
    await setStaffActive(owner, r.userId, true);
    expect(await describeInvite(r.token)).toBeNull();
  });

  it('refuses to deactivate yourself', async () => {
    await expect(setStaffActive(owner, f.ownerId, false)).rejects.toThrow(/yourself/);
  });

  it('never leaves the clinic without an active owner', async () => {
    // An owner-level context for a user who is not themself an owner row: the
    // only way to reach the guard, since any real owner acting is another owner.
    const actor: TenantContext = { ...f.ctx('manager'), grants: [{ role: 'owner', branchId: null }] };
    await expect(setStaffActive(actor, f.ownerId, false)).rejects.toThrow(/last active owner/);

    // With a second active owner, the first can go.
    const co = await inviteStaff(owner, { fullName: 'Co Owner', email: email('coowner'), role: 'owner', branchId: null, linkUserId: null });
    if (!co.ok) throw new Error('invite failed');
    const coCtx: TenantContext = { ...owner, userId: co.userId };
    await setStaffActive(coCtx, f.ownerId, false);
    await expect(setStaffActive(actor, co.userId, false)).rejects.toThrow(/last active owner/);
    await setStaffActive(coCtx, f.ownerId, true);
    const [g] = await getDb().select().from(memberships).where(and(eq(memberships.userId, co.userId), eq(memberships.role, 'owner')));
    expect(g!.branchId).toBeNull();
  });
});
