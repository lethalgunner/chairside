import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Tx } from '@/db/client';
import {
  branches,
  catalogueItems,
  encounters,
  invoiceLines,
  invoices,
  ledgerEntries,
  memberships,
  patients,
  proceduresPerformed,
  receiptAllocations,
  receipts,
  users,
} from '@/db/schema';
import { businessDate } from '@/domain/dates';
import { add, negate, subtract, min, isPositive, ZERO, type Paise } from '@/domain/money';
import { billCancellation, type BillCancellation } from '@/domain/corrections';
import { computeInvoice, TaxError, type LineInput, type TaxCategory } from '@/domain/tax';
import { getBranch } from './branches';
import { listCatalogue } from './catalogue';
import { assertCan, canDo, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { writeAudit } from './audit';
import { ensureDayOpen } from './daybook';
import { nextDocumentNumber } from './numbering';
import { registerAtBranch } from './patients';
import { isUniqueViolation, isUuid, paidOnInvoiceSql, toPaise } from './util';

const paiseSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const issueBillInput = z
  .object({
    patientId: z.string().uuid(),
    doctorId: z.string().uuid({ message: 'Pick the doctor.' }),
    idempotencyKey: z.string().min(8).max(100),
    mode: z.enum(['issue', 'unbilled']),
    lines: z
      .array(
        z.object({
          catalogueItemId: z.string().uuid().optional(),
          procedureId: z.string().uuid().optional(),
          quantity: z.number().int().min(1).max(99),
          discountPaise: paiseSchema.default(0),
          discountReason: z.string().trim().max(120).optional(),
          toothNumber: z.string().trim().max(10).optional(),
        }),
      )
      .min(1, 'Add at least one item.'),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      if (!l.catalogueItemId === !l.procedureId) {
        ctx.addIssue({ code: 'custom', path: ['lines', i], message: 'Each line needs exactly one item.' });
      }
      if (l.discountPaise > 0 && !(l.discountReason && l.discountReason.length >= 3)) {
        ctx.addIssue({ code: 'custom', path: ['lines', i], message: 'Give a reason for the discount.' });
      }
    });
    if (v.mode === 'unbilled' && v.lines.some((l) => l.procedureId)) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Already-recorded procedures can only be billed.' });
    }
  });
export type IssueBillInput = z.input<typeof issueBillInput>;

export type IssueBillResult =
  | { kind: 'issued'; invoiceId: string; number: string; totalPaise: Paise; duplicate: boolean }
  | { kind: 'unbilled'; encounterId: string };

/**
 * Raise a bill (or record work to bill later) at the active branch.
 *
 * One transaction: day-open check → procedures → tax computed per line and
 * snapshotted → gapless number → ledger debit → any advance the patient holds
 * at this branch applied oldest-first. A repeated idempotency key returns the
 * first invoice instead of issuing a second.
 */
