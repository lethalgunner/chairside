import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, proceduresPerformed } from '@/db/schema';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError } from './context';
import { getInvoice, issueBill, voidInvoice } from './invoices';
import { registerPatient } from './patients';
import { addPlanItems, createPlan, dropPlanItem, getPlan, markItemsDone, patientWork, setPlanStatus, updatePlanItem } from './plans';
import { dismissProcedure } from './procedures';
import { unbilledProcedures } from './reports';

let f: Fixture;
let other: Fixture;
let pid: string;
let planId: string;

const line = (catalogueItemId: string, extra: Partial<{ toothNumber: string; quantity: number; price: string; priceReason: string; session: number }> = {}) => ({ catalogueItemId, toothNumber: '', quantity: 1, price: '', priceReason: '', session: 1, ...extra });

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
  const r = await registerPatient(f.ctx('desk'), { fullName: 'Plan Patient', phone: `94${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, sex: 'F', age: 40, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  pid = r.patientId;
});
afterAll(async () => {
  await closeDb();
});

describe('treatment plans (LET-168/169)', () => {
  it('a doctor plans RCT + crown over two sittings; the estimate adds GST like a bill would', async () => {
    const r = await createPlan(f.ctx('owner', f.pune.id), {
      patientId: pid,
      providerId: f.doctorId,
      title: 'Lower left RCT and crown',
      items: [
        line(f.items.rct, { toothNumber: '36', price: '4,000', priceReason: 'Agreed with patient: second RCT this year' }),
        line(f.items.crown, { toothNumber: '36', session: 2 }),
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    planId = r.id;
    const plan = (await getPlan(f.ctx('desk'), planId))!;
    expect(plan).toMatchObject({ status: 'draft', ref: `EST/${f.pune.code}/0001`, doctorName: 'Dr Associate' });
    expect(plan.items.map((i) => [i.name, i.unitPricePaise, i.session, i.stage])).toEqual([
      ['Root canal treatment', 400_000, 1, 'planned'],
      ['Zirconia crown', 600_000, 2, 'planned'],
    ]);
    // Pune is GST-registered: crown 12 % = ₹720 on ₹6,000; RCT exempt.
    expect(plan.totals).toMatchObject({ estimateTotalPaise: 1_072_000, estimateTaxPaise: 72_000, todoPaise: 1_000_000 });
  });

  it('refuses a changed price without a reason, an unknown item and a doctor from elsewhere', async () => {
    const r = await createPlan(f.ctx('owner', f.pune.id), { patientId: pid, providerId: other.doctorId, title: 'x', items: [line(f.items.rct, { price: '1' }), line(other.items.rct)] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(['providerId', 'title']);
    expect(Object.keys(r.itemErrors ?? {})).toEqual(['0', '1']);
  });

  it('marking sitting 1 done records the work at the agreed price; the bill uses it unchanged', async () => {
    const plan = (await getPlan(f.ctx('desk'), planId))!;
    const rct = plan.items[0]!;
    await expect(markItemsDone(f.ctx('desk'), planId, [rct.id])).rejects.toBeInstanceOf(ForbiddenError); // the desk doesn't record clinical work
    expect(await markItemsDone(f.ctx('owner', f.pune.id), planId, [rct.id])).toEqual({ done: 1 });
    await expect(markItemsDone(f.ctx('owner', f.pune.id), planId, [rct.id])).rejects.toBeInstanceOf(UserFacingError);
    const after = (await getPlan(f.ctx('desk'), planId))!;
    expect(after.status).toBe('accepted'); // doing work accepts a draft
    expect(after.items[0]!.stage).toBe('done_unbilled');
    const unbilled = (await unbilledProcedures(f.ctx('desk'), [f.pune.id])).filter((u) => u.patientId === pid);
    expect(unbilled.map((u) => [u.itemName, u.valuePaise])).toEqual([['Root canal treatment', 400_000]]);
    const work = (await patientWork(f.ctx('desk'), pid))!;
    expect(work).toMatchObject({ todoPaise: 600_000, doneUnbilledCount: 1, doneUnbilledPaise: 400_000, openPlans: 1 });

    const bill = await issueBill(f.ctx('desk'), { patientId: pid, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ procedureId: unbilled[0]!.procedureId, quantity: 1 }] });
    if (bill.kind !== 'issued') throw new Error('not issued');
    const inv = (await getInvoice(f.ctx('desk'), bill.invoiceId))!;
    expect(inv.lines[0]).toMatchObject({ unitPricePaise: 400_000, description: 'Root canal treatment, tooth 36' });
    expect((await getPlan(f.ctx('desk'), planId))!.items[0]!.stage).toBe('billed');
    expect((await getPlan(f.ctx('desk'), planId))!.totals).toMatchObject({ billedPaise: 400_000, todoPaise: 600_000 });

    // Cancelling the bill with "work was done" puts it back to done-not-billed.
    await voidInvoice(f.ctx('owner', f.pune.id), bill.invoiceId, 'Wrong doctor on the bill', true);
    expect((await getPlan(f.ctx('desk'), planId))!.items[0]!.stage).toBe('done_unbilled');
  });

  it('work removed as "not done" returns to the plan as to-do', async () => {
    const r = await addPlanItems(f.ctx('owner', f.pune.id), planId, [line(f.items.rct, { toothNumber: '46', session: 3 })]);
    expect(r.ok).toBe(true);
    const item = (await getPlan(f.ctx('desk'), planId))!.items.find((i) => i.toothNumber === '46')!;
    await markItemsDone(f.ctx('owner', f.pune.id), planId, [item.id]);
    const [proc] = await getDb().select().from(proceduresPerformed).where(eq(proceduresPerformed.toothNumber, '46'));
    await dismissProcedure(f.ctx('owner', f.pune.id), proc!.id, 'Ticked the wrong tooth');
    expect((await getPlan(f.ctx('desk'), planId))!.items.find((i) => i.id === item.id)!.stage).toBe('planned');
  });

  it('changes and drops only to-do work, with reasons; cancel drops what is left', async () => {
    const plan = (await getPlan(f.ctx('desk'), planId))!;
    const crown = plan.items.find((i) => i.name === 'Zirconia crown')!;
    const done = plan.items.find((i) => i.stage === 'done_unbilled')!;
    expect(await updatePlanItem(f.ctx('owner', f.pune.id), crown.id, { toothNumber: '36', quantity: 1, price: '5500', priceReason: 'Lab rate lower', session: 2 })).toEqual({ ok: true });
    expect((await getPlan(f.ctx('desk'), planId))!.items.find((i) => i.id === crown.id)!.unitPricePaise).toBe(550_000);
    await expect(updatePlanItem(f.ctx('owner', f.pune.id), done.id, { toothNumber: '36', quantity: 1, price: '', priceReason: '', session: 1 })).rejects.toBeInstanceOf(UserFacingError);
    await expect(dropPlanItem(f.ctx('owner', f.pune.id), crown.id, '')).rejects.toBeInstanceOf(UserFacingError);
    await expect(setPlanStatus(f.ctx('owner', f.pune.id), planId, 'cancelled', '')).rejects.toBeInstanceOf(UserFacingError);
    await setPlanStatus(f.ctx('owner', f.pune.id), planId, 'cancelled', 'Patient moving cities');
    const after = (await getPlan(f.ctx('desk'), planId))!;
    expect(after.status).toBe('cancelled');
    expect(after.items.filter((i) => i.stage === 'dropped').length).toBeGreaterThanOrEqual(2);
    expect(after.items.some((i) => i.stage === 'done_unbilled')).toBe(true); // done work stays to be billed
    await expect(addPlanItems(f.ctx('owner', f.pune.id), planId, [line(f.items.rct)])).rejects.toBeInstanceOf(UserFacingError);
    const audit = await getDb().select().from(auditLog).where(eq(auditLog.entityId, planId));
    expect(new Set(audit.map((a) => a.action))).toEqual(new Set(['plan.create', 'plan.items_done', 'plan.items_added', 'plan.item_changed', 'plan.cancelled']));
  });

  it('estimate numbers count up per branch; other orgs see and change nothing', async () => {
    const r = await createPlan(f.ctx('owner', f.pune.id), { patientId: pid, providerId: f.ownerProviderId, title: 'Cleaning', items: [line(f.items.whitening)] });
    expect(r.ok && (await getPlan(f.ctx('desk'), r.id))!.ref).toBe(`EST/${f.pune.code}/0002`);
    expect(await getPlan(other.ctx('owner'), planId)).toBeNull();
    await expect(setPlanStatus(other.ctx('owner'), planId, 'accepted')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPlan(f.ctx('accountant', f.pune.id), { patientId: pid, providerId: f.doctorId, title: 'Nope', items: [line(f.items.rct)] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
