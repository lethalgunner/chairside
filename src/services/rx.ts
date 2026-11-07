import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Tx } from '@/db/client';
import { branches, catalogueItems, medicines, patients, prescriptionLines, prescriptions, proceduresPerformed, providerBranches, providers, rxTemplateLines, rxTemplates, treatmentPlanItems, treatmentPlans } from '@/db/schema';
import { istInstant } from '@/domain/appointments';
import { businessDate } from '@/domain/dates';
import { checkAllergies, checkDose, checkMedicine, checkPrescription, rxRef, type DoseInput, type MedicineForm, type MedicineInput, type RxInput } from '@/domain/rx';
import type { FieldErrors } from '@/domain/staff';
import { STARTER_MEDICINES } from '@/domain/starter-medicines';
import { writeAudit } from './audit';
import { canAnywhere, canDo, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { isUniqueViolation, isUuid } from './util';

/**
 * Medicines, templates and prescriptions (Sprint 5, LET-172/173). Only a
 * doctor with `rx.write` and an active doctor profile at the branch signs a
 * prescription. Signed prescriptions are append-only; reading one is audited
 * (health data, CTO S3).
 */

export interface MedicineRow {
  id: string;
  name: string;
  strength: string | null;
  form: MedicineForm;
  dose: string | null;
  frequency: string | null;
  days: number | null;
  instructions: string | null;
  active: boolean;
}

function assertMedicines(ctx: TenantContext) {
  if (!canAnywhere(ctx, 'medicine.manage')) throw new ForbiddenError();
}

export async function listMedicines(ctx: TenantContext, opts: { activeOnly?: boolean } = {}): Promise<MedicineRow[]> {
  if (!canAnywhere(ctx, 'medicine.manage') && !canAnywhere(ctx, 'rx.write') && !canAnywhere(ctx, 'stock.manage')) throw new ForbiddenError();
  const rows = await getDb()
    .select()
    .from(medicines)
    .where(and(eq(medicines.orgId, ctx.orgId), opts.activeOnly ? eq(medicines.active, true) : undefined))
    .orderBy(desc(medicines.active), asc(medicines.name));
  return rows.map((r) => ({ id: r.id, name: r.name, strength: r.strength, form: r.form as MedicineForm, dose: r.dose, frequency: r.frequency, days: r.days, instructions: r.instructions, active: r.active }));
}

export type SaveResult = { ok: true; id: string } | { ok: false; fieldErrors: FieldErrors };

export async function saveMedicine(ctx: TenantContext, id: string | null, input: MedicineInput): Promise<SaveResult> {
  assertMedicines(ctx);
  const checked = checkMedicine(input);
  if (!checked.ok) return checked;
  try {
    return await getDb().transaction(async (tx) => {
      if (id === null) {
        const [row] = await tx.insert(medicines).values({ orgId: ctx.orgId, ...checked.value }).returning({ id: medicines.id });
        await writeAudit(tx, ctx, { action: 'medicine.create', entityType: 'medicine', entityId: row!.id, after: checked.value });
        return { ok: true as const, id: row!.id };
      }
      if (!isUuid(id)) throw new ForbiddenError();
      const [before] = await tx.select().from(medicines).where(and(eq(medicines.id, id), eq(medicines.orgId, ctx.orgId))).for('update');
      if (!before) throw new ForbiddenError();
      await tx.update(medicines).set(checked.value).where(and(eq(medicines.id, id), eq(medicines.orgId, ctx.orgId)));
      await writeAudit(tx, ctx, { action: 'medicine.update', entityType: 'medicine', entityId: id, before, after: checked.value });
      return { ok: true as const, id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'medicines_org_name_strength_unique')) return { ok: false, fieldErrors: { name: 'That medicine and strength is already on the list.' } };
    throw err;
  }
}

export async function setMedicineActive(ctx: TenantContext, id: string, active: boolean): Promise<void> {
  assertMedicines(ctx);
  if (!isUuid(id)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [m] = await tx.select().from(medicines).where(and(eq(medicines.id, id), eq(medicines.orgId, ctx.orgId))).for('update');
    if (!m) throw new ForbiddenError();
    if (m.active === active) return;
    await tx.update(medicines).set({ active }).where(eq(medicines.id, m.id));
    await writeAudit(tx, ctx, { action: active ? 'medicine.reactivate' : 'medicine.deactivate', entityType: 'medicine', entityId: m.id });
  });
}

/** Add the starter list (skips any already there). Returns how many were added. */
export async function addStarterMedicines(ctx: TenantContext): Promise<number> {
  assertMedicines(ctx);
  return getDb().transaction(async (tx) => {
    let added = 0;
    for (const s of STARTER_MEDICINES) {
      const c = checkMedicine(s);
      if (!c.ok) continue;
      const r = await tx.insert(medicines).values({ orgId: ctx.orgId, ...c.value }).onConflictDoNothing().returning({ id: medicines.id });
      added += r.length;
    }
    await writeAudit(tx, ctx, { action: 'medicine.starter_list', entityType: 'medicine', entityId: null, after: { added } });
    return added;
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateLine {
  medicineId: string;
  name: string;
  strength: string | null;
  form: MedicineForm;
  dose: string | null;
  frequency: string | null;
  days: number | null;
  instructions: string | null;
}

export interface TemplateRow {
  id: string;
  name: string;
  catalogueItemId: string | null;
  treatmentName: string | null;
  advice: string | null;
  active: boolean;
  lines: TemplateLine[];
}

export async function listTemplates(ctx: TenantContext, opts: { activeOnly?: boolean } = {}): Promise<TemplateRow[]> {
  if (!canAnywhere(ctx, 'medicine.manage') && !canAnywhere(ctx, 'rx.write')) throw new ForbiddenError();
  const db = getDb();
  const ts = await db
    .select({ t: rxTemplates, treatmentName: catalogueItems.name })
    .from(rxTemplates)
    .leftJoin(catalogueItems, eq(catalogueItems.id, rxTemplates.catalogueItemId))
    .where(and(eq(rxTemplates.orgId, ctx.orgId), opts.activeOnly ? eq(rxTemplates.active, true) : undefined))
    .orderBy(desc(rxTemplates.active), asc(rxTemplates.name));
  if (ts.length === 0) return [];
  const lines = await db
    .select({ l: rxTemplateLines, m: medicines })
    .from(rxTemplateLines)
    .innerJoin(medicines, eq(medicines.id, rxTemplateLines.medicineId))
    .where(and(eq(rxTemplateLines.orgId, ctx.orgId), inArray(rxTemplateLines.templateId, ts.map((t) => t.t.id))))
    .orderBy(asc(rxTemplateLines.sortOrder));
  return ts.map(({ t, treatmentName }) => ({
    id: t.id,
    name: t.name,
    catalogueItemId: t.catalogueItemId,
    treatmentName,
    advice: t.advice,
    active: t.active,
    lines: lines
      .filter((x) => x.l.templateId === t.id)
      .map(({ l, m }) => ({ medicineId: m.id, name: m.name, strength: m.strength, form: m.form as MedicineForm, dose: l.dose, frequency: l.frequency, days: l.days, instructions: l.instructions })),
  }));
}

export interface TemplateInput {
  name: string;
  catalogueItemId: string;
  advice: string;
  lines: (DoseInput & { medicineId: string })[];
}

export async function saveTemplate(ctx: TenantContext, id: string | null, input: TemplateInput): Promise<SaveResult> {
  assertMedicines(ctx);
  const fieldErrors: FieldErrors = {};
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) fieldErrors.name = 'Name the template, like “Root canal” (2 to 60 characters).';
  const advice = input.advice.trim();
  if (advice.length > 500) fieldErrors.advice = 'Keep advice under 500 characters.';
  if (input.lines.length === 0 || input.lines.length > 15) fieldErrors.lines = 'A template has 1 to 15 medicines.';
  const lines = input.lines.map((l, i) => ({ medicineId: l.medicineId, ...checkDose(l, fieldErrors, `lines.${i}.`) }));
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return getDb().transaction(async (tx) => {
    const medIds = [...new Set(lines.map((l) => l.medicineId))];
    if (!medIds.every(isUuid)) throw new ForbiddenError();
    const meds = await tx.select({ id: medicines.id }).from(medicines).where(and(eq(medicines.orgId, ctx.orgId), inArray(medicines.id, medIds)));
    if (meds.length !== medIds.length) throw new ForbiddenError();
    let catalogueItemId: string | null = null;
    if (input.catalogueItemId) {
      if (!isUuid(input.catalogueItemId)) throw new ForbiddenError();
      const [c] = await tx.select({ id: catalogueItems.id }).from(catalogueItems).where(and(eq(catalogueItems.id, input.catalogueItemId), eq(catalogueItems.orgId, ctx.orgId)));
      if (!c) throw new ForbiddenError();
      catalogueItemId = c.id;
    }
    let tid = id;
    if (tid === null) {
      const [row] = await tx.insert(rxTemplates).values({ orgId: ctx.orgId, name, catalogueItemId, advice: advice || null }).returning({ id: rxTemplates.id });
      tid = row!.id;
    } else {
      if (!isUuid(tid)) throw new ForbiddenError();
      const [t] = await tx.select({ id: rxTemplates.id }).from(rxTemplates).where(and(eq(rxTemplates.id, tid), eq(rxTemplates.orgId, ctx.orgId))).for('update');
      if (!t) throw new ForbiddenError();
      await tx.update(rxTemplates).set({ name, catalogueItemId, advice: advice || null }).where(eq(rxTemplates.id, tid));
      // A template is a shortcut, not a record: its lines are replaced whole.
      await tx.delete(rxTemplateLines).where(and(eq(rxTemplateLines.templateId, tid), eq(rxTemplateLines.orgId, ctx.orgId)));
    }
    await tx.insert(rxTemplateLines).values(lines.map((l, i) => ({ orgId: ctx.orgId, templateId: tid!, sortOrder: i, ...l })));
    await writeAudit(tx, ctx, { action: id ? 'rx_template.update' : 'rx_template.create', entityType: 'rx_template', entityId: tid, after: { name, catalogueItemId, lines: lines.length } });
    return { ok: true as const, id: tid! };
  });
}

export async function setTemplateActive(ctx: TenantContext, id: string, active: boolean): Promise<void> {
  assertMedicines(ctx);
  if (!isUuid(id)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [t] = await tx.select().from(rxTemplates).where(and(eq(rxTemplates.id, id), eq(rxTemplates.orgId, ctx.orgId))).for('update');
    if (!t) throw new ForbiddenError();
    if (t.active === active) return;
    await tx.update(rxTemplates).set({ active }).where(eq(rxTemplates.id, t.id));
    await writeAudit(tx, ctx, { action: active ? 'rx_template.reactivate' : 'rx_template.deactivate', entityType: 'rx_template', entityId: t.id });
  });
}

/** Templates linked to treatments done for this patient today, or still to do on an open plan. */
export async function suggestedTemplateIds(ctx: TenantContext, patientId: string, branchId: string): Promise<string[]> {
  if (!isUuid(patientId)) return [];
  const db = getDb();
  const today = businessDate();
  const done = await db
    .select({ id: proceduresPerformed.catalogueItemId })
    .from(proceduresPerformed)
    .where(and(eq(proceduresPerformed.orgId, ctx.orgId), eq(proceduresPerformed.patientId, patientId), eq(proceduresPerformed.branchId, branchId), gte(proceduresPerformed.performedAt, istInstant(today, '00:00')), isNull(proceduresPerformed.dismissedAt)));
  const planned = await db
    .select({ id: treatmentPlanItems.catalogueItemId })
    .from(treatmentPlanItems)
    .innerJoin(treatmentPlans, eq(treatmentPlans.id, treatmentPlanItems.planId))
    .where(and(eq(treatmentPlans.orgId, ctx.orgId), eq(treatmentPlans.patientId, patientId), inArray(treatmentPlans.status, ['draft', 'accepted']), eq(treatmentPlanItems.status, 'planned')));
  const items = [...new Set([...done, ...planned].map((r) => r.id))];
  if (items.length === 0) return [];
  const ts = await db.select({ id: rxTemplates.id }).from(rxTemplates).where(and(eq(rxTemplates.orgId, ctx.orgId), eq(rxTemplates.active, true), inArray(rxTemplates.catalogueItemId, items)));
  return ts.map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

/** The signed-in doctor's profile if they can prescribe at this branch, else null. */
export async function prescriberAt(ctx: TenantContext, branchId: string, db: ReturnType<typeof getDb> | Tx = getDb()) {
  if (!canDo(ctx, 'rx.write', branchId)) return null;
  const [p] = await db
    .select({ id: providers.id, fullName: providers.fullName, registrationNumber: providers.registrationNumber })
    .from(providers)
    .innerJoin(providerBranches, eq(providerBranches.providerId, providers.id))
    .where(and(eq(providers.userId, ctx.userId), eq(providers.orgId, ctx.orgId), eq(providers.active, true), eq(providerBranches.branchId, branchId)))
    .limit(1);
  return p ?? null;
}

export type WriteRxResult = { ok: true; id: string } | { ok: false; fieldErrors: FieldErrors };

/**
 * Sign a prescription at the active branch. With `replacesId`, it corrects an
 * earlier one for the same patient, which is marked replaced (never edited).
 * Allergies typed here are saved on the patient too.
 */
export async function writePrescription(ctx: TenantContext, input: RxInput & { patientId: string; allergies: string; replacesId?: string | null }): Promise<WriteRxResult> {
  const branchId = requireActiveBranch(ctx);
  if (!canDo(ctx, 'rx.write', branchId)) throw new ForbiddenError();
  if (!isUuid(input.patientId)) throw new ForbiddenError();
  const checked = checkPrescription(input);
  const allergies = checkAllergies(input.allergies);
  if (!checked.ok || !allergies.ok) return { ok: false, fieldErrors: { ...(checked.ok ? {} : checked.fieldErrors), ...(allergies.ok ? {} : allergies.fieldErrors) } };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getDb().transaction(async (tx) => {
        const doctor = await prescriberAt(ctx, branchId, tx);
        if (!doctor) throw new UserFacingError('Only a doctor with a profile at this branch can sign a prescription. The owner links you in Settings → Doctors.');
        const [patient] = await tx.select({ id: patients.id, allergies: patients.allergies }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.orgId, ctx.orgId))).for('update');
        if (!patient) throw new ForbiddenError();
        // Medicines picked from the list must be this clinic's.
        const medIds = checked.value.lines.map((l) => l.medicineId).filter((x): x is string => !!x);
        if (!medIds.every(isUuid)) throw new ForbiddenError();
        if (medIds.length) {
          const found = await tx.select({ id: medicines.id }).from(medicines).where(and(eq(medicines.orgId, ctx.orgId), inArray(medicines.id, medIds)));
          if (found.length !== new Set(medIds).size) throw new ForbiddenError();
        }
        let replaces: { id: string } | null = null;
        if (input.replacesId) {
          if (!isUuid(input.replacesId)) throw new ForbiddenError();
          const [old] = await tx.select().from(prescriptions).where(and(eq(prescriptions.id, input.replacesId), eq(prescriptions.orgId, ctx.orgId))).for('update');
          if (!old || old.patientId !== patient.id || !ctx.branchIds.includes(old.branchId)) throw new ForbiddenError();
          if (old.status !== 'signed') throw new UserFacingError('That prescription was already corrected. Correct the newest one.');
          replaces = old;
        }
        const [next] = await tx.select({ n: sql<number>`coalesce(max(${prescriptions.rxNumber}), 0)::int + 1` }).from(prescriptions).where(eq(prescriptions.branchId, branchId));
        const [rx] = await tx
          .insert(prescriptions)
          .values({ orgId: ctx.orgId, branchId, patientId: patient.id, doctorId: doctor.id, rxNumber: next?.n ?? 1, issuedOn: businessDate(), complaint: checked.value.complaint, advice: checked.value.advice, allergies: allergies.value, replacesId: replaces?.id ?? null, signedBy: ctx.userId })
          .returning({ id: prescriptions.id });
        await tx.insert(prescriptionLines).values(checked.value.lines.map((l, i) => ({ orgId: ctx.orgId, prescriptionId: rx!.id, sortOrder: i, ...l })));
        if (replaces) await tx.update(prescriptions).set({ status: 'replaced' }).where(eq(prescriptions.id, replaces.id));
        if ((patient.allergies ?? null) !== allergies.value) {
          await tx.update(patients).set({ allergies: allergies.value }).where(eq(patients.id, patient.id));
          await writeAudit(tx, ctx, { action: 'patient.allergies', entityType: 'patient', entityId: patient.id, branchId, before: { allergies: patient.allergies }, after: { allergies: allergies.value } });
        }
        await writeAudit(tx, ctx, { action: replaces ? 'prescription.correct' : 'prescription.sign', entityType: 'prescription', entityId: rx!.id, branchId, after: { doctorId: doctor.id, lines: checked.value.lines.length, replacesId: replaces?.id ?? null } });
        return { ok: true as const, id: rx!.id };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'prescriptions_branch_number_unique')) continue;
      if (isUniqueViolation(err, 'prescriptions_replaces_unique')) throw new UserFacingError('That prescription was already corrected. Correct the newest one.');
      throw err;
    }
  }
  throw new UserFacingError('Busy. Press again.');
}