export async function issueBill(ctx: TenantContext, raw: IssueBillInput): Promise<IssueBillResult> {
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, 'invoice.issue', branchId);
  const parsed = issueBillInput.safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? 'Check the bill.');
  const input = parsed.data;
  const branch = await getBranch(ctx, branchId);
  const db = getDb();

  if (input.mode === 'issue') {
    const existing = await findByIdempotencyKey(ctx.orgId, input.idempotencyKey);
    if (existing) return { kind: 'issued', ...existing, duplicate: true };
  }

  const date = businessDate();
  try {
    return await db.transaction(async (tx) => {
      await ensureDayOpen(tx, { orgId: ctx.orgId, branchId, branchName: branch.name, date, defaultFloatPaise: branch.defaultFloatPaise });

      const [patient] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, input.patientId), eq(patients.orgId, ctx.orgId)))
        .limit(1);
      if (!patient) throw new ForbiddenError();

      const [doctor] = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .where(
          and(
            eq(users.id, input.doctorId),
            eq(users.orgId, ctx.orgId),
            inArray(memberships.role, ['doctor', 'associate_doctor']),
            sql`(${memberships.branchId} = ${branchId} or ${memberships.branchId} is null)`,
          ),
        )
        .limit(1);
      if (!doctor) throw new UserFacingError('That doctor does not work at this branch.');

      // First visit at this branch gets a file number here.
      const [branchRow] = await tx
        .select({ id: branches.id, code: branches.code })
        .from(branches)
        .where(eq(branches.id, branchId))
        .for('update');
      await registerAtBranch(tx, ctx.orgId, branchRow!, patient.id);

      const resolved = await resolveLines(tx, ctx, branchId, patient.id, input);

      let encounterId: string | null = null;
      const newLines = resolved.filter((l) => !l.procedureId);
      if (newLines.length > 0) {
        const [enc] = await tx
          .insert(encounters)
          .values({ orgId: ctx.orgId, branchId, patientId: patient.id, doctorId: doctor.id, occurredOn: date })
          .returning({ id: encounters.id });
        encounterId = enc!.id;
        for (const l of newLines) {
          const [proc] = await tx
            .insert(proceduresPerformed)
            .values({
              orgId: ctx.orgId,
              branchId,
              encounterId,
              patientId: patient.id,
              doctorId: doctor.id,
              catalogueItemId: l.catalogueItemId,
              quantity: l.quantity,
              unitPricePaise: l.unitPricePaise,
              toothNumber: l.toothNumber ?? null,
            })
            .returning({ id: proceduresPerformed.id });
          l.procedureId = proc!.id;
        }
      }

      if (input.mode === 'unbilled') {
        await writeAudit(tx, ctx, { action: 'procedures.record_unbilled', entityType: 'encounter', entityId: encounterId, branchId });
        return { kind: 'unbilled' as const, encounterId: encounterId! };
      }

      const lineInputs: LineInput[] = resolved.map((l) => ({
        description: l.toothNumber ? `${l.name}, tooth ${l.toothNumber}` : l.name,
        quantity: l.quantity,
        unitPricePaise: l.unitPricePaise,
        discountPaise: l.discountPaise,
        discountReason: l.discountReason,
        taxCategory: l.taxCategory,
        hsnSacCode: l.hsnSacCode,
        gstRateBp: l.gstRateBp,
        catalogueItemId: l.catalogueItemId,
        procedureId: l.procedureId,
      }));
      let computed;
      try {
        computed = computeInvoice(lineInputs, { gstRegistered: branch.gstRegistered, gstin: branch.gstin, placeOfSupplyState: branch.state }, branch.state);
      } catch (e) {
        if (e instanceof TaxError) throw new UserFacingError(e.message);
        throw e;
      }

      const { number, financialYear } = await nextDocumentNumber(tx, {
        orgId: ctx.orgId,
        branchId,
        branchCode: branch.code,
        documentType: 'sale',
        businessDate: date,
      });

      const [inv] = await tx
        .insert(invoices)
        .values({
          orgId: ctx.orgId,
          branchId,
          patientId: patient.id,
          number,
          financialYear,
          issuedOn: date,
          status: 'issued',
          gstRegistered: branch.gstRegistered,
          gstin: branch.gstin,
          subtotalPaise: computed.subtotalPaise,
          discountPaise: computed.discountPaise,
          taxablePaise: computed.taxablePaise,
          exemptPaise: computed.exemptPaise,
          cgstPaise: computed.cgstPaise,
          sgstPaise: computed.sgstPaise,
          igstPaise: computed.igstPaise,
          roundingPaise: computed.roundingPaise,
          totalPaise: computed.totalPaise,
          doctorId: doctor.id,
          idempotencyKey: input.idempotencyKey,
          createdBy: ctx.userId,
        })
        .returning({ id: invoices.id });

      for (const line of computed.lines) {
        const [row] = await tx
          .insert(invoiceLines)
          .values({
            orgId: ctx.orgId,
            invoiceId: inv!.id,
            lineNumber: line.lineNumber,
            catalogueItemId: line.catalogueItemId ?? null,
            procedureId: line.procedureId ?? null,
            description: line.description,
            quantity: line.quantity,
            unitPricePaise: line.unitPricePaise,
            discountPaise: line.discountPaise,
            discountReason: line.discountReason ?? null,
            taxCategory: line.taxCategory,
            hsnSacCode: line.hsnSacCode,
            gstRateBp: line.gstRateBp,
            taxableValuePaise: line.taxableValuePaise,
            cgstPaise: line.cgstPaise,
            sgstPaise: line.sgstPaise,
            igstPaise: line.igstPaise,
            lineTotalPaise: line.lineTotalPaise,
          })
          .returning({ id: invoiceLines.id });
        if (line.procedureId) {
          await tx
            .update(proceduresPerformed)
            .set({ invoiceLineId: row!.id })
            .where(and(eq(proceduresPerformed.id, line.procedureId), isNull(proceduresPerformed.invoiceLineId)));
        }
      }

      await tx.insert(ledgerEntries).values({
        orgId: ctx.orgId,
        branchId,
        patientId: patient.id,
        entryType: 'invoice',
        amountPaise: computed.totalPaise,
        occurredOn: date,
        invoiceId: inv!.id,
        narration: number,
        createdBy: ctx.userId,
      });

      await applyAdvances(tx, ctx.orgId, branchId, patient.id, inv!.id, computed.totalPaise);
      await writeAudit(tx, ctx, {
        action: 'invoice.issue',
        entityType: 'invoice',
        entityId: inv!.id,
        branchId,
        after: { number, totalPaise: computed.totalPaise },
      });
      return { kind: 'issued' as const, invoiceId: inv!.id, number, totalPaise: computed.totalPaise, duplicate: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'invoices_idempotency_unique')) {
      const existing = await findByIdempotencyKey(ctx.orgId, input.idempotencyKey);
      if (existing) return { kind: 'issued', ...existing, duplicate: true };
    }
    throw err;
  }
}

