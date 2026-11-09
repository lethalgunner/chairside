import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { appointments, branches, patients } from '@/db/schema';
import { ACTIVE_STATUSES, istInstant } from '@/domain/appointments';
import { bookingFor, doctorKey, parseAppointments, parsePatients, type AppointmentRow, type ImportKind, type PatientRow } from '@/domain/data-import';
import { addDays, businessDate, istTime, shortDay } from '@/domain/dates';
import { leaveOn } from '@/domain/leave';
import { canOrgWide } from '@/domain/permissions';
import { formatIndianMobile } from '@/domain/phone';
import { writeAudit } from './audit';
import { assertCan, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { leavesFor } from './leave';
import { registerAtBranch } from './patients';
import { listProviders } from './providers';

/**
 * Bring your data (Sprint 9): patients and future appointments from the old
 * software, into the active branch. Owner only. Like the price-list paste,
 * the browser only sends text: Check parses and matches it here (a dry run,
 * nothing written), and Import parses and matches it again inside one
 * transaction and writes everything or nothing.
 */

export type RowStatus = 'new' | 'skip' | 'error';
export interface DataPreviewRow {
  line: number;
  status: RowStatus;
  summary: string;
  note: string;
}
export type DataPreview =
  | { ok: true; kind: ImportKind; header: boolean; rows: DataPreviewRow[]; counts: Record<RowStatus, number> }
  | { ok: false; error: string };
export type DataImportResult = { ok: true; created: number; skipped: number } | { ok: false; error: string; preview?: DataPreview };

export const DATA_CHANGED = 'Something changed since you pressed Check. Press Check again and look over the rows before importing.';
export const DATA_HAS_ERRORS = 'Some rows have problems, so nothing was imported. Fix them in your sheet, paste again and press Check.';

function assertImporter(ctx: TenantContext, kind: ImportKind): string {
  if (!canOrgWide(ctx.grants, 'staff.manage')) throw new ForbiddenError();
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, kind === 'patients' ? 'patient.register' : 'appointment.manage', branchId);
  return branchId;
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-zऀ-ॿ]/g, '');

interface PatientPlan {
  rows: DataPreviewRow[];
  toCreate: PatientRow[];
}

async function planPatients(db: DB | Tx, ctx: TenantContext, text: string): Promise<{ ok: false; error: string } | ({ ok: true; header: boolean } & PatientPlan)> {
  const parsed = parsePatients(text, businessDate());
  if (!parsed.ok) return parsed;
  const phones = [...new Set(parsed.rows.flatMap((r) => (r.value ? [r.value.phone] : [])))];
  const existing = phones.length ? await db.select({ fullName: patients.fullName, phone: patients.phone }).from(patients).where(and(eq(patients.orgId, ctx.orgId), inArray(patients.phone, phones))) : [];
  const seen = new Map<string, number>();
  const rows: DataPreviewRow[] = [];
  const toCreate: PatientRow[] = [];
  for (const r of parsed.rows) {
    if (!r.value) {
      rows.push({ line: r.line, status: 'error', summary: '', note: r.error! });
      continue;
    }
    const v = r.value;
    const summary = `${v.fullName} · ${formatIndianMobile(v.phone)}`;
    const k = `${v.phone}|${nameKey(v.fullName)}`;
    if (seen.has(k)) {
      rows.push({ line: r.line, status: 'error', summary, note: `Same patient as line ${seen.get(k)}. Remove one.` });
      continue;
    }
    seen.set(k, r.line);
    const samePhone = existing.filter((e) => e.phone === v.phone);
    if (samePhone.some((e) => nameKey(e.fullName) === nameKey(v.fullName))) {
      rows.push({ line: r.line, status: 'skip', summary, note: 'Already in Chairside.' });
      continue;
    }
    rows.push({ line: r.line, status: 'new', summary, note: samePhone.length ? `Shares a mobile with ${samePhone[0]!.fullName} (fine for families).` : '' });
    toCreate.push(v);
  }
  return { ok: true, header: parsed.header, rows, toCreate };
}

interface ApptPlan {
  rows: DataPreviewRow[];
  toCreate: { patientId: string; providerId: string; startsAt: Date; endsAt: Date; line: number }[];
}

