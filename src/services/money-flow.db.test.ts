import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { invoiceLines, invoices, ledgerEntries, proceduresPerformed } from '@/db/schema';
import { businessDate, financialYearShort } from '@/domain/dates';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError } from './context';
import { closeDay, getDaySummary, recordCashOut, reopenDay } from './daybook';
import { getInvoice, issueBill, listInvoices, voidInvoice } from './invoices';
import { nextDocumentNumber } from './numbering';
import { getPatient, registerPatient, searchPatients } from './patients';
import { previewAllocation, recordReceipt } from './receipts';
import { dashboard, gstPapers, patientAccount, unbilledProcedures } from './reports';
import type { Paise } from '@/domain/money';

let f: Fixture;
const today = businessDate();
const fy = financialYearShort(today);

async function newPatient(ctxWho: 'desk' | 'owner' = 'desk', phone = `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`) {
  const r = await registerPatient(f.ctx(ctxWho), { fullName: `Patient ${phone}`, phone, sex: 'F', age: 34, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('golden path: mixed bill, part payment, ledger, day close', () => {
  it('computes, snapshots, numbers and settles a mixed exempt/taxable bill exactly', async () => {
    const desk = f.ctx('desk');
    const patientId = await newPatient();

    const res = await issueBill(desk, {
      patientId,
      doctorId: f.doctorId,
      idempotencyKey: key(),
      mode: 'issue',
      lines: [
        { catalogueItemId: f.items.rct, quantity: 1, toothNumber: '26' },
        { catalogueItemId: f.items.crown, quantity: 1, discountPaise: 60_000, discountReason: 'Senior citizen' },
        { catalogueItemId: f.items.brush, quantity: 1 },
      ],
    });
    expect(res.kind).toBe('issued');
    if (res.kind !== 'issued') return;
    expect(res.number).toMatch(new RegExp(`^${f.pune.code}T/${fy}/\\d{5}$`));
    expect(res.number.length).toBeLessThanOrEqual(16);

    // Worked by hand:
    //   RCT        4,500.00 exempt                      = 4,500.00
    //   Crown      6,000.00 − 600.00 = 5,400.00 + 12% (648.00 → 324.00 + 324.00) = 6,048.00
    //   Toothbrush   120.00 + 18% (21.60 → 10.80 + 10.80)                          =   141.60
    //   Raw total 10,689.60 → rounded to the rupee 10,690.00 (rounding +0.40)
    const inv = await getInvoice(desk, res.invoiceId);
    expect(inv!.totals).toMatchObject({
      subtotalPaise: 1_062_000,
      discountPaise: 60_000,
      exemptPaise: 450_000,
      taxablePaise: 552_000,
      cgstPaise: 33_480,
      sgstPaise: 33_480,
      igstPaise: 0,
      roundingPaise: 40,
      totalPaise: 1_069_000,
    });
    expect(inv!.lines.map((l) => [l.description, l.gstRateBp, l.lineTotalPaise])).toEqual([
      ['Root canal treatment, tooth 26', 0, 450_000],
      ['Zirconia crown', 1200, 604_800],
      ['Toothbrush', 1800, 14_160],
    ]);

    // Preview equals what is then saved.
    const preview = await previewAllocation(desk, patientId, 500_000 as Paise);
    expect(preview.result.allocations).toEqual([{ invoiceId: res.invoiceId, amountPaise: 500_000 }]);
    const r1 = await recordReceipt(desk, { patientId, amountPaise: 500_000, mode: 'upi', reference: 'p@okaxis', idempotencyKey: key() });
    const r2 = await recordReceipt(desk, { patientId, amountPaise: 200_000, mode: 'cash', idempotencyKey: key() });
    expect(r1.allocations).toEqual(preview.result.allocations);
    expect(r2.advancePaise).toBe(0);
    expect(r1.number).toMatch(new RegExp(`^${f.pune.code}TR/${fy}/\\d{4}$`));

    const account = await patientAccount(desk, patientId);
    expect(account.balancePaise).toBe(369_000);
    const after = await getInvoice(desk, res.invoiceId);
    expect(after!.duePaise).toBe(369_000);

    // Close: ₹2,000 cash received, ₹100 paid out, float 0 → expect ₹1,900; count ₹1,850 → −₹50 within ₹100 tolerance.
    await recordCashOut(desk, { amountPaise: 10_000 as Paise, description: 'Courier' });
    const summary = await getDaySummary(desk, f.pune.id);
    expect(summary.expectedCashPaise).toBe(190_000);
    expect(summary.billCount).toBe(1);
    const rec = await closeDay(desk, { denominations: { '500': 3, '100': 3, '50': 1 }, legacyBillCount: 1 });
    expect(rec.variancePaise).toBe(-5_000);
    expect(rec.requiresExplanation).toBe(false);

    // Locked: no more receipts or bills today at Pune.
    await expect(recordReceipt(desk, { patientId, amountPaise: 1_000, mode: 'cash', idempotencyKey: key() })).rejects.toThrow(UserFacingError);
    await expect(
      issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 1 }] }),
    ).rejects.toThrow(/closed/);

    // Only the owner reopens; reopening is audited and lets work resume.
    await expect(reopenDay(f.ctx('manager'), { branchId: f.pune.id, date: today, reason: 'Late payment' })).rejects.toThrow(ForbiddenError);
    await reopenDay(f.ctx('owner'), { branchId: f.pune.id, date: today, reason: 'Late payment arrived' });
    const late = await recordReceipt(desk, { patientId, amountPaise: 369_000, mode: 'card', idempotencyKey: key() });
    expect(late.allocations).toEqual([{ invoiceId: res.invoiceId, amountPaise: 369_000 }]);
    expect((await patientAccount(desk, patientId)).balancePaise).toBe(0);
  });

  it('requires a reason when the cash variance exceeds tolerance', async () => {
    const owner = f.ctx('owner', f.kanpur.id);
    const patientId = await newPatient('owner');
    await recordReceipt(owner, { patientId, amountPaise: 100_000, mode: 'cash', idempotencyKey: key() });
    await expect(closeDay(owner, { denominations: { '500': 1 } })).rejects.toThrow(/Write what happened/);
    const rec = await closeDay(owner, { denominations: { '500': 1 }, varianceReason: 'Change given from own pocket' });
    expect(rec.variancePaise).toBe(-50_000);
  });
});

