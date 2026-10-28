import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { invoices, memberships, users } from '@/db/schema';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import type { TenantContext } from './context';
import { ForbiddenError, UserFacingError } from './context';
import { billCancellationFor, getInvoice, issueBill, voidInvoice } from './invoices';
import { registerPatient } from './patients';
import { recordReceipt } from './receipts';

let f: Fixture;
let desk2: TenantContext;

async function bill(ctx: TenantContext): Promise<string> {
  const phone = `94${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const p = await registerPatient(ctx, { fullName: `Patient ${phone}`, phone, sex: 'M', age: 44, acknowledgedDuplicate: true });
  if (!p.ok) throw new Error('registration failed');
  const r = await issueBill(ctx, { patientId: p.patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 1 }] });
  if (r.kind !== 'issued') throw new Error('not issued');
  return r.invoiceId;
}

beforeAll(async () => {
  f = await createFixture();
  // A second front desk at Pune.
  const [u] = await getDb().insert(users).values({ orgId: f.orgId, fullName: 'Desk Two' }).returning();
  await getDb().insert(memberships).values({ orgId: f.orgId, userId: u!.id, branchId: f.pune.id, role: 'front_desk' });
  desk2 = { ...f.ctx('desk'), userId: u!.id, userName: 'Desk Two' };
});
afterAll(async () => {
  await closeDb();
});

describe('front desk cancels its own unpaid bill, same day (T20, Q9)', () => {
  it('allows the desk that issued it, today, before any payment', async () => {
    const id = await bill(f.ctx('desk'));
    const inv = (await getInvoice(f.ctx('desk'), id))!;
    expect(billCancellationFor(f.ctx('desk'), inv)).toEqual({ allowed: true });
    await voidInvoice(f.ctx('desk'), id, 'Billed the wrong patient', true);
    expect((await getInvoice(f.ctx('desk'), id))!.status).toBe('void');
  });

  it('refuses another desk’s bill', async () => {
    const id = await bill(f.ctx('desk'));
    await expect(voidInvoice(desk2, id, 'Not my bill at all', true)).rejects.toThrow(/issued yourself/);
    expect(billCancellationFor(desk2, (await getInvoice(desk2, id))!)).toMatchObject({ allowed: false, reason: expect.stringMatching(/^Only the owner can cancel this bill/) });
  });

  it('refuses a bill from an earlier day', async () => {
    const id = await bill(f.ctx('desk'));
    await getDb().update(invoices).set({ issuedOn: '2026-01-02' }).where(eq(invoices.id, id));
    await expect(voidInvoice(f.ctx('desk'), id, 'Yesterday’s mistake', true)).rejects.toThrow(/day they were issued/);
  });

  it('refuses a paid bill', async () => {
    const id = await bill(f.ctx('desk'));
    const inv = (await getInvoice(f.ctx('desk'), id))!;
    await recordReceipt(f.ctx('desk'), { patientId: inv.patientId, amountPaise: 1_000, mode: 'cash', idempotencyKey: key() });
    await expect(voidInvoice(f.ctx('desk'), id, 'Paid but wrong', true)).rejects.toThrow(/has payments/);
  });

  it('needs a reason, and stays closed to roles without either capability', async () => {
    const id = await bill(f.ctx('desk'));
    await expect(voidInvoice(f.ctx('desk'), id, 'no', true)).rejects.toThrow(UserFacingError);
    await expect(voidInvoice(f.ctx('accountant'), id, 'Accountant tries', true)).rejects.toThrow(ForbiddenError);
    await expect(voidInvoice(f.ctx('kanpurDesk'), id, 'Other branch desk', true)).rejects.toThrow(ForbiddenError);
    // The owner may cancel anyone's unpaid bill.
    await voidInvoice(f.ctx('owner'), id, 'Owner cancels it', true);
  });
});