async function findByIdempotencyKey(orgId: string, key: string) {
  const [row] = await getDb()
    .select({ invoiceId: invoices.id, number: invoices.number, totalPaise: invoices.totalPaise })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.idempotencyKey, key)))
    .limit(1);
  return row ? { ...row, totalPaise: row.totalPaise as Paise } : null;
}

interface ResolvedLine {
  catalogueItemId: string;
  procedureId?: string;
  name: string;
  quantity: number;
  unitPricePaise: Paise;
  discountPaise: Paise;
  discountReason?: string;
  toothNumber?: string;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  gstRateBp: number;
}

/** Turn catalogue picks and unbilled procedures into priced lines, all checked against this org and branch. */
async function resolveLines(
  tx: Tx,
  ctx: TenantContext,
  branchId: string,
  patientId: string,
  input: z.output<typeof issueBillInput>,
): Promise<ResolvedLine[]> {
  const catalogue = new Map((await listCatalogue(ctx, branchId, tx)).map((c) => [c.id, c]));

  const procIds = input.lines.map((l) => l.procedureId).filter((x): x is string => !!x);
  const procs = procIds.length
    ? await tx
        .select({ p: proceduresPerformed, item: catalogueItems })
        .from(proceduresPerformed)
        .innerJoin(catalogueItems, eq(catalogueItems.id, proceduresPerformed.catalogueItemId))
        .where(
          and(
            inArray(proceduresPerformed.id, procIds),
            eq(proceduresPerformed.orgId, ctx.orgId),
            eq(proceduresPerformed.branchId, branchId),
            eq(proceduresPerformed.patientId, patientId),
            isNull(proceduresPerformed.invoiceLineId),
          ),
        )
        .for('update')
    : [];
  const procMap = new Map(procs.map((r) => [r.p.id, r]));

  return input.lines.map((l) => {
    if (l.procedureId) {
      const r = procMap.get(l.procedureId);
      if (!r) throw new UserFacingError('One of those procedures is already billed or belongs elsewhere.');
      return {
        catalogueItemId: r.item.id,
        procedureId: r.p.id,
        name: r.item.name,
        quantity: r.p.quantity,
        unitPricePaise: r.p.unitPricePaise as Paise,
        discountPaise: l.discountPaise as Paise,
        discountReason: l.discountReason,
        toothNumber: r.p.toothNumber ?? undefined,
        taxCategory: r.item.taxCategory as TaxCategory,
        hsnSacCode: r.item.hsnSacCode,
        gstRateBp: r.item.gstRateBp,
      };
    }
    const item = catalogue.get(l.catalogueItemId!);
    if (!item) throw new UserFacingError('One of those items is not in this branch’s price list.');
    return {
      catalogueItemId: item.id,
      name: item.name,
      quantity: l.quantity,
      unitPricePaise: item.pricePaise,
      discountPaise: l.discountPaise as Paise,
      discountReason: l.discountReason,
      toothNumber: l.toothNumber || undefined,
      taxCategory: item.taxCategory,
      hsnSacCode: item.hsnSacCode,
      gstRateBp: item.gstRateBp,
    };
  });
}

/** Spend any money the patient already paid at this branch (an advance) on a new invoice, oldest receipt first. */
async function applyAdvances(tx: Tx, orgId: string, branchId: string, patientId: string, invoiceId: string, totalPaise: Paise) {
  const open = await tx
    .select({
      id: receipts.id,
      unallocated: sql<string>`receipts.amount_paise - coalesce((select sum(a.amount_paise) from receipt_allocations a where a.receipt_id = receipts.id), 0)`,
    })
    .from(receipts)
    // A cancelled payment is not money held; it can't fund a new bill.
    .where(and(eq(receipts.orgId, orgId), eq(receipts.branchId, branchId), eq(receipts.patientId, patientId), isNull(receipts.cancelledAt)))
    .orderBy(asc(receipts.receivedOn), asc(receipts.createdAt))
    .for('update');
  let remaining = totalPaise;
  for (const r of open) {
    const avail = toPaise(r.unallocated);
    if (!isPositive(remaining)) break;
    if (!isPositive(avail)) continue;
    const applied = min(avail, remaining);
    await tx.insert(receiptAllocations).values({ orgId, receiptId: r.id, invoiceId, amountPaise: applied });
    remaining = subtract(remaining, applied);
  }
}

