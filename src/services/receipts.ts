import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DB, type Tx } from '@/db/client';
import { branches, dayBooks, invoices, ledgerEntries, patients, receiptAllocations, receipts } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import { allocateReceipt, type AllocationResult, type OutstandingInvoice } from '@/domain/ledger';
import { negate, type Paise } from '@/domain/money';
import { getBranch } from './branches';
import { assertCan, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { writeAudit } from './audit';
import { ensureDayOpen } from './daybook';
import { nextDocumentNumber } from './numbering';
import { isUniqueViolation, isUuid, paidOnInvoiceSql, toPaise } from './util';

export const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'financing'] as const;

export const recordReceiptInput = z.object({
  patientId: z.string().uuid(),
  amountPaise: z.number().int().positive('Enter the amount received.').max(Number.MAX_SAFE_INTEGER),
  mode: z.enum(PAYMENT_MODES),
  reference: z.string().trim().max(80).optional(),
  idempotencyKey: z.string().min(8).max(100),
});
export type RecordReceiptInput = z.input<typeof recordReceiptInput>;

/** This patient's issued, not-fully-paid invoices at one branch, oldest first. */
export async function outstandingInvoices(
  db: DB | Tx,
  orgId: string,
  branchId: string,
  patientId: string,
): Promise<(OutstandingInvoice & { number: string })[]> {
  const rows = await db
    .select({
      invoiceId: invoices.id,
      number: invoices.number,
      issuedOn: invoices.issuedOn,
      totalPaise: invoices.totalPaise,
      allocated: paidOnInvoiceSql(),
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.orgId, orgId),
        eq(invoices.branchId, branchId),
        eq(invoices.patientId, patientId),
        eq(invoices.status, 'issued'),
      ),
    )
    .orderBy(asc(invoices.issuedOn), asc(invoices.createdAt));
  return rows
    .map((r) => ({
      invoiceId: r.invoiceId,
      number: r.number,
      issuedOn: r.issuedOn,
      totalPaise: r.totalPaise as Paise,
      allocatedPaise: toPaise(r.allocated),
    }))
    .filter((r) => r.totalPaise > r.allocatedPaise);
}

/** Open bills at the active branch that a payment from this patient would settle. */
export async function openBillsForReceipt(ctx: TenantContext, patientId: string): Promise<(OutstandingInvoice & { number: string })[]> {
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, 'receipt.record', branchId);
  return outstandingInvoices(getDb(), ctx.orgId, branchId, patientId);
}

/** What a payment of this size would settle, shown to the desk before they save. */
export async function previewAllocation(
  ctx: TenantContext,
  patientId: string,
  amountPaise: Paise,
): Promise<{ result: AllocationResult; open: (OutstandingInvoice & { number: string })[] }> {
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, 'receipt.record', branchId);
  const open = await outstandingInvoices(getDb(), ctx.orgId, branchId, patientId);
  return { result: allocateReceipt(amountPaise, open), open };
}

export interface RecordReceiptResult {
  receiptId: string;
  number: string;
  allocations: { invoiceId: string; amountPaise: Paise }[];
  advancePaise: Paise;
  duplicate: boolean;
}