async function planAppointments(db: DB | Tx, ctx: TenantContext, branchId: string, text: string, now: Date): Promise<{ ok: false; error: string } | ({ ok: true; header: boolean } & ApptPlan)> {
  const parsed = parseAppointments(text);
  if (!parsed.ok) return parsed;
  const doctors = await listProviders(ctx, branchId, db);
  const byKey = new Map(doctors.map((d) => [doctorKey(d.fullName), d]));
  const findDoctor = (raw: string) => {
    const k = doctorKey(raw);
    if (byKey.has(k)) return byKey.get(k)!;
    const partial = doctors.filter((d) => {
      const dk = doctorKey(d.fullName);
      return k.length >= 3 && (dk.includes(k) || k.includes(dk));
    });
    return partial.length === 1 ? partial[0]! : null;
  };
  const values = parsed.rows.flatMap((r) => (r.value ? [r.value] : []));
  const phones = [...new Set(values.map((v) => v.phone))];
  const pts = phones.length ? await db.select({ id: patients.id, fullName: patients.fullName, phone: patients.phone }).from(patients).where(and(eq(patients.orgId, ctx.orgId), inArray(patients.phone, phones))) : [];
  const dates = values.map((v) => v.date).sort();
  const from = dates[0] ?? businessDate(now);
  const to = dates[dates.length - 1] ?? from;
  const docIds = doctors.map((d) => d.id);
  const booked = docIds.length
    ? await db
        .select({ patientId: appointments.patientId, providerId: appointments.doctorId, startsAt: appointments.startsAt, endsAt: appointments.endsAt })
        .from(appointments)
        .where(and(eq(appointments.orgId, ctx.orgId), inArray(appointments.doctorId, docIds), inArray(appointments.status, [...ACTIVE_STATUSES]), lt(appointments.startsAt, istInstant(addDays(to, 1), '00:00')), gt(appointments.endsAt, istInstant(from, '00:00'))))
    : [];
  const leaves = await leavesFor(db, ctx.orgId, docIds, from, to);
  const rows: DataPreviewRow[] = [];
  const toCreate: ApptPlan['toCreate'] = [];
  const names = doctors.map((d) => d.fullName).join(', ') || 'none yet';

  for (const r of parsed.rows) {
    if (!r.value) {
      rows.push({ line: r.line, status: 'error', summary: '', note: r.error! });
      continue;
    }
    const v: AppointmentRow = r.value;
    const summary = `${shortDay(v.date)} ${v.time} · ${v.name || formatIndianMobile(v.phone)} · ${v.doctor}`;
    const err = (note: string) => rows.push({ line: r.line, status: 'error', summary, note });
    const doc = findDoctor(v.doctor);
    if (!doc) {
      err(`No doctor called “${v.doctor}” works at this branch. Doctors here: ${names}.`);
      continue;
    }
    const candidates = pts.filter((p) => p.phone === v.phone);
    const patient = candidates.length === 1 ? candidates[0]! : candidates.find((p) => v.name && nameKey(p.fullName) === nameKey(v.name));
    if (!patient) {
      err(candidates.length === 0 ? 'No patient with this mobile. Import patients first.' : 'Several patients share this mobile and the name matches none of them.');
      continue;
    }
    const b = bookingFor(v, doc.slotMinutes);
    if (!b.ok) {
      err(Object.values(b.fieldErrors)[0] ?? 'Check the date and time.');
      continue;
    }
    const { startsAt, endsAt } = b.value;
    if (startsAt <= now) {
      rows.push({ line: r.line, status: 'skip', summary, note: 'In the past: only coming appointments are brought in.' });
      continue;
    }
    if (leaveOn(leaves.filter((l) => l.providerId === doc.id), v.date)) {
      err(`${doc.fullName} is on leave that day.`);
      continue;
    }
    if (booked.some((x) => x.patientId === patient.id && x.providerId === doc.id && x.startsAt.getTime() === startsAt.getTime())) {
      rows.push({ line: r.line, status: 'skip', summary, note: 'Already booked in Chairside.' });
      continue;
    }
    const clash = booked.find((x) => x.providerId === doc.id && x.startsAt < endsAt && x.endsAt > startsAt);
    if (clash) {
      err(`${doc.fullName} already has someone from ${istTime(clash.startsAt)} to ${istTime(clash.endsAt)}.`);
      continue;
    }
    const inPaste = toCreate.find((x) => x.providerId === doc.id && x.startsAt < endsAt && x.endsAt > startsAt);
    if (inPaste) {
      err(`Clashes with line ${inPaste.line} for ${doc.fullName}.`);
      continue;
    }
    rows.push({ line: r.line, status: 'new', summary: `${shortDay(v.date)} ${v.time} · ${patient.fullName} · ${doc.fullName}`, note: '' });
    toCreate.push({ patientId: patient.id, providerId: doc.id, startsAt, endsAt, line: r.line });
  }
  return { ok: true, header: parsed.header, rows, toCreate };
}

