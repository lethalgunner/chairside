import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@/db/client';
import { branches, invoiceLines, invoices, patientRegistrations, patients, receipts, users } from '@/db/schema';
import { ageNow, businessDate } from '@/domain/dates';
import { rupeesCell, toCsv, type Cell } from '@/domain/csv';
import { canOrgWide } from '@/domain/permissions';
import { writeAudit } from './audit';
import { ForbiddenError, type TenantContext } from './context';
import { paidOnInvoiceSql } from './util';

/**
 * "Export my data" (Sprint 3, T40). The owner downloads the clinic's records
 * as CSV: every branch, every row, nothing filtered. Owner only, from an
 * org-wide grant. Each export is audited with its kind and row count, never
 * its contents.
 */
export const EXPORT_KINDS = ['patients', 'bills', 'bill-lines', 'payments'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(v: string): v is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(v);
}

export async function exportCsv(ctx: TenantContext, kind: ExportKind): Promise<{ filename: string; csv: string; rows: number }> {
  if (!canOrgWide(ctx.grants, 'data.export')) throw new ForbiddenError();
  const db = getDb();
  const today = businessDate();
  let header: string[];
  let rows: Cell[][];

  if (kind === 'patients') {
    header = ['File numbers', 'Name', 'Mobile', 'Sex', 'Age today', 'How they heard', 'Referred by', 'Registered on'];
    const ps = await db
      .select({
        p: patients,
        files: sql<string>`coalesce(string_agg(${patientRegistrations.fileNumber}, ' ' order by ${patientRegistrations.fileNumber}), '')`,
      })
      .from(patients)
      .leftJoin(patientRegistrations, eq(patientRegistrations.patientId, patients.id))
      .where(and(eq(patients.orgId, ctx.orgId), sql`${patients.mergedIntoId} is null`))
      .groupBy(patients.id)
      .orderBy(asc(patients.createdAt));
    rows = ps.map(({ p, files }) => [files, p.fullName, p.phone, p.sex, ageNow(p.approximateAge, p.ageRecordedOn, today), p.referralSource, p.referralDetail, businessDate(p.createdAt)]);
  } else if (kind === 'bills') {
    header = ['Bill number', 'Date', 'Branch', 'Patient', 'Mobile', 'Doctor', 'Status', 'Exempt (₹)', 'Taxable (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Rounding (₹)', 'Total (₹)', 'Paid (₹)', 'Due (₹)', 'GSTIN', 'Cancel reason'];
    const doctor = alias(users, 'doctor');
    const paid = paidOnInvoiceSql();
    const bs = await db
      .select({ i: invoices, branch: branches.name, patient: patients.fullName, phone: patients.phone, doctor: doctor.fullName, paid })
      .from(invoices)
      .innerJoin(branches, eq(branches.id, invoices.branchId))
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .leftJoin(doctor, eq(doctor.id, invoices.doctorId))
      .where(and(eq(invoices.orgId, ctx.orgId), sql`${invoices.status} <> 'draft'`))
      .orderBy(asc(invoices.issuedOn), asc(invoices.number));
    rows = bs.map(({ i, branch, patient, phone, doctor: doc, paid: pd }) => {
      const paidPaise = i.status === 'issued' ? Number(pd) : 0;
      return [
        i.number, i.issuedOn, branch, patient, phone, doc, i.status === 'void' ? 'Cancelled' : 'Issued',
        rupeesCell(i.exemptPaise), rupeesCell(i.taxablePaise), rupeesCell(i.cgstPaise), rupeesCell(i.sgstPaise), rupeesCell(i.igstPaise), rupeesCell(i.roundingPaise), rupeesCell(i.totalPaise),
        rupeesCell(paidPaise), rupeesCell(i.status === 'issued' ? i.totalPaise - paidPaise : 0), i.gstin, i.voidReason,
      ];
    });
  } else if (kind === 'bill-lines') {
    header = ['Bill number', 'Date', 'Branch', 'Status', 'Line', 'Description', 'HSN/SAC', 'GST %', 'Qty', 'Rate (₹)', 'Discount (₹)', 'Discount reason', 'Taxable value (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Line total (₹)'];
    const ls = await db
      .select({ l: invoiceLines, number: invoices.number, issuedOn: invoices.issuedOn, status: invoices.status, branch: branches.name })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .innerJoin(branches, eq(branches.id, invoices.branchId))
      .where(and(eq(invoiceLines.orgId, ctx.orgId), sql`${invoices.status} <> 'draft'`))
      .orderBy(asc(invoices.issuedOn), asc(invoices.number), asc(invoiceLines.lineNumber));
    rows = ls.map(({ l, number, issuedOn, status, branch }) => [
      number, issuedOn, branch, status === 'void' ? 'Cancelled' : 'Issued', l.lineNumber, l.description, l.hsnSacCode, (l.gstRateBp / 100).toFixed(2), l.quantity,
      rupeesCell(l.unitPricePaise), rupeesCell(l.discountPaise), l.discountReason, rupeesCell(l.taxableValuePaise), rupeesCell(l.cgstPaise), rupeesCell(l.sgstPaise), rupeesCell(l.igstPaise), rupeesCell(l.lineTotalPaise),
    ]);
  } else {
    header = ['Payment number', 'Date', 'Branch', 'Patient', 'Mobile', 'Mode', 'Reference', 'Amount (₹)', 'Status', 'Cancel reason'];
    const rs = await db
      .select({ r: receipts, branch: branches.name, patient: patients.fullName, phone: patients.phone })
      .from(receipts)
      .innerJoin(branches, eq(branches.id, receipts.branchId))
      .innerJoin(patients, eq(patients.id, receipts.patientId))
      .where(eq(receipts.orgId, ctx.orgId))
      .orderBy(asc(receipts.receivedOn), asc(receipts.number));
    rows = rs.map(({ r, branch, patient, phone }) => [r.number, r.receivedOn, branch, patient, phone, r.mode, r.reference, rupeesCell(r.amountPaise), r.cancelledAt ? 'Cancelled' : 'Received', r.cancelReason]);
  }

  await writeAudit(db, ctx, { action: 'data.export', entityType: 'export', after: { kind, rows: rows.length } });
  return { filename: `chairside-${kind}-${today}.csv`, csv: toCsv(header, rows), rows: rows.length };
}
