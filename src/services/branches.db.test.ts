import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, branches } from '@/db/schema';
import type { BranchDetailsInput } from '@/domain/branch';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { listBranchSettings, updateBranchDetails } from './branches';
import { ForbiddenError } from './context';
import { getInvoice, issueBill } from './invoices';
import { registerPatient } from './patients';

let f: Fixture;
let other: Fixture;

const kanpur = (over: Partial<BranchDetailsInput> = {}): BranchDetailsInput => ({
  name: 'Kanpur',
  addressLine: '',
  city: 'Kanpur',
  state: 'Uttar Pradesh',
  phone: '',
  gstRegistered: true,
  gstin: '09ABCDE1234F1Z5',
  dayCloseTolerance: '100',
  defaultFloat: '0',
  ...over,
});

async function brushBillAtKanpur() {
  const ctx = f.ctx('owner', f.kanpur.id);
  const phone = `96${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const p = await registerPatient(ctx, { fullName: `Patient ${phone}`, phone, sex: 'F', age: 40, acknowledgedDuplicate: true });
  if (!p.ok) throw new Error('registration failed');
  const res = await issueBill(ctx, { patientId: p.patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 1 }] });
  if (res.kind !== 'issued') throw new Error('not issued');
  return (await getInvoice(ctx, res.invoiceId))!;
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
  // The fixture's associate doctor works at Pune only; let them bill at Kanpur too.
  const { memberships } = await import('@/db/schema');
  await getDb().insert(memberships).values({ orgId: f.orgId, userId: f.doctorId, branchId: f.kanpur.id, role: 'associate_doctor' });
});
afterAll(async () => {
  await closeDb();
});

describe('branch settings (T16)', () => {
  it('marks Kanpur GST-registered; later bills charge GST, earlier ones keep their snapshot', async () => {
    const before = await brushBillAtKanpur();
    expect(before.gstRegistered).toBe(false);
    expect(before.totals.totalPaise).toBe(12_000); // toothbrush, no GST at an unregistered branch

    expect(await updateBranchDetails(f.ctx('owner'), f.kanpur.id, kanpur())).toEqual({ ok: true });
    const [row] = await getDb().select().from(branches).where(eq(branches.id, f.kanpur.id));
    expect(row).toMatchObject({ gstRegistered: true, gstin: '09ABCDE1234F1Z5', code: f.kanpur.code, dayCloseTolerancePaise: 10_000 });

    const after = await brushBillAtKanpur();
    expect(after.gstRegistered).toBe(true);
    expect(after.gstin).toBe('09ABCDE1234F1Z5');
    expect(after.totals.totalPaise).toBe(14_200); // 120.00 + 18 % = 141.60 → rounded to 142.00

    const reread = await getInvoice(f.ctx('owner', f.kanpur.id), before.id);
    expect(reread!.gstRegistered).toBe(false);
    expect(reread!.gstin).toBeNull();
    expect(reread!.totals).toEqual(before.totals);
  });

  it('refuses a GSTIN from another state and saves nothing', async () => {
    const r = await updateBranchDetails(f.ctx('owner'), f.kanpur.id, kanpur({ gstin: '27AAAAA0000A1Z5', city: 'Changed' }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { gstin: expect.stringMatching(/starts with 09/) } });
    const [row] = await getDb().select().from(branches).where(eq(branches.id, f.kanpur.id));
    expect(row!.city).toBe('Kanpur');
  });

  it('turning registration off clears the GSTIN, and every save is audited', async () => {
    await updateBranchDetails(f.ctx('owner'), f.kanpur.id, kanpur({ gstRegistered: false, defaultFloat: '1500' }));
    const [row] = await getDb().select().from(branches).where(eq(branches.id, f.kanpur.id));
    expect(row).toMatchObject({ gstRegistered: false, gstin: null, defaultFloatPaise: 150_000 });
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, f.kanpur.id));
    expect(audits.filter((a) => a.action === 'branch.update')).toHaveLength(2);
    const flags = audits.map((a) => [(a.before as { gstRegistered: boolean }).gstRegistered, (a.after as { gstRegistered: boolean }).gstRegistered]);
    expect(flags).toEqual(expect.arrayContaining([[false, true], [true, false]]));
  });

  it('is owner only, and never reaches another org', async () => {
    await expect(updateBranchDetails(f.ctx('manager'), f.pune.id, kanpur({ state: 'Maharashtra', gstin: '27AAAAA0000A1Z5' }))).rejects.toThrow(ForbiddenError);
    await expect(updateBranchDetails(f.ctx('desk'), f.pune.id, kanpur())).rejects.toThrow(ForbiddenError);
    await expect(listBranchSettings(f.ctx('manager'))).rejects.toThrow(ForbiddenError);
    await expect(updateBranchDetails(f.ctx('owner'), other.kanpur.id, kanpur())).rejects.toThrow(ForbiddenError);
    expect((await listBranchSettings(f.ctx('owner'))).map((b) => b.id).sort()).toEqual([f.kanpur.id, f.pune.id].sort());
  });
});