const countRows = (rows: DataPreviewRow[]) => ({ new: rows.filter((r) => r.status === 'new').length, skip: rows.filter((r) => r.status === 'skip').length, error: rows.filter((r) => r.status === 'error').length });

/** Check: a dry run. Nothing is written. */
export async function previewImport(ctx: TenantContext, kind: ImportKind, text: string, now: Date = new Date()): Promise<DataPreview> {
  const branchId = assertImporter(ctx, kind);
  const db = getDb();
  const plan = kind === 'patients' ? await planPatients(db, ctx, text) : await planAppointments(db, ctx, branchId, text, now);
  if (!plan.ok) return plan;
  return { ok: true, kind, header: plan.header, rows: plan.rows, counts: countRows(plan.rows) };
}

/** Import: everything in the dry run, or nothing. `expectNew` is the count the person saw. */
export async function saveImport(ctx: TenantContext, kind: ImportKind, text: string, expectNew: number, now: Date = new Date()): Promise<DataImportResult> {
  const branchId = assertImporter(ctx, kind);
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [branch] = await tx.select({ id: branches.id, code: branches.code }).from(branches).where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId))).for('update');
      if (!branch) throw new ForbiddenError();
      if (kind === 'patients') {
        const plan = await planPatients(tx, ctx, text);
        if (!plan.ok) return plan;
        const counts = countRows(plan.rows);
        const preview: DataPreview = { ok: true, kind, header: plan.header, rows: plan.rows, counts };
        if (counts.error > 0) return { ok: false as const, error: DATA_HAS_ERRORS, preview };
        if (counts.new !== expectNew) return { ok: false as const, error: DATA_CHANGED, preview };
        const today = businessDate(now);
        for (const p of plan.toCreate) {
          const [row] = await tx
            .insert(patients)
            .values({ orgId: ctx.orgId, fullName: p.fullName, phone: p.phone, sex: p.sex, dateOfBirth: p.dateOfBirth, approximateAge: p.age, ageRecordedOn: p.age !== null ? today : null, referralSource: 'Imported' })
            .returning({ id: patients.id });
          await registerAtBranch(tx, ctx.orgId, branch, row!.id);
          await writeAudit(tx, ctx, { action: 'patient.register', entityType: 'patient', entityId: row!.id, branchId, after: { imported: true } });
        }
        await writeAudit(tx, ctx, { action: 'import.patients', entityType: 'organisation', entityId: ctx.orgId, branchId, after: { created: counts.new, skipped: counts.skip } });
        return { ok: true as const, created: counts.new, skipped: counts.skip };
      }
      const plan = await planAppointments(tx, ctx, branchId, text, now);
      if (!plan.ok) return plan;
      const counts = countRows(plan.rows);
      const preview: DataPreview = { ok: true, kind, header: plan.header, rows: plan.rows, counts };
      if (counts.error > 0) return { ok: false as const, error: DATA_HAS_ERRORS, preview };
      if (counts.new !== expectNew) return { ok: false as const, error: DATA_CHANGED, preview };
      for (const a of plan.toCreate) {
        const [row] = await tx
          .insert(appointments)
          .values({ orgId: ctx.orgId, branchId, patientId: a.patientId, doctorId: a.providerId, startsAt: a.startsAt, endsAt: a.endsAt, imported: true, createdBy: ctx.userId })
          .returning({ id: appointments.id });
        await writeAudit(tx, ctx, { action: 'appointment.book', entityType: 'appointment', entityId: row!.id, branchId, after: { providerId: a.providerId, startsAt: a.startsAt, endsAt: a.endsAt, imported: true } });
      }
      await writeAudit(tx, ctx, { action: 'import.appointments', entityType: 'organisation', entityId: ctx.orgId, branchId, after: { created: counts.new, skipped: counts.skip } });
      return { ok: true as const, created: counts.new, skipped: counts.skip };
    });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    if (code === '23P01') throw new UserFacingError('Someone booked one of those times while you were importing. Press Check again.');
    throw e;
  }
}
