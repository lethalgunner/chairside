import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, memberships, providerBranches, providers, users } from '@/db/schema';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError } from './context';
import { issueBill } from './invoices';
import { registerPatient } from './patients';
import { addMeAsDoctor, doctorsWithoutProvider, hashCalendarToken, issueCalendarToken, revokeCalendarToken, listProviders, listProvidersForSettings, saveProvider, setProviderActive, setProviderHours } from './providers';
import { prescriberAt } from './rx';
import { inviteStaff } from './staff';

let f: Fixture;
let other: Fixture;
const tag = Date.now().toString(36);

const visiting = { fullName: 'Dr. Kavya Orthodontist', qualification: 'BDS, MDS (Ortho)', registrationNumber: 'A-9981', registrationCouncil: 'Uttar Pradesh State Dental Council', specialty: 'Orthodontics', engagementType: 'visiting', colour: '#7c3aed', slotMinutes: 30 };

async function patient(ctx = f.ctx('kanpurDesk')): Promise<string> {
  const phone = `96${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const r = await registerPatient(ctx, { fullName: `Patient ${phone}`, phone, sex: 'F', age: 30, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('doctor profiles (LET-166, ADR-008)', () => {
  let id: string;

  it('every doctor grant has a provider, with an id of its own', async () => {
    expect(await doctorsWithoutProvider(f.orgId)).toEqual([]);
    expect(f.doctorId).not.toBe(f.doctorUserId);
    expect((await listProviders(f.ctx('desk'), f.pune.id)).map((p) => p.id).sort()).toEqual([f.doctorId, f.ownerProviderId].sort());
    expect((await listProviders(f.ctx('kanpurDesk'), f.kanpur.id)).map((p) => p.id)).toEqual([f.ownerProviderId]);
  });

  it('inviting someone as a doctor creates their profile at that branch', async () => {
    const r = await inviteStaff(f.ctx('owner'), { fullName: 'Dr. New Joiner', email: `newdoc-${tag}@test.local`, role: 'doctor', branchId: f.kanpur.id, linkUserId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await doctorsWithoutProvider(f.orgId)).toEqual([]);
    const names = (await listProviders(f.ctx('kanpurDesk'), f.kanpur.id)).map((p) => p.fullName);
    expect(names).toContain('Dr. New Joiner');
  });

  it('owner adds a visiting doctor with no login, gives Kanpur hours, and the desk can bill for them', async () => {
    const r = await saveProvider(f.ctx('owner'), null, visiting);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    id = r.id;
    expect((await listProviders(f.ctx('kanpurDesk'), f.kanpur.id)).map((p) => p.id)).not.toContain(id);
    expect(await setProviderHours(f.ctx('owner'), id, f.kanpur.id, { days: [2, 4], startTime: '17:00', endTime: '20:00' })).toEqual({ ok: true });
    const listed = await listProviders(f.ctx('kanpurDesk'), f.kanpur.id);
    expect(listed.find((p) => p.id === id)).toMatchObject({ fullName: 'Dr. Kavya Orthodontist', slotMinutes: 30, colour: '#7c3aed' });
    const bill = await issueBill(f.ctx('kanpurDesk'), { patientId: await patient(), doctorId: id, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    expect(bill.kind).toBe('issued');

    const row = (await listProvidersForSettings(f.ctx('owner'))).find((p) => p.id === id)!;
    expect(row).toMatchObject({ userId: null, engagementType: 'visiting', hours: [{ branchName: 'Kanpur', days: [2, 4], startTime: '17:00', endTime: '20:00' }] });
    const audit = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.orgId, f.orgId)));
    expect(audit.map((a) => a.action).sort()).toEqual(['provider.create', 'provider.hours']);
  });

  it('edits keep the id; bad input comes back per field; bad hours are refused', async () => {
    expect(await saveProvider(f.ctx('owner'), id, { ...visiting, fullName: 'Dr. Kavya Rao' })).toEqual({ ok: true, id });
    const bad = await saveProvider(f.ctx('owner'), id, { ...visiting, slotMinutes: 7 });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { slotMinutes: expect.any(String) } });
    const hours = await setProviderHours(f.ctx('owner'), id, f.kanpur.id, { days: [], startTime: '19:00', endTime: '18:00' });
    expect(hours.ok).toBe(false);
  });

  it('a deactivated doctor leaves the lists and can no longer be billed', async () => {
    await setProviderActive(f.ctx('owner'), id, false);
    expect((await listProviders(f.ctx('kanpurDesk'), f.kanpur.id)).map((p) => p.id)).not.toContain(id);
    await expect(
      issueBill(f.ctx('kanpurDesk'), { patientId: await patient(), doctorId: id, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] }),
    ).rejects.toBeInstanceOf(UserFacingError);
    await setProviderActive(f.ctx('owner'), id, true);
  });

  it('removing a branch takes the doctor off that branch only', async () => {
    expect(await setProviderHours(f.ctx('owner'), id, f.kanpur.id, null)).toEqual({ ok: true });
    expect((await listProviders(f.ctx('kanpurDesk'), f.kanpur.id)).map((p) => p.id)).not.toContain(id);
  });

  it('only the owner manages doctors; other orgs are refused', async () => {
    for (const who of ['desk', 'manager', 'accountant'] as const) {
      await expect(saveProvider(f.ctx(who), null, visiting)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listProvidersForSettings(f.ctx(who))).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(saveProvider(other.ctx('owner'), id, visiting)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setProviderHours(other.ctx('owner'), id, other.kanpur.id, { days: [1], startTime: '10:00', endTime: '19:00' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setProviderHours(f.ctx('owner'), id, other.kanpur.id, { days: [1], startTime: '10:00', endTime: '19:00' })).rejects.toBeInstanceOf(ForbiddenError);
    // A provider from another org can't be put on a bill here.
    await expect(
      issueBill(f.ctx('desk'), { patientId: await patient(f.ctx('desk')), doctorId: other.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] }),
    ).rejects.toBeInstanceOf(UserFacingError);
    const [p] = await getDb().select().from(providers).where(eq(providers.id, id));
    expect(p!.orgId).toBe(f.orgId);
  });

  it('calendar link: shown once, stored only as a hash, replaced and revoked by the owner only', async () => {
    const t1 = await issueCalendarToken(f.ctx('owner'), f.doctorId);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [p1] = await getDb().select().from(providers).where(eq(providers.id, f.doctorId));
    expect(p1!.calendarTokenHash).toBe(hashCalendarToken(t1));
    expect(JSON.stringify(p1)).not.toContain(t1);
    const t2 = await issueCalendarToken(f.ctx('owner'), f.doctorId);
    expect(t2).not.toBe(t1);
    await expect(issueCalendarToken(f.ctx('desk'), f.doctorId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(issueCalendarToken(other.ctx('owner'), f.doctorId)).rejects.toBeInstanceOf(ForbiddenError);
    await revokeCalendarToken(f.ctx('owner'), f.doctorId);
    const [p2] = await getDb().select().from(providers).where(eq(providers.id, f.doctorId));
    expect(p2!.calendarTokenHash).toBeNull();
    const audit = await getDb().select().from(auditLog).where(eq(auditLog.entityId, f.doctorId));
    expect(JSON.stringify(audit)).not.toContain(t2);
  });
});

describe('owner who is also a doctor (QA 9 Nov)', () => {
  it('a new owner with no profile adds themselves: linked to their login, every branch, can prescribe', async () => {
    const db = getDb();
    const [u] = await db.insert(users).values({ orgId: f.orgId, fullName: `Dr Second Owner ${tag}`, email: `owner2-${tag}@test.local` }).returning();
    await db.insert(memberships).values({ orgId: f.orgId, userId: u!.id, branchId: null, role: 'owner' });
    const ctx = { ...f.ctx('owner', f.pune.id), userId: u!.id, userName: 'owner2' };
    expect(await prescriberAt(ctx, f.pune.id)).toBeNull();

    const { providerId } = await addMeAsDoctor(ctx);
    const [p] = await db.select().from(providers).where(eq(providers.id, providerId));
    expect(p).toMatchObject({ userId: u!.id, engagementType: 'owner_partner', active: true, fullName: `Dr Second Owner ${tag}` });
    const where = await db.select({ b: providerBranches.branchId }).from(providerBranches).where(eq(providerBranches.providerId, providerId));
    expect(where.map((w) => w.b).sort()).toEqual([f.kanpur.id, f.pune.id].sort());
    expect((await prescriberAt(ctx, f.pune.id))?.id).toBe(providerId);
    expect((await listProviders(ctx, f.kanpur.id)).map((x) => x.id)).toContain(providerId);

    // Pressing it again changes nothing.
    expect((await addMeAsDoctor(ctx)).providerId).toBe(providerId);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.entityId, providerId), eq(auditLog.action, 'provider.self_add')));
    expect(audit).toHaveLength(2);
  });

  it('a deactivated owner profile comes back', async () => {
    await setProviderActive(f.ctx('owner'), f.ownerProviderId, false);
    expect(await prescriberAt(f.ctx('owner', f.pune.id), f.pune.id)).toBeNull();
    expect((await addMeAsDoctor(f.ctx('owner'))).providerId).toBe(f.ownerProviderId);
    expect((await prescriberAt(f.ctx('owner', f.pune.id), f.pune.id))?.id).toBe(f.ownerProviderId);
  });

  it('only an owner can do it', async () => {
    await expect(addMeAsDoctor(f.ctx('desk'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addMeAsDoctor(f.ctx('manager'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