describe('unregistered branch', () => {
  it('charges no GST whatever the catalogue says', async () => {
    const owner = f.ctx('owner', f.kanpur.id);
    await reopenDay(owner, { branchId: f.kanpur.id, date: today, reason: 'Continue testing' });
    const patientId = await newPatient('owner');
    const res = await issueBill(owner, {
      patientId,
      doctorId: f.ownerId,
      idempotencyKey: key(),
      mode: 'issue',
      lines: [
        { catalogueItemId: f.items.crown, quantity: 1 },
        { catalogueItemId: f.items.whitening, quantity: 1 },
      ],
    });
    if (res.kind !== 'issued') throw new Error('expected issued');
    const inv = await getInvoice(owner, res.invoiceId);
    expect(inv!.totals.cgstPaise + inv!.totals.sgstPaise + inv!.totals.igstPaise).toBe(0);
    expect(inv!.totals.totalPaise).toBe(1_500_000);
    expect(inv!.lines.every((l) => l.gstRateBp === 0)).toBe(true);
    expect(res.number.startsWith(`${f.kanpur.code}T/`)).toBe(true);
  });
});

describe('numbering', () => {
  it('stays gapless and unique under 25 concurrent issues', async () => {
    const desk = f.ctx('desk');
    await reopenDay(f.ctx('owner'), { branchId: f.pune.id, date: today, reason: 'Concurrency test' }).catch(() => {});
    const patientId = await newPatient();
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 1 }] }),
      ),
    );
    const all = await getDb()
      .select({ number: invoices.number })
      .from(invoices)
      .where(eq(invoices.branchId, f.pune.id));
    const seqs = all.map((r) => Number(r.number.split('/')[2])).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(results.every((r) => r.kind === 'issued')).toBe(true);
  });

  it('gives a number back when the transaction rolls back', async () => {
    const before = await getDb().execute(sql`select last_number from invoice_series where branch_id = ${f.kanpur.id} and document_type = 'sale'`);
    const last = Number((before as unknown as { last_number: number }[])[0]?.last_number ?? 0);
    await expect(
      getDb().transaction(async (tx) => {
        await nextDocumentNumber(tx, { orgId: f.orgId, branchId: f.kanpur.id, branchCode: f.kanpur.code, documentType: 'sale', businessDate: today });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await getDb().execute(sql`select last_number from invoice_series where branch_id = ${f.kanpur.id} and document_type = 'sale'`);
    expect(Number((after as unknown as { last_number: number }[])[0]?.last_number ?? 0)).toBe(last);
  });

  it('issues exactly one invoice for a repeated idempotency key, even in parallel', async () => {
    const desk = f.ctx('desk');
    const patientId = await newPatient();
    const k = key();
    const input = { patientId, doctorId: f.doctorId, idempotencyKey: k, mode: 'issue' as const, lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] };
    const [a, b, c] = await Promise.all([issueBill(desk, input), issueBill(desk, input), issueBill(desk, input)]);
    const ids = new Set([a, b, c].map((r) => (r.kind === 'issued' ? r.invoiceId : '')));
    expect(ids.size).toBe(1);
    const rows = await getDb().select().from(invoices).where(eq(invoices.idempotencyKey, k));
    expect(rows).toHaveLength(1);
    const rk = key();
    const receiptInput = { patientId, amountPaise: 1_000, mode: 'cash' as const, idempotencyKey: rk };
    const [r1, r2] = await Promise.all([recordReceipt(desk, receiptInput), recordReceipt(desk, receiptInput)]);
    expect(r1.receiptId).toBe(r2.receiptId);
  });
});