export async function recordReceipt(ctx: TenantContext, raw: RecordReceiptInput): Promise<RecordReceiptResult> {
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, 'receipt.record', branchId);
  const parsed = recordReceiptInput.safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? 'Check the payment.');
  const input = parsed.data;
  const branch = await getBranch(ctx, branchId);
  const date = businessDate();

  const existing = await byKey(ctx.orgId, input.idempotencyKey);
  if (existing) return existing;

  try {
    return await getDb().transaction(async (tx) => {
      await ensureDayOpen(tx, { orgId: ctx.orgId, branchId, branchName: branch.name, date, defaultFloatPaise: branch.defaultFloatPaise });
      const [patient] = await tx
        .select({ id: patients.id, name: patients.fullName })
        .from(patients)
        .where(and(eq(patients.id, input.patientId), eq(patients.orgId, ctx.orgId)))
        .limit(1);
      if (!patient) throw new ForbiddenError();

      // Lock this patient's open invoices at the branch so two desks can't over-allocate.
      await tx.execute(sql`select id from invoices where org_id = ${ctx.orgId} and branch_id = ${branchId} and patient_id = ${patient.id} and status = 'issued' for update`);
      const open = await outstandingInvoices(tx, ctx.orgId, branchId, patient.id);
      const allocation = allocateReceipt(input.amountPaise as Paise, open);

      const { number } = await nextDocumentNumber(tx, {
        orgId: ctx.orgId,
        branchId,
        branchCode: branch.code,
        documentType: 'receipt',
        businessDate: date,
      });
      const [rec] = await tx
        .insert(receipts)
        .values({
          orgId: ctx.orgId,
          branchId,
          patientId: patient.id,
          number,
          receivedOn: date,
          mode: input.mode,
          reference: input.reference || null,
          amountPaise: input.amountPaise,
          idempotencyKey: input.idempotencyKey,
          createdBy: ctx.userId,
        })
        .returning({ id: receipts.id });
      for (const a of allocation.allocations) {
        await tx.insert(receiptAllocations).values({ orgId: ctx.orgId, receiptId: rec!.id, invoiceId: a.invoiceId, amountPaise: a.amountPaise });
      }
      await tx.insert(ledgerEntries).values({
        orgId: ctx.orgId,
        branchId,
        patientId: patient.id,
        entryType: 'receipt',
        amountPaise: negate(input.amountPaise as Paise),
        occurredOn: date,
        receiptId: rec!.id,
        narration: `${number} · ${input.mode.replace('_', ' ')}${input.reference ? ` · ${input.reference}` : ''}`,
        createdBy: ctx.userId,
      });
      await writeAudit(tx, ctx, {
        action: 'receipt.record',
        entityType: 'receipt',
        entityId: rec!.id,
        branchId,
        after: { number, amountPaise: input.amountPaise, mode: input.mode },
      });
      return {
        receiptId: rec!.id,
        number,
        allocations: allocation.allocations,
        advancePaise: allocation.unallocatedPaise,
        duplicate: false,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'receipts_idempotency_unique')) {
      const again = await byKey(ctx.orgId, input.idempotencyKey);
      if (again) return again;
    }
    throw err;
  }
}

async function byKey(orgId: string, key: string): Promise<RecordReceiptResult | null> {
  const db = getDb();
  const [r] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.orgId, orgId), eq(receipts.idempotencyKey, key)))
    .limit(1);
  if (!r) return null;
  const allocs = await db
    .select({ invoiceId: receiptAllocations.invoiceId, amountPaise: receiptAllocations.amountPaise })
    .from(receiptAllocations)
    .where(eq(receiptAllocations.receiptId, r.id));
  const allocated = allocs.reduce((s, a) => s + a.amountPaise, 0);
  return {
    receiptId: r.id,
    number: r.number,
    allocations: allocs.map((a) => ({ invoiceId: a.invoiceId, amountPaise: a.amountPaise as Paise })),
    advancePaise: (r.amountPaise - allocated) as Paise,
    duplicate: true,
  };
}

// ---------------------------------------------------------------------------
// Cancelling a payment (Slice 3, T19). Mirrors voidInvoice: a status
// transition plus a reversing ledger entry, audited. The row, its number and
// its allocations stay; every derived figure (bill paid/outstanding, patient
// balance, advances, day totals by mode, expected drawer cash, receivables,
// dashboard) ignores a cancelled receipt via `cancelled_at is null`.
// ---------------------------------------------------------------------------

