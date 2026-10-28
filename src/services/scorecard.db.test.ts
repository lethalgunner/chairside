import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { dayBooks, usageEvents } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import type { CriterionResult } from '@/domain/scorecard';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError, type TenantContext } from './context';
import { issueBill, voidInvoice } from './invoices';
import { registerPatient } from './patients';
import { pilotScorecard, type Scorecard } from './scorecard';
import { recordDashboardView, recordRegistrationTime } from './usage';

/**
 * Pilot scorecard (T26) from seeded bills, day books with old-system figures
 * and usage events. Window: the default 5 days, today-4 … today.
 *
 *   Pune   today   2 bills live (+1 cancelled), old system 3 bills / ₹0      → not matched, 2 of 3 covered, closed
 *          today-1 closed, old 0 / ₹0, nothing in Chairside                 → matched, 0 of 0
 *          today-2 closed, old 2 / ₹0, nothing in Chairside                 → not matched, 0 of 2
 *          today-3 open book, nothing typed in                               → not matched
 *          today-5 closed, old 10: outside the window                        → ignored
 *          ⇒ share 2/5 = 40.0 % Not yet · matched 1 of 4 (need 4) Not yet · closed 3 of 4
 *   Kanpur today-1 closed, old 0 / ₹0                                        → matched 1 of 1 Pass, share No data
 *   Total  share 2/5 · matched 2 of 5 branch-days (need 4) · closed 4 of 5 branch-days
 *
 *   Registrations (ms): Pune 12 000, 50 000, 30 min (99 min clamped), one invalid (ignored);
 *   Kanpur 20 000. Pune median 50.0 s Not yet · Kanpur 20.0 s Pass · total (20 000+50 000)/2 = 35.0 s Pass.
 *
 *   Owner dashboard views: today-1 (twice), today-2 00:30 IST (= today-3 19:00 UTC),
 *   one just before the window, a manager's (not an owner) on today-3, another org's owner.
 *   Days with activity: today, -1, -2, -3 ⇒ 2 of 4 (need 3) Not yet; after today's view 3 of 4 Pass.
 */

let f: Fixture;
let other: Fixture;
const today = businessDate();
const d = (n: number) => addDays(today, -n);
const from = d(4);
const at = (iso: string) => new Date(iso);

const pick = (s: Scorecard, scope: string, k: CriterionResult['key']) => s.scopes.find((x) => x.name === scope)!.criteria.find((c) => c.key === k)!;