describe('advances, void and unbilled', () => {
  it('holds an overpayment as an advance and spends it on the next bill', async () => {
    const desk = f.ctx('desk');
    const patientId = await newPatient();
    const adv = await recordReceipt(desk, { patientId, amountPaise: 100_000, mode: 'cash', idempotencyKey: key() });
    expect(adv.advancePaise).toBe(100_000);
    const res = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (res.kind !== 'issued') throw new Error();
    const inv = await getInvoice(desk, res.invoiceId);
    expect(inv!.paidPaise).toBe(100_000);
    expect(inv!.duePaise).toBe(350_000);
    expect((await patientAccount(desk, patientId)).balancePaise).toBe(350_000);
  });

  it('records work to bill later, then bills it from the unbilled list', async () => {
    const desk = f.ctx('desk');
    const patientId = await newPatient();
    const saved = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'unbilled', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    expect(saved.kind).toBe('unbilled');
    const list = await unbilledProcedures(desk, [f.pune.id]);
    const mine = list.filter((u) => u.patientId === patientId);
    expect(mine).toHaveLength(1);
    const res = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ procedureId: mine[0]!.procedureId, quantity: 1 }] });
    expect(res.kind).toBe('issued');
    expect((await unbilledProcedures(desk, [f.pune.id])).filter((u) => u.patientId === patientId)).toHaveLength(0);
  });

  it('voids an unpaid bill with a reversing entry and releases its procedures', async () => {
    const desk = f.ctx('desk');
    const manager = f.ctx('manager');
    const patientId = await newPatient();
    const res = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (res.kind !== 'issued') throw new Error();
    // T20: the desk may now cancel its own unpaid same-day bill; roles without either capability still can't.
    await expect(voidInvoice(f.ctx('accountant'), res.invoiceId, 'Wrong patient')).rejects.toThrow(ForbiddenError);
    await voidInvoice(manager, res.invoiceId, 'Wrong patient selected');
    const inv = await getInvoice(manager, res.invoiceId);
    expect(inv!.status).toBe('void');
    expect(inv!.number).toBe(res.number);
    expect((await patientAccount(manager, patientId)).balancePaise).toBe(0);
    const procs = await getDb().select().from(proceduresPerformed).where(eq(proceduresPerformed.patientId, patientId));
    expect(procs.every((p) => p.invoiceLineId === null)).toBe(true);
    const amounts = await getDb().select({ t: invoiceLines.lineTotalPaise }).from(invoiceLines).where(eq(invoiceLines.invoiceId, res.invoiceId));
    expect(amounts[0]!.t).toBe(450_000);
  });

  it('refuses to void a bill that has payments', async () => {
    const desk = f.ctx('desk');
    const patientId = await newPatient();
    const res = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 1 }] });
    if (res.kind !== 'issued') throw new Error();
    await recordReceipt(desk, { patientId, amountPaise: 5_000, mode: 'cash', idempotencyKey: key() });
    await expect(voidInvoice(f.ctx('owner'), res.invoiceId, 'Testing refusal')).rejects.toThrow(/payments/);
  });
});

