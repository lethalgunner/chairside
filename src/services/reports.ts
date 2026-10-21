import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  branches,
  catalogueItems,
  dayBooks,
  invoiceLines,
  invoices,
  ledgerEntries,
  patients,
  proceduresPerformed,
  receipts,
  users,
} from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { compareWithLegacy, type LegacyComparison } from '@/domain/parallel';
import { ageReceivables, statement, type AgeingBuckets, type LedgerEntry, type LedgerRow, type PaymentMode } from '@/domain/ledger';
import { add, ZERO, type Paise } from '@/domain/money';
import type { TaxCategory } from '@/domain/tax';
import { assertCan, canAnywhere, canDo, ForbiddenError, type TenantContext } from './context';
import { listInvoices } from './invoices';
import { isUuid, paidOnInvoiceSql, toInt, toPaise } from './util';

export interface BranchDay {
  branchId: string;
  branchName: string;
  billCount: number;
  billedPaise: Paise;
  collectedPaise: Paise;
  byMode: Partial<Record<PaymentMode, Paise>>;
  dayStatus: 'open' | 'reconciling' | 'closed' | 'reopened';
  unbilledCount: number;
  unbilledPaise: Paise;
  outstandingPaise: Paise;
  legacyBillCount: number | null;
}

/** Today's numbers per branch for the dashboard. Only branches the user may report on. */
export async function dashboard(ctx: TenantContext, branchIds: string[], date = businessDate()): Promise<BranchDay[]> {
  const ids = branchIds.filter((b) => canDo(ctx, 'report.branch', b) || canDo(ctx, 'day.close', b));
  if (ids.length === 0) return [];
  const db = getDb();
  const names = await db.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, ids))).orderBy(asc(branches.name));

  const billed = await db
    .select({ b: invoices.branchId, n: sql<string>`count(*)`, t: sql<string>`sum(${invoices.totalPaise})` })
    .from(invoices)
    .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids), eq(invoices.issuedOn, date), eq(invoices.status, 'issued')))
    .groupBy(invoices.branchId);
  const collected = await db
    .select({ b: receipts.branchId, mode: receipts.mode, t: sql<string>`sum(${receipts.amountPaise})` })
    .from(receipts)
    .where(and(eq(receipts.orgId, ctx.orgId), inArray(receipts.branchId, ids), eq(receipts.receivedOn, date), isNull(receipts.cancelledAt)))
    .groupBy(receipts.branchId, receipts.mode);
  const books = await db
    .select({ b: dayBooks.branchId, status: dayBooks.status, legacy: dayBooks.legacyBillCount })
    .from(dayBooks)
    .where(and(eq(dayBooks.orgId, ctx.orgId), inArray(dayBooks.branchId, ids), eq(dayBooks.businessDate, date)));
  const unbilled = await db
    .select({
      b: proceduresPerformed.branchId,
      n: sql<string>`count(*)`,
      t: sql<string>`sum(${proceduresPerformed.unitPricePaise} * ${proceduresPerformed.quantity})`,
    })
    .from(proceduresPerformed)
    .where(and(eq(proceduresPerformed.orgId, ctx.orgId), inArray(proceduresPerformed.branchId, ids), isNull(proceduresPerformed.invoiceLineId)))
    .groupBy(proceduresPerformed.branchId);
  const outstanding = await db
    .select({
      b: invoices.branchId,
      t: sql<string>`sum(invoices.total_paise - ${paidOnInvoiceSql()})`,
    })
    .from(invoices)
    .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids), eq(invoices.status, 'issued')))
    .groupBy(invoices.branchId);

  return names.map(({ id, name }) => {
    const byMode: Partial<Record<PaymentMode, Paise>> = {};
    for (const c of collected.filter((c) => c.b === id)) byMode[c.mode as PaymentMode] = toPaise(c.t);
    const bill = billed.find((x) => x.b === id);
    const book = books.find((x) => x.b === id);
    const ub = unbilled.find((x) => x.b === id);
    return {
      branchId: id,
      branchName: name,
      billCount: toInt(bill?.n),
      billedPaise: toPaise(bill?.t),
      collectedPaise: add(...Object.values(byMode)),
      byMode,
      dayStatus: (book?.status ?? 'open') as BranchDay['dayStatus'],
      unbilledCount: toInt(ub?.n),
      unbilledPaise: toPaise(ub?.t),
      outstandingPaise: toPaise(outstanding.find((x) => x.b === id)?.t),
      legacyBillCount: book?.legacy ?? null,
    };
  });
}

export interface UnbilledRow {
  procedureId: string;
  patientId: string;
  patientName: string;
  branchName: string;
  itemName: string;
  doctorName: string;
  performedAt: Date;
  valuePaise: Paise;
}

