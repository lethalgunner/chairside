import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, proceduresPerformed } from '@/db/schema';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import type { TenantContext } from './context';
import { ForbiddenError, UserFacingError } from './context';
import { issueBill, voidInvoice } from './invoices';
import { registerPatient } from './patients';
import { dismissProcedure } from './procedures';
import { dashboard, unbilledProcedures } from './reports';

/** "Was this work done?" and "Not done: remove" (Q20, T28). */
let f: Fixture;
let other: Fixture;

async function patient(ctx: TenantContext): Promise<string> {
  const phone = `96${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const p = await registerPatient(ctx, { fullName: `Patient ${phone}`, phone, sex: 'M', age: 50, acknowledgedDuplicate: true });
  if (!p.ok) throw new Error('registration failed');
  return p.patientId;
}

/** Record work without a bill at the context's branch; returns the procedure id. */
async function recordUnbilled(ctx: TenantContext, doctorId = f.doctorId, item = f.items.rct): Promise<{ patientId: string; procedureId: string }> {
  const patientId = await patient(ctx);
  const r = await issueBill(ctx, { patientId, doctorId, idempotencyKey: key(), mode: 'unbilled', lines: [{ catalogueItemId: item, quantity: 1 }] });
  if (r.kind !== 'unbilled') throw new Error('not recorded');
  const [p] = await getDb().select({ id: proceduresPerformed.id }).from(proceduresPerformed).where(eq(proceduresPerformed.patientId, patientId));
  return { patientId, procedureId: p!.id };
}

async function billWith(ctx: TenantContext, item: string): Promise<{ patientId: string; invoiceId: string; procedureId: string }> {
  const patientId = await patient(ctx);
  const r = await issueBill(ctx, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: item, quantity: 1 }] });
  if (r.kind !== 'issued') throw new Error('not issued');
  const [p] = await getDb().select({ id: proceduresPerformed.id }).from(proceduresPerformed).where(eq(proceduresPerformed.patientId, patientId));
  return { patientId, invoiceId: r.invoiceId, procedureId: p!.id };
}

async function row(id: string) {
  const [p] = await getDb().select().from(proceduresPerformed).where(eq(proceduresPerformed.id, id));
  return p!;
}

async function audits(id: string, action: string) {
  return getDb().select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, action)));
}

async function puneUnbilled(): Promise<{ count: number; paise: number }> {
  const [d] = await dashboard(f.ctx('owner', f.pune.id), [f.pune.id]);
  return { count: d!.unbilledCount, paise: d!.unbilledPaise };
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('Not done: remove (T28)', () => {
  it('takes the work out of Unbilled and the dashboard figure, keeps the row, and audits the reason', async () => {
    const desk = f.ctx('desk');
    const before = await puneUnbilled();
    const { procedureId } = await recordUnbilled(desk);
    expect((await unbilledProcedures(desk, [f.pune.id])).map((u) => u.procedureId)).toContain(procedureId);
    expect(await puneUnbilled()).toEqual({ count: before.count + 1, paise: before.paise + 450_000 });

    await dismissProcedure(f.ctx('owner', f.pune.id), procedureId, '  Patient left before treatment ');

    expect((await unbilledProcedures(desk, [f.pune.id])).map((u) => u.procedureId)).not.toContain(procedureId);
    expect(await puneUnbilled()).toEqual(before);
    const p = await row(procedureId);
    expect(p).toMatchObject({ dismissedBy: f.ownerId, dismissReason: 'Patient left before treatment', invoiceLineId: null });
    expect(p.dismissedAt).toBeInstanceOf(Date);
    const a = await audits(procedureId, 'procedure.dismiss');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actorId: f.ownerId, branchId: f.pune.id, after: { dismissed: true, reason: 'Patient left before treatment' } });
  });

  it('lets the branch manager remove work at their branch', async () => {
    const { procedureId } = await recordUnbilled(f.ctx('desk'));
    await dismissProcedure(f.ctx('manager'), procedureId, 'Recorded twice by mistake');
    expect((await row(procedureId)).dismissReason).toBe('Recorded twice by mistake');
  });

  it('refuses the front desk, the accountant and a manager at another branch', async () => {
    const { procedureId } = await recordUnbilled(f.ctx('desk'));
    await expect(dismissProcedure(f.ctx('desk'), procedureId, 'Desk tries to clear it')).rejects.toThrow(ForbiddenError);
    await expect(dismissProcedure(f.ctx('accountant'), procedureId, 'Accountant tries')).rejects.toThrow(ForbiddenError);
    const kanpur = await recordUnbilled(f.ctx('kanpurDesk'), f.ownerId);
    await expect(dismissProcedure(f.ctx('manager'), kanpur.procedureId, 'Not my branch')).rejects.toThrow(ForbiddenError);
    expect((await row(procedureId)).dismissedAt).toBeNull();
    expect((await row(kanpur.procedureId)).dismissedAt).toBeNull();
    expect(await audits(procedureId, 'procedure.dismiss')).toHaveLength(0);
  });

  it('refuses an id from another org, and a malformed id', async () => {
    const { procedureId } = await recordUnbilled(f.ctx('desk'));
    await expect(dismissProcedure(other.ctx('owner'), procedureId, 'Cross-org attempt')).rejects.toThrow(ForbiddenError);
    await expect(dismissProcedure(f.ctx('owner'), 'not-a-uuid', 'Malformed id here')).rejects.toThrow(ForbiddenError);
    expect((await row(procedureId)).dismissedAt).toBeNull();
  });

  it('needs a reason of 5 characters and refuses a second removal', async () => {
    const { procedureId } = await recordUnbilled(f.ctx('desk'));
    await expect(dismissProcedure(f.ctx('owner'), procedureId, ' no ')).rejects.toThrow(UserFacingError);
    await dismissProcedure(f.ctx('owner'), procedureId, 'Never happened');
    await expect(dismissProcedure(f.ctx('owner'), procedureId, 'Second time round')).rejects.toThrow(/already marked/);
    expect((await row(procedureId)).dismissReason).toBe('Never happened');
    expect(await audits(procedureId, 'procedure.dismiss')).toHaveLength(1);
  });

  it('refuses work that is on a live bill', async () => {
    const { procedureId } = await billWith(f.ctx('desk'), f.items.rct);
    await expect(dismissProcedure(f.ctx('owner'), procedureId, 'Trying to drop billed work')).rejects.toThrow(/Cancel the bill/);
  });

  it('a removed procedure can never be billed', async () => {
    const desk = f.ctx('desk');
    const { patientId, procedureId } = await recordUnbilled(desk);
    await dismissProcedure(f.ctx('owner', f.pune.id), procedureId, 'Patient left before treatment');
    await expect(
      issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ procedureId, quantity: 1 }] }),
    ).rejects.toThrow(/marked as not done, so it can’t be billed/);
    expect((await row(procedureId)).invoiceLineId).toBeNull();
  });
});

describe('Was this work done? on cancelling a bill (T28)', () => {
  it('"No" marks the bill’s procedures not done with the cancel reason; nothing is left in Unbilled', async () => {
    const before = await puneUnbilled();
    const { invoiceId, procedureId } = await billWith(f.ctx('desk'), f.items.brush);
    await voidInvoice(f.ctx('desk'), invoiceId, 'Billed the wrong patient', false);

    const p = await row(procedureId);
    expect(p).toMatchObject({ invoiceLineId: null, dismissReason: 'Billed the wrong patient', dismissedBy: f.ctx('desk').userId });
    expect(p.dismissedAt).toBeInstanceOf(Date);
    expect((await unbilledProcedures(f.ctx('desk'), [f.pune.id])).map((u) => u.procedureId)).not.toContain(procedureId);
    expect(await puneUnbilled()).toEqual(before);
    const a = await audits(procedureId, 'procedure.dismiss');
    expect(a).toHaveLength(1);
    expect(a[0]!.after).toMatchObject({ reason: 'Billed the wrong patient', viaInvoiceId: invoiceId });
    expect((await audits(invoiceId, 'invoice.void'))[0]!.after).toMatchObject({ workDone: false });
  });

  it('"Yes" puts the work back under Done, not billed, as before', async () => {
    const before = await puneUnbilled();
    const { invoiceId, procedureId } = await billWith(f.ctx('desk'), f.items.brush);
    await voidInvoice(f.ctx('desk'), invoiceId, 'Billed the wrong amount', true);
    expect((await row(procedureId)).dismissedAt).toBeNull();
    expect((await unbilledProcedures(f.ctx('desk'), [f.pune.id])).map((u) => u.procedureId)).toContain(procedureId);
    expect((await puneUnbilled()).count).toBe(before.count + 1);
  });
});