export async function voidInvoice(ctx: TenantContext, invoiceId: string, reasonRaw: string): Promise<void> {
  if (!isUuid(invoiceId)) throw new ForbiddenError();
  const reason = reasonRaw.trim();
  if (reason.length < 5) throw new UserFacingError('Say why this bill is being cancelled.');
  const db = getDb();
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, ctx.orgId)))
      .for('update');
    if (!inv) throw new ForbiddenError();
    if (!ctx.branchIds.includes(inv.branchId)) throw new ForbiddenError();
    const canVoidAny = canDo(ctx, 'invoice.void', inv.branchId);
    const canVoidOwnToday = canDo(ctx, 'invoice.void_own_today', inv.branchId);
    if (!canVoidAny && !canVoidOwnToday) throw new ForbiddenError();
    const [alloc] = await tx
      .select({ n: sql<string>`coalesce(sum(${receiptAllocations.amountPaise}), 0)` })
      .from(receiptAllocations)
      .innerJoin(receipts, eq(receipts.id, receiptAllocations.receiptId))
      .where(and(eq(receiptAllocations.invoiceId, inv.id), isNull(receipts.cancelledAt)));
    const verdict = billCancellation({
      status: inv.status,
      paidPaise: toPaise(alloc?.n),
      issuedOn: inv.issuedOn,
      createdBy: inv.createdBy,
      userId: ctx.userId,
      today: businessDate(),
      canVoidAny,
      canVoidOwnToday,
    });
    if (!verdict.allowed) throw new UserFacingError(verdict.reason);
    const branch = await getBranch(ctx, inv.branchId, tx);
    const date = businessDate();
    await ensureDayOpen(tx, { orgId: ctx.orgId, branchId: inv.branchId, branchName: branch.name, date, defaultFloatPaise: branch.defaultFloatPaise });

    await tx
      .update(invoices)
      .set({ status: 'void', voidedAt: new Date(), voidedBy: ctx.userId, voidReason: reason })
      .where(eq(invoices.id, inv.id));
    await tx.insert(ledgerEntries).values({
      orgId: ctx.orgId,
      branchId: inv.branchId,
      patientId: inv.patientId,
      entryType: 'credit_note',
      amountPaise: negate(inv.totalPaise as Paise),
      occurredOn: date,
      invoiceId: inv.id,
      narration: `Cancelled ${inv.number}`,
      createdBy: ctx.userId,
    });
    // The work was still done: release its procedures back to "unbilled".
    const lineIds = (await tx.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id))).map((l) => l.id);
    if (lineIds.length) {
      await tx.update(proceduresPerformed).set({ invoiceLineId: null }).where(inArray(proceduresPerformed.invoiceLineId, lineIds));
    }
    await writeAudit(tx, ctx, {
      action: 'invoice.void',
      entityType: 'invoice',
      entityId: inv.id,
      branchId: inv.branchId,
      before: { status: inv.status },
      after: { status: 'void', reason },
    });
  });
}

export interface InvoiceDetail {
  id: string;
  number: string;
  status: 'draft' | 'issued' | 'void';
  issuedOn: string;
  branchId: string;
  branchName: string;
  gstRegistered: boolean;
  gstin: string | null;
  patientId: string;
  patientName: string;
  doctorName: string | null;
  voidReason: string | null;
  createdBy: string | null;
  totals: {
    subtotalPaise: Paise;
    discountPaise: Paise;
    taxablePaise: Paise;
    exemptPaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    roundingPaise: Paise;
    totalPaise: Paise;
  };
  paidPaise: Paise;
  duePaise: Paise;
  lines: (typeof invoiceLines.$inferSelect)[];
  /** Every payment ever allocated, cancelled ones included (marked) so the screen can strike them through. */
  payments: { receiptId: string; number: string; receivedOn: string; mode: string; amountPaise: Paise; cancelledAt: Date | null; cancelReason: string | null }[];
}