describe('ledger integrity', () => {
  it('every patient balance equals the sum of their ledger and matches open invoices minus advances', async () => {
    const rows = await getDb().execute(sql`
      with bal as (select patient_id, sum(amount_paise) b from ledger_entries where org_id = ${f.orgId} group by patient_id),
      due as (
        select i.patient_id, sum(i.total_paise - coalesce((select sum(a.amount_paise) from receipt_allocations a where a.invoice_id = i.id),0)) d
        from invoices i where i.org_id = ${f.orgId} and i.status = 'issued' group by i.patient_id),
      adv as (
        select r.patient_id, sum(r.amount_paise - coalesce((select sum(a.amount_paise) from receipt_allocations a where a.receipt_id = r.id),0)) a
        from receipts r where r.org_id = ${f.orgId} group by r.patient_id)
      select bal.patient_id, bal.b::bigint b, coalesce(due.d,0)::bigint d, coalesce(adv.a,0)::bigint a
      from bal left join due using (patient_id) left join adv using (patient_id)`);
    const list = rows as unknown as { b: string; d: string; a: string }[];
    expect(list.length).toBeGreaterThan(3);
    for (const r of list) expect(Number(r.b)).toBe(Number(r.d) - Number(r.a));
    const voids = await getDb().select().from(ledgerEntries).where(eq(ledgerEntries.entryType, 'credit_note'));
    expect(voids.length).toBeGreaterThan(0);
  });

  it('reports dashboard and GST papers from the stored snapshots', async () => {
    const owner = f.ctx('owner', 'all');
    const d = await dashboard(owner, owner.branchIds);
    const pune = d.find((x) => x.branchId === f.pune.id)!;
    expect(pune.billCount).toBeGreaterThan(25);
    expect(pune.byMode.upi).toBe(500_000);
    const papers = await gstPapers(owner, owner.branchIds, today.slice(0, 7));
    const p = papers.find((x) => x.branchId === f.pune.id)!;
    expect(p.cgstPaise).toBe(p.sgstPaise);
    expect(p.hsn.some((h) => h.hsnSacCode === '9993' && h.gstRateBp === 0)).toBe(true);
    const k = papers.find((x) => x.branchId === f.kanpur.id)!;
    expect(k.cgstPaise + k.sgstPaise).toBe(0);
  });
});

describe('access and tenancy', () => {
  it('keeps another org out of everything', async () => {
    const other = await createFixture();
    const desk = f.ctx('desk');
    const patientId = await newPatient();
    const res = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 1 }] });
    if (res.kind !== 'issued') throw new Error();
    const intruder = other.ctx('owner', 'all');
    expect(await getInvoice(intruder, res.invoiceId)).toBeNull();
    expect(await getPatient(intruder, patientId)).toBeNull();
    expect((await searchPatients(intruder, 'Patient')).some((p) => p.id === patientId)).toBe(false);
    expect(await listInvoices(intruder, { branchIds: [f.pune.id] })).toEqual([]);
    expect((await patientAccount(intruder, patientId)).statement).toEqual([]);
    await expect(
      recordReceipt(other.ctx('owner', other.pune.id), { patientId, amountPaise: 100, mode: 'cash', idempotencyKey: key() }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('scopes staff to their branch and keeps accountants away from patients', async () => {
    const kanpurDesk = f.ctx('kanpurDesk');
    expect(kanpurDesk.branchIds).toEqual([f.kanpur.id]);
    await expect(getDaySummary(kanpurDesk, f.pune.id)).rejects.toThrow(ForbiddenError);
    await expect(searchPatients(f.ctx('accountant', 'all'), '')).rejects.toThrow(ForbiddenError);
    expect(await dashboard(kanpurDesk, [f.pune.id])).toEqual([]);
  });

  it('will not create anything under "All branches"', async () => {
    await expect(
      registerPatient(f.ctx('owner', 'all'), { fullName: 'Nobody', phone: '9876543210', sex: 'M', age: 30 }),
    ).rejects.toThrow(/Pick a branch/);
  });
});