export async function unbilledProcedures(ctx: TenantContext, branchIds: string[]): Promise<UnbilledRow[]> {
  const ids = branchIds.filter((b) => canDo(ctx, 'invoice.issue', b) || canDo(ctx, 'report.branch', b));
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({
      procedureId: proceduresPerformed.id,
      patientId: proceduresPerformed.patientId,
      patientName: patients.fullName,
      branchName: branches.name,
      itemName: catalogueItems.name,
      doctorName: users.fullName,
      performedAt: proceduresPerformed.performedAt,
      price: proceduresPerformed.unitPricePaise,
      qty: proceduresPerformed.quantity,
    })
    .from(proceduresPerformed)
    .innerJoin(patients, eq(patients.id, proceduresPerformed.patientId))
    .innerJoin(branches, eq(branches.id, proceduresPerformed.branchId))
    .innerJoin(catalogueItems, eq(catalogueItems.id, proceduresPerformed.catalogueItemId))
    .innerJoin(users, eq(users.id, proceduresPerformed.doctorId))
    .where(and(eq(proceduresPerformed.orgId, ctx.orgId), inArray(proceduresPerformed.branchId, ids), isNull(proceduresPerformed.invoiceLineId)))
    .orderBy(asc(proceduresPerformed.performedAt));
  return rows.map((r) => ({ ...r, valuePaise: (r.price * r.qty) as Paise }));
}

export async function receivables(ctx: TenantContext, branchIds: string[], asOf = businessDate()) {
  const ids = branchIds.filter((b) => canDo(ctx, 'report.branch', b) || canDo(ctx, 'receipt.record', b));
  const rows = await listInvoices(ctx, { branchIds: ids, openOnly: true, limit: 1000 });
  const ageing: AgeingBuckets = ageReceivables(
    rows.map((r) => ({ invoiceId: r.id, issuedOn: r.issuedOn, totalPaise: r.totalPaise, allocatedPaise: r.paidPaise })),
    asOf,
  );
  return { rows, ageing };
}

export interface PatientAccount {
  statement: LedgerRow[];
  balancePaise: Paise;
}

/** The patient's ledger across every branch the user can see. Balance is the sum of entries, never stored. */
export async function patientAccount(ctx: TenantContext, patientId: string): Promise<PatientAccount> {
  if (!canAnywhere(ctx, 'patient.view')) throw new ForbiddenError();
  if (!isUuid(patientId)) return { statement: [], balancePaise: ZERO };
  const rows = await getDb()
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.orgId, ctx.orgId), eq(ledgerEntries.patientId, patientId), inArray(ledgerEntries.branchId, ctx.branchIds)))
    .orderBy(asc(ledgerEntries.occurredOn), asc(ledgerEntries.createdAt));
  const entries: LedgerEntry[] = rows.map((r) => ({
    entryType: r.entryType,
    amountPaise: r.amountPaise as Paise,
    occurredOn: r.occurredOn,
    invoiceId: r.invoiceId ?? undefined,
    receiptId: r.receiptId ?? undefined,
    narration: r.narration ?? undefined,
  }));
  const st = statement(entries);
  return { statement: st, balancePaise: st.length ? st[st.length - 1]!.runningBalancePaise : ZERO };
}

export interface GstBranchPapers {
  branchId: string;
  branchName: string;
  gstRegistered: boolean;
  gstin: string | null;
  invoiceCount: number;
  exemptPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  hsn: { hsnSacCode: string; taxCategory: TaxCategory; gstRateBp: number; valuePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise }[];
}

/** Outward supplies for a month (YYYY-MM), per branch, from the tax snapshotted on each issued line. */
export async function gstPapers(ctx: TenantContext, branchIds: string[], month: string): Promise<GstBranchPapers[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM');
  const ids = branchIds.filter((b) => canDo(ctx, 'report.gst', b));
  if (ids.length === 0) return [];
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const db = getDb();
  const bs = await db.select().from(branches).where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, ids))).orderBy(asc(branches.name));
  const heads = await db
    .select({
      b: invoices.branchId,
      n: sql<string>`count(*)`,
      exempt: sql<string>`sum(${invoices.exemptPaise})`,
      taxable: sql<string>`sum(${invoices.taxablePaise})`,
      cgst: sql<string>`sum(${invoices.cgstPaise})`,
      sgst: sql<string>`sum(${invoices.sgstPaise})`,
      igst: sql<string>`sum(${invoices.igstPaise})`,
    })
    .from(invoices)
    .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids), eq(invoices.status, 'issued'), gte(invoices.issuedOn, from), lt(invoices.issuedOn, to)))
    .groupBy(invoices.branchId);
  const hsn = await db
    .select({
      b: invoices.branchId,
      code: invoiceLines.hsnSacCode,
      cat: invoiceLines.taxCategory,
      rate: invoiceLines.gstRateBp,
      value: sql<string>`sum(${invoiceLines.taxableValuePaise})`,
      cgst: sql<string>`sum(${invoiceLines.cgstPaise})`,
      sgst: sql<string>`sum(${invoiceLines.sgstPaise})`,
      igst: sql<string>`sum(${invoiceLines.igstPaise})`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids), eq(invoices.status, 'issued'), gte(invoices.issuedOn, from), lt(invoices.issuedOn, to)))
    .groupBy(invoices.branchId, invoiceLines.hsnSacCode, invoiceLines.taxCategory, invoiceLines.gstRateBp)
    .orderBy(asc(invoiceLines.hsnSacCode), asc(invoiceLines.gstRateBp));
  return bs.map((b) => {
    const h = heads.find((x) => x.b === b.id);
    return {
      branchId: b.id,
      branchName: b.name,
      gstRegistered: b.gstRegistered,
      gstin: b.gstin,
      invoiceCount: toInt(h?.n),
      exemptPaise: toPaise(h?.exempt),
      taxablePaise: toPaise(h?.taxable),
      cgstPaise: toPaise(h?.cgst),
      sgstPaise: toPaise(h?.sgst),
      igstPaise: toPaise(h?.igst),
      hsn: hsn
        .filter((x) => x.b === b.id)
        .map((x) => ({
          hsnSacCode: x.code,
          taxCategory: x.cat as TaxCategory,
          gstRateBp: x.rate,
          valuePaise: toPaise(x.value),
          cgstPaise: toPaise(x.cgst),
          sgstPaise: toPaise(x.sgst),
          igstPaise: toPaise(x.igst),
        })),
    };
  });
}