export interface PrescriptionDetail {
  id: string;
  ref: string;
  branchId: string;
  branchName: string;
  patientId: string;
  patientName: string;
  patientAge: number | null;
  patientSex: string | null;
  doctorName: string;
  doctorQualification: string | null;
  doctorRegistration: string | null;
  doctorCouncil: string | null;
  issuedOn: string;
  complaint: string | null;
  advice: string | null;
  allergies: string | null;
  status: 'signed' | 'replaced';
  replacesId: string | null;
  replacedById: string | null;
  lines: { name: string; strength: string | null; form: string | null; dose: string | null; frequency: string | null; days: number | null; instructions: string | null }[];
}

/** One prescription, for the screen and the printout. Reading it is audited. */
export async function getPrescription(ctx: TenantContext, id: string): Promise<PrescriptionDetail | null> {
  if (!isUuid(id)) return null;
  const db = getDb();
  const [r] = await db
    .select({ rx: prescriptions, branchName: branches.name, branchCode: branches.code, patientName: patients.fullName, age: patients.approximateAge, sex: patients.sex, d: providers })
    .from(prescriptions)
    .innerJoin(branches, eq(branches.id, prescriptions.branchId))
    .innerJoin(patients, eq(patients.id, prescriptions.patientId))
    .innerJoin(providers, eq(providers.id, prescriptions.doctorId))
    .where(and(eq(prescriptions.id, id), eq(prescriptions.orgId, ctx.orgId)))
    .limit(1);
  if (!r || !ctx.branchIds.includes(r.rx.branchId) || !canDo(ctx, 'patient.view', r.rx.branchId)) return null;
  const lines = await db.select().from(prescriptionLines).where(eq(prescriptionLines.prescriptionId, id)).orderBy(asc(prescriptionLines.sortOrder));
  const [newer] = await db.select({ id: prescriptions.id }).from(prescriptions).where(eq(prescriptions.replacesId, id)).limit(1);
  await writeAudit(db, ctx, { action: 'prescription.view', entityType: 'prescription', entityId: id, branchId: r.rx.branchId });
  return {
    id: r.rx.id,
    ref: rxRef(r.branchCode, r.rx.rxNumber),
    branchId: r.rx.branchId,
    branchName: r.branchName,
    patientId: r.rx.patientId,
    patientName: r.patientName,
    patientAge: r.age,
    patientSex: r.sex,
    doctorName: r.d.fullName,
    doctorQualification: r.d.qualification,
    doctorRegistration: r.d.registrationNumber,
    doctorCouncil: r.d.registrationCouncil,
    issuedOn: r.rx.issuedOn,
    complaint: r.rx.complaint,
    advice: r.rx.advice,
    allergies: r.rx.allergies,
    status: r.rx.status as 'signed' | 'replaced',
    replacesId: r.rx.replacesId,
    replacedById: newer?.id ?? null,
    lines: lines.map((l) => ({ name: l.name, strength: l.strength, form: l.form, dose: l.dose, frequency: l.frequency, days: l.days, instructions: l.instructions })),
  };
}