describe('patient registration', () => {
  it('normalises pasted phones and returns duplicates for the desk to confirm', async () => {
    const desk = f.ctx('desk');
    const first = await registerPatient(desk, { fullName: 'Meera  Kulkarni', phone: '+91 98220 41155', sex: 'F', age: 34 });
    expect(first.ok).toBe(true);
    const again = await registerPatient(desk, { fullName: 'meera kulkarni', phone: '098220 41155', sex: 'F', age: 34 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.duplicates?.[0]?.phone).toBe('9822041155');
    const confirmed = await registerPatient(desk, { fullName: 'Meera Kulkarni', phone: '9822041155', sex: 'F', age: 8, acknowledgedDuplicate: true });
    expect(confirmed.ok).toBe(true);
    const bad = await registerPatient(desk, { fullName: 'X', phone: '12345', sex: 'F', age: 200 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(['age', 'fullName', 'phone']);
    const found = await searchPatients(desk, '41155');
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found[0]!.fileNumbers[0]).toMatch(new RegExp(`^${f.pune.code}-\\d{4}$`));
  });
});

describe('allocations against partly paid bills (regression: unqualified correlated subquery)', () => {
  it('settles only what is still due and keeps the rest as an advance', async () => {
    const desk = f.ctx('desk');
    await reopenDay(f.ctx('owner'), { branchId: f.pune.id, date: today, reason: 'Regression test' }).catch(() => {});
    const patientId = await newPatient();
    const res = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (res.kind !== 'issued') throw new Error();
    // 4,500 bill: pay 4,000, then 1,000 → 500 settles the bill, 500 is an advance.
    await recordReceipt(desk, { patientId, amountPaise: 400_000, mode: 'cash', idempotencyKey: key() });
    const second = await recordReceipt(desk, { patientId, amountPaise: 100_000, mode: 'upi', idempotencyKey: key() });
    expect(second.allocations).toEqual([{ invoiceId: res.invoiceId, amountPaise: 50_000 }]);
    expect(second.advancePaise).toBe(50_000);
    const preview = await previewAllocation(desk, patientId, 10_000 as Paise);
    expect(preview.open).toEqual([]);
  });

  it('spends an advance once, not on every later bill', async () => {
    const desk = f.ctx('desk');
    const patientId = await newPatient();
    await recordReceipt(desk, { patientId, amountPaise: 100_000, mode: 'cash', idempotencyKey: key() });
    const a = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 5 }] });
    const b = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (a.kind !== 'issued' || b.kind !== 'issued') throw new Error();
    // Brush ×5 = 600.00 + 18% 108.00 = 708.00 (fully covered by the 1,000 advance); RCT gets the remaining 292.00.
    expect((await getInvoice(desk, a.invoiceId))!.paidPaise).toBe(70_800);
    expect((await getInvoice(desk, b.invoiceId))!.paidPaise).toBe(29_200);
    expect((await getInvoice(desk, b.invoiceId))!.duePaise).toBe(420_800);
    expect((await patientAccount(desk, patientId)).balancePaise).toBe(420_800);
  });

  it('dashboard "patients owe" equals the receivables total', async () => {
    const owner = f.ctx('owner', 'all');
    const { receivables } = await import('./reports');
    const d = await dashboard(owner, owner.branchIds);
    const r = await receivables(owner, owner.branchIds);
    expect(d.reduce((s, x) => s + x.outstandingPaise, 0)).toBe(r.ageing.total);
  });
});