/** Recent receipts for a patient (all visible branches), newest first. */
export async function patientReceipts(ctx: TenantContext, patientId: string) {
  if (!canAnywhere(ctx, 'patient.view') || !isUuid(patientId)) return [];
  return getDb()
    .select({ id: receipts.id, number: receipts.number, receivedOn: receipts.receivedOn, mode: receipts.mode, amountPaise: receipts.amountPaise, branchName: branches.name, cancelledAt: receipts.cancelledAt, cancelReason: receipts.cancelReason })
    .from(receipts)
    .innerJoin(branches, eq(branches.id, receipts.branchId))
    .where(and(eq(receipts.orgId, ctx.orgId), eq(receipts.patientId, patientId), inArray(receipts.branchId, ctx.branchIds)))
    .orderBy(desc(receipts.createdAt));
}

export function assertReport(ctx: TenantContext, branchId: string) {
  assertCan(ctx, 'report.branch', branchId);
}

export interface ParallelRunRow {
  date: string;
  branchId: string;
  branchName: string;
  dayStatus: 'open' | 'reconciling' | 'closed' | 'reopened' | null;
  comparison: LegacyComparison | null;
  billCount: number;
  collectedPaise: Paise;
}

/**
 * The parallel run, last `days` business days × branch (T21): Chairside's
 * bills and collections against the old system's figures typed in at close.
 * Days with no day book and no activity are left out. Newest first.
 */
export async function parallelRun(ctx: TenantContext, branchIds: string[], today = businessDate(), days = 7): Promise<ParallelRunRow[]> {
  const ids = branchIds.filter((b) => canDo(ctx, 'report.branch', b));
  if (ids.length === 0) return [];
  const from = addDays(today, -(days - 1));
  const db = getDb();
  const names = await db.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, ids)));
  const books = await db
    .select({ b: dayBooks.branchId, d: dayBooks.businessDate, status: dayBooks.status, legacyN: dayBooks.legacyBillCount, legacyP: dayBooks.legacyCollectedPaise })
    .from(dayBooks)
    .where(and(eq(dayBooks.orgId, ctx.orgId), inArray(dayBooks.branchId, ids), gte(dayBooks.businessDate, from), lte(dayBooks.businessDate, today)));
  const bills = await db
    .select({ b: invoices.branchId, d: invoices.issuedOn, n: sql<string>`count(*)` })
    .from(invoices)
    .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids), eq(invoices.status, 'issued'), gte(invoices.issuedOn, from), lte(invoices.issuedOn, today)))
    .groupBy(invoices.branchId, invoices.issuedOn);
  const cash = await db
    .select({ b: receipts.branchId, d: receipts.receivedOn, t: sql<string>`sum(${receipts.amountPaise})` })
    .from(receipts)
    .where(and(eq(receipts.orgId, ctx.orgId), inArray(receipts.branchId, ids), isNull(receipts.cancelledAt), gte(receipts.receivedOn, from), lte(receipts.receivedOn, today)))
    .groupBy(receipts.branchId, receipts.receivedOn);

  const keys = new Set<string>([...books, ...bills, ...cash].map((r) => `${r.d}|${r.b}`));
  const rows: ParallelRunRow[] = [...keys].map((k) => {
    const [date, branchId] = k.split('|') as [string, string];
    const book = books.find((x) => x.b === branchId && x.d === date);
    const billCount = toInt(bills.find((x) => x.b === branchId && x.d === date)?.n);
    const collectedPaise = toPaise(cash.find((x) => x.b === branchId && x.d === date)?.t);
    return {
      date,
      branchId,
      branchName: names.find((n) => n.id === branchId)?.name ?? '',
      dayStatus: (book?.status ?? null) as ParallelRunRow['dayStatus'],
      billCount,
      collectedPaise,
      comparison: compareWithLegacy({
        legacyBillCount: book?.legacyN ?? null,
        legacyCollectedPaise: (book?.legacyP ?? null) as Paise | null,
        billCount,
        collectedPaise,
      }),
    };
  });
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.branchName.localeCompare(b.branchName));
}