export async function getInvoice(ctx: TenantContext, invoiceId: string): Promise<InvoiceDetail | null> {
  if (!isUuid(invoiceId)) return null;
  const db = getDb();
  const [row] = await db
    .select({ inv: invoices, patientName: patients.fullName, branchName: branches.name, doctorName: users.fullName })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .innerJoin(branches, eq(branches.id, invoices.branchId))
    .leftJoin(users, eq(users.id, invoices.doctorId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, ctx.orgId)))
    .limit(1);
  if (!row || !ctx.branchIds.includes(row.inv.branchId)) return null;
  assertCan(ctx, 'patient.view', row.inv.branchId);
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.lineNumber));
  const payments = await db
    .select({ receiptId: receipts.id, number: receipts.number, receivedOn: receipts.receivedOn, mode: receipts.mode, amountPaise: receiptAllocations.amountPaise, cancelledAt: receipts.cancelledAt, cancelReason: receipts.cancelReason })
    .from(receiptAllocations)
    .innerJoin(receipts, eq(receipts.id, receiptAllocations.receiptId))
    .where(eq(receiptAllocations.invoiceId, invoiceId))
    .orderBy(asc(receipts.receivedOn));
  const i = row.inv;
  const paid = add(...payments.filter((p) => !p.cancelledAt).map((p) => p.amountPaise as Paise));
  const total = i.totalPaise as Paise;
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    issuedOn: i.issuedOn,
    branchId: i.branchId,
    branchName: row.branchName,
    gstRegistered: i.gstRegistered,
    gstin: i.gstin,
    patientId: i.patientId,
    patientName: row.patientName,
    doctorName: row.doctorName,
    voidReason: i.voidReason,
    createdBy: i.createdBy,
    totals: {
      subtotalPaise: i.subtotalPaise as Paise,
      discountPaise: i.discountPaise as Paise,
      taxablePaise: i.taxablePaise as Paise,
      exemptPaise: i.exemptPaise as Paise,
      cgstPaise: i.cgstPaise as Paise,
      sgstPaise: i.sgstPaise as Paise,
      igstPaise: i.igstPaise as Paise,
      roundingPaise: i.roundingPaise as Paise,
      totalPaise: total,
    },
    paidPaise: paid,
    duePaise: i.status === 'issued' ? subtract(total, paid) : ZERO,
    lines,
    payments: payments.map((p) => ({ ...p, amountPaise: p.amountPaise as Paise })),
  };
}

export interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  issuedOn: string;
  branchName: string;
  patientId: string;
  patientName: string;
  totalPaise: Paise;
  paidPaise: Paise;
  duePaise: Paise;
}

export async function listInvoices(
  ctx: TenantContext,
  opts: { branchIds: string[]; patientId?: string; openOnly?: boolean; limit?: number; /** Only bills issued on this business date (Bills "Today", T27). */ issuedOn?: string },
): Promise<InvoiceRow[]> {
  const ids = opts.branchIds.filter((b) => ctx.branchIds.includes(b));
  if (ids.length === 0) return [];
  const paid = paidOnInvoiceSql();
  const conds = [eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids)];
  if (opts.patientId) conds.push(eq(invoices.patientId, opts.patientId));
  if (opts.issuedOn) conds.push(eq(invoices.issuedOn, opts.issuedOn));
  if (opts.openOnly) conds.push(eq(invoices.status, 'issued'), sql`${invoices.totalPaise} > ${paid}`);
  const rows = await getDb()
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      issuedOn: invoices.issuedOn,
      branchName: branches.name,
      patientId: invoices.patientId,
      patientName: patients.fullName,
      totalPaise: invoices.totalPaise,
      paid,
    })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .innerJoin(branches, eq(branches.id, invoices.branchId))
    .where(and(...conds))
    .orderBy(...(opts.openOnly ? [asc(invoices.issuedOn), asc(invoices.createdAt)] : [desc(invoices.createdAt)]))
    .limit(opts.limit ?? 200);
  return rows.map((r) => {
    const total = r.totalPaise as Paise;
    const p = toPaise(r.paid);
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      issuedOn: r.issuedOn,
      branchName: r.branchName,
      patientId: r.patientId,
      patientName: r.patientName,
      totalPaise: total,
      paidPaise: p,
      duePaise: r.status === 'issued' ? subtract(total, p) : ZERO,
    };
  });
}

/** What the bill screen should offer this user for cancelling (same rule as voidInvoice). */
export function billCancellationFor(ctx: TenantContext, inv: InvoiceDetail): BillCancellation {
  return billCancellation({
    status: inv.status,
    paidPaise: inv.paidPaise,
    issuedOn: inv.issuedOn,
    createdBy: inv.createdBy,
    userId: ctx.userId,
    today: businessDate(),
    canVoidAny: canDo(ctx, 'invoice.void', inv.branchId),
    canVoidOwnToday: canDo(ctx, 'invoice.void_own_today', inv.branchId),
  });
}