/** A patient's prescriptions, newest first (summary only, so not audited as a read of each). */
export async function listPrescriptions(ctx: TenantContext, patientId: string) {
  if (!isUuid(patientId)) return [];
  const rows = await getDb()
    .select({ id: prescriptions.id, n: prescriptions.rxNumber, code: branches.code, issuedOn: prescriptions.issuedOn, status: prescriptions.status, doctor: providers.fullName, count: sql<number>`(select count(*)::int from prescription_lines pl where pl.prescription_id = prescriptions.id)` })
    .from(prescriptions)
    .innerJoin(branches, eq(branches.id, prescriptions.branchId))
    .innerJoin(providers, eq(providers.id, prescriptions.doctorId))
    .where(and(eq(prescriptions.orgId, ctx.orgId), eq(prescriptions.patientId, patientId), inArray(prescriptions.branchId, ctx.branchIds)))
    .orderBy(desc(prescriptions.signedAt))
    .limit(20);
  return rows.map((r) => ({ id: r.id, ref: rxRef(r.code, r.n), issuedOn: r.issuedOn, status: r.status as 'signed' | 'replaced', doctor: r.doctor, count: r.count }));
}

export async function patientAllergies(ctx: TenantContext, patientId: string): Promise<string | null> {
  if (!isUuid(patientId)) return null;
  const [p] = await getDb().select({ a: patients.allergies }).from(patients).where(and(eq(patients.id, patientId), eq(patients.orgId, ctx.orgId))).limit(1);
  return p?.a ?? null;
}