export async function cancelReceipt(ctx: TenantContext, receiptId: string, reasonRaw: string): Promise<void> {
  if (!isUuid(receiptId)) throw new ForbiddenError();
  const reason = reasonRaw.trim();
  if (reason.length < 5) throw new UserFacingError('Say why this payment is being cancelled.');
  await getDb().transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, receiptId), eq(receipts.orgId, ctx.orgId)))
      .for('update');
    if (!r) throw new ForbiddenError();
    assertCan(ctx, 'receipt.cancel', r.branchId);
    if (r.cancelledAt) throw new UserFacingError('This payment is already cancelled.');

    // The day the money was taken must not be closed: its totals were signed off.
    const [book] = await tx
      .select({ status: dayBooks.status })
      .from(dayBooks)
      .where(and(eq(dayBooks.branchId, r.branchId), eq(dayBooks.businessDate, r.receivedOn)))
      .for('share');
    if (book?.status === 'closed') throw new UserFacingError(`The day this payment was taken (${r.receivedOn}) is closed. Reopen the day first.`);
    // The reversal is dated today, so today must be open too.
    const branch = await getBranch(ctx, r.branchId, tx);
    const date = businessDate();
    await ensureDayOpen(tx, { orgId: ctx.orgId, branchId: r.branchId, branchName: branch.name, date, defaultFloatPaise: branch.defaultFloatPaise });

    await tx
      .update(receipts)
      .set({ cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: reason })
      .where(and(eq(receipts.id, r.id), isNull(receipts.cancelledAt)));
    await tx.insert(ledgerEntries).values({
      orgId: ctx.orgId,
      branchId: r.branchId,
      patientId: r.patientId,
      entryType: 'receipt_cancel',
      amountPaise: r.amountPaise,
      occurredOn: date,
      receiptId: r.id,
      narration: `Cancelled ${r.number}`,
      createdBy: ctx.userId,
    });
    await writeAudit(tx, ctx, {
      action: 'receipt.cancel',
      entityType: 'receipt',
      entityId: r.id,
      branchId: r.branchId,
      before: { cancelled: false },
      after: { cancelled: true, reason, amountPaise: r.amountPaise, mode: r.mode },
    });
  });
}

export interface ReceiptDetail {
  id: string;
  number: string;
  receivedOn: string;
  mode: string;
  reference: string | null;
  amountPaise: Paise;
  branchId: string;
  branchName: string;
  patientId: string;
  patientName: string;
  cancelledAt: Date | null;
  cancelReason: string | null;
  allocations: { invoiceId: string; number: string; amountPaise: Paise }[];
  /** Kept as an advance (amount not applied to any bill). */
  advancePaise: Paise;
}

export async function getReceipt(ctx: TenantContext, receiptId: string): Promise<ReceiptDetail | null> {
  if (!isUuid(receiptId)) return null;
  const db = getDb();
  const [row] = await db
    .select({ r: receipts, patientName: patients.fullName, branchName: branches.name })
    .from(receipts)
    .innerJoin(patients, eq(patients.id, receipts.patientId))
    .innerJoin(branches, eq(branches.id, receipts.branchId))
    .where(and(eq(receipts.id, receiptId), eq(receipts.orgId, ctx.orgId)))
    .limit(1);
  if (!row || !ctx.branchIds.includes(row.r.branchId)) return null;
  assertCan(ctx, 'patient.view', row.r.branchId);
  const allocs = await db
    .select({ invoiceId: receiptAllocations.invoiceId, number: invoices.number, amountPaise: receiptAllocations.amountPaise })
    .from(receiptAllocations)
    .innerJoin(invoices, eq(invoices.id, receiptAllocations.invoiceId))
    .where(eq(receiptAllocations.receiptId, receiptId))
    .orderBy(asc(invoices.issuedOn));
  const allocated = allocs.reduce((s, a) => s + a.amountPaise, 0);
  return {
    id: row.r.id,
    number: row.r.number,
    receivedOn: row.r.receivedOn,
    mode: row.r.mode,
    reference: row.r.reference,
    amountPaise: row.r.amountPaise as Paise,
    branchId: row.r.branchId,
    branchName: row.branchName,
    patientId: row.r.patientId,
    patientName: row.patientName,
    cancelledAt: row.r.cancelledAt,
    cancelReason: row.r.cancelReason,
    allocations: allocs.map((a) => ({ ...a, amountPaise: a.amountPaise as Paise })),
    advancePaise: (row.r.amountPaise - allocated) as Paise,
  };
}