async function register(ctx: TenantContext, formMs: unknown) {
  const phone = `95${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const r = await registerPatient(ctx, { fullName: `Patient ${phone}`, phone, sex: 'F', age: 30, acknowledgedDuplicate: true, formMs });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
  const db = getDb();
  const desk = f.ctx('desk');

  // Registrations, timed in the browser.
  const patientId = await register(desk, 12_000);
  await register(desk, 50_000);
  await register(desk, 99 * 60_000);
  await register(desk, 'not a number');
  await register(f.ctx('kanpurDesk'), 20_000);

  // Today at Pune: two live bills and one cancelled.
  const ids: string[] = [];
  for (const item of [f.items.rct, f.items.brush, f.items.brush]) {
    const r = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: item, quantity: 1 }] });
    if (r.kind !== 'issued') throw new Error('not issued');
    ids.push(r.invoiceId);
  }
  await voidInvoice(f.ctx('owner', f.pune.id), ids[2]!, 'Billed twice by mistake', true);
  await db
    .update(dayBooks)
    .set({ status: 'closed', legacyBillCount: 3, legacyCollectedPaise: 0 })
    .where(and(eq(dayBooks.branchId, f.pune.id), eq(dayBooks.businessDate, today)));

  await db.insert(dayBooks).values([
    { orgId: f.orgId, branchId: f.pune.id, businessDate: d(1), status: 'closed', legacyBillCount: 0, legacyCollectedPaise: 0 },
    { orgId: f.orgId, branchId: f.pune.id, businessDate: d(2), status: 'closed', legacyBillCount: 2, legacyCollectedPaise: 0 },
    { orgId: f.orgId, branchId: f.pune.id, businessDate: d(3), status: 'open' },
    { orgId: f.orgId, branchId: f.pune.id, businessDate: d(5), status: 'closed', legacyBillCount: 10, legacyCollectedPaise: 0 },
    { orgId: f.orgId, branchId: f.kanpur.id, businessDate: d(1), status: 'closed', legacyBillCount: 0, legacyCollectedPaise: 0 },
    // Another org, same dates: must never be counted.
    { orgId: other.orgId, branchId: other.pune.id, businessDate: d(1), status: 'closed', legacyBillCount: 40, legacyCollectedPaise: 0 },
  ]);

  const view = (orgId: string, userId: string, occurredAt: Date) => ({ orgId, userId, kind: 'dashboard_view', occurredAt });
  await db.insert(usageEvents).values([
    view(f.orgId, f.ownerId, at(`${d(1)}T12:00:00+05:30`)),
    view(f.orgId, f.ownerId, at(`${d(1)}T23:59:00+05:30`)),
    view(f.orgId, f.ownerId, at(`${d(3)}T19:00:00Z`)), // 00:30 IST on today-2
    view(f.orgId, f.ownerId, at(`${d(5)}T23:59:00+05:30`)), // one minute before the window opens
    view(f.orgId, f.ctx('manager').userId, at(`${d(3)}T20:00:00+05:30`)),
    view(other.orgId, other.ownerId, at(`${d(3)}T20:00:00+05:30`)),
    { orgId: other.orgId, branchId: other.pune.id, userId: other.ownerId, kind: 'patient_register', durationMs: 1_000 },
  ]);
});

afterAll(async () => {
  await closeDb();
});

describe('pilot scorecard (T26)', () => {
  it('scores each branch and the total from bills, day books and usage events', async () => {
    const s = await pilotScorecard(f.ctx('owner', 'all'), [f.kanpur.id, f.pune.id], from, today);
    expect(s.scopes.map((x) => x.name)).toEqual(['All branches in view', 'Kanpur', 'Pune']);

    expect(pick(s, 'Pune', 'billShare')).toMatchObject({ measured: '40.0% (2 of 5 old-system bills)', label: 'Not yet' });
    expect(pick(s, 'Pune', 'dayTotals')).toMatchObject({ measured: '1 of 4 days matched', threshold: '4 of 4 days with activity (4 of every 5)', label: 'Not yet' });
    expect(pick(s, 'Pune', 'registration')).toMatchObject({ measured: '50.0 s (3 registrations)', label: 'Not yet' });
    expect(pick(s, 'Pune', 'dashboard')).toMatchObject({ measured: '2 of 4 days', label: 'Not yet' });
    expect(pick(s, 'Pune', 'closed')).toMatchObject({ measured: '3 of 4 days with activity', label: 'For information' });

    expect(pick(s, 'Kanpur', 'billShare').label).toBe('No data');
    expect(pick(s, 'Kanpur', 'dayTotals')).toMatchObject({ measured: '1 of 1 day matched', label: 'Pass' });
    expect(pick(s, 'Kanpur', 'registration')).toMatchObject({ measured: '20.0 s (1 registration)', label: 'Pass' });
    expect(pick(s, 'Kanpur', 'dashboard')).toMatchObject({ measured: '1 of 1 day', label: 'Pass' });

    const total = 'All branches in view';
    expect(pick(s, total, 'billShare')).toMatchObject({ measured: '40.0% (2 of 5 old-system bills)', label: 'Not yet' });
    expect(pick(s, total, 'dayTotals')).toMatchObject({ measured: '2 of 5 branch-days matched', label: 'Not yet' });
    expect(pick(s, total, 'registration')).toMatchObject({ measured: '35.0 s (4 registrations)', label: 'Pass' });
    expect(pick(s, total, 'dashboard')).toMatchObject({ measured: '2 of 4 days', label: 'Not yet' });
    expect(pick(s, total, 'closed')).toMatchObject({ measured: '4 of 5 branch-days with activity' });
  });

  it('records one dashboard view per person per IST day, only for people who see reports', async () => {
    const countToday = async (userId: string) =>
      (await getDb().select().from(usageEvents).where(and(eq(usageEvents.userId, userId), eq(usageEvents.kind, 'dashboard_view')))).filter(
        (r) => businessDate(r.occurredAt) === today,
      ).length;
    await recordDashboardView(f.ctx('owner', 'all'));
    await recordDashboardView(f.ctx('owner', f.pune.id));
    expect(await countToday(f.ownerId)).toBe(1);
    await recordDashboardView(f.ctx('desk'));
    expect(await countToday(f.ctx('desk').userId)).toBe(0);

    const s = await pilotScorecard(f.ctx('owner', 'all'), [f.kanpur.id, f.pune.id], from, today);
    expect(pick(s, 'All branches in view', 'dashboard')).toMatchObject({ measured: '3 of 4 days', label: 'Pass' });
  });

  it('keeps only usage fields: no patient data can be stored', async () => {
    const [row] = await getDb().select().from(usageEvents).where(and(eq(usageEvents.orgId, f.orgId), eq(usageEvents.kind, 'patient_register'))).limit(1);
    expect(Object.keys(row!).sort()).toEqual(['branchId', 'durationMs', 'id', 'kind', 'occurredAt', 'orgId', 'userId']);
    await expect(getDb().insert(usageEvents).values({ orgId: f.orgId, userId: f.ownerId, kind: 'patient_name' })).rejects.toThrow();
  });

  it('never breaks the main action: a failed write is swallowed and logged without data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(recordRegistrationTime(f.ctx('desk'), randomUUID(), 1_000)).resolves.toBeUndefined(); // FK violation
    expect(warn).toHaveBeenCalledWith('[usage] could not record patient_register');
    warn.mockRestore();
  });

  it('respects branch scoping: a Pune manager sees Pune only', async () => {
    const s = await pilotScorecard(f.ctx('manager'), [f.kanpur.id, f.pune.id], from, today);
    expect(s.scopes.map((x) => x.name)).toEqual(['Pune']);
    const owner = await pilotScorecard(f.ctx('owner', f.pune.id), [f.pune.id], from, today);
    expect(owner.scopes.map((x) => x.name)).toEqual(['Pune']);
  });

  it('is open to the accountant and refused to the front desk', async () => {
    const ca = await pilotScorecard(f.ctx('accountant', 'all'), [f.kanpur.id, f.pune.id], from, today);
    expect(ca.scopes).toHaveLength(3);
    await expect(pilotScorecard(f.ctx('desk'), [f.pune.id], from, today)).rejects.toThrow(ForbiddenError);
  });

  it('never counts another org’s data', async () => {
    // The other org has its own owner view, day book and registration; its scorecard sees only those.
    const s = await pilotScorecard(other.ctx('owner', 'all'), [other.kanpur.id, other.pune.id], from, today);
    expect(pick(s, 'Pune', 'billShare')).toMatchObject({ measured: '0.0% (0 of 40 old-system bills)' });
    expect(pick(s, 'Pune', 'registration')).toMatchObject({ measured: '1.0 s (1 registration)' });
    expect(pick(s, 'Pune', 'dashboard')).toMatchObject({ measured: '0 of 1 day' });
    // And our org's branches are invisible to the other org's owner.
    await expect(pilotScorecard(other.ctx('owner', 'all'), [f.pune.id], from, today)).rejects.toThrow(ForbiddenError);
  });
});
