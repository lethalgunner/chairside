import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Tx } from '@/db/client';
import { branches, patientRegistrations, patients } from '@/db/schema';
import { ageNow, businessDate } from '@/domain/dates';
import { normaliseIndianMobile, phoneSearchDigits } from '@/domain/phone';
import { assertCan, canAnywhere, ForbiddenError, requireActiveBranch, type TenantContext } from './context';
import { writeAudit } from './audit';
import { recordRegistrationTime } from './usage';
import { isUuid } from './util';

export interface PatientSummary {
  id: string;
  fullName: string;
  phone: string;
  sex: string | null;
  age: number | null;
  fileNumbers: string[];
  referralSource: string | null;
}

export const REFERRAL_SOURCES = [
  'Walk-in',
  'Patient referral',
  'Doctor referral',
  'Google',
  'Instagram',
  'Practo / JustDial',
  'Signboard',
  'Other',
] as const;

export const registerPatientInput = z.object({
  fullName: z.string().trim().min(2, 'Enter the patient’s name.').max(120),
  phone: z.string().trim(),
  sex: z.enum(['F', 'M', 'O'], { message: 'Pick one.' }),
  age: z.coerce
    .number({ message: 'Enter an age between 0 and 120.' })
    .int('Age is a whole number.')
    .min(0, 'Enter an age between 0 and 120.')
    .max(120, 'Enter an age between 0 and 120.'),
  referralSource: z.string().trim().max(60).default('Walk-in'),
  referralDetail: z.string().trim().max(120).optional(),
  acknowledgedDuplicate: z.boolean().default(false),
});
export type RegisterPatientInput = z.input<typeof registerPatientInput>;

export type RegisterResult =
  | { ok: true; patientId: string }
  | { ok: false; fieldErrors?: Record<string, string>; duplicates?: PatientSummary[] };

async function summaries(orgId: string, where: ReturnType<typeof and>, limit: number): Promise<PatientSummary[]> {
  const today = businessDate();
  const rows = await getDb()
    .select({
      p: patients,
      files: sql<string[]>`coalesce(array_agg(${patientRegistrations.fileNumber}) filter (where ${patientRegistrations.fileNumber} is not null), '{}')`,
    })
    .from(patients)
    .leftJoin(patientRegistrations, eq(patientRegistrations.patientId, patients.id))
    .where(and(eq(patients.orgId, orgId), sql`${patients.mergedIntoId} is null`, where))
    .groupBy(patients.id)
    .orderBy(desc(patients.createdAt))
    .limit(limit);
  return rows.map(({ p, files }) => ({
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    sex: p.sex,
    age: ageNow(p.approximateAge, p.ageRecordedOn, today),
    fileNumbers: files,
    referralSource: p.referralSource,
  }));
}

/** Same phone, or same name ignoring case and spacing. Families share phones, so this warns, never blocks. */
export async function findPossibleDuplicates(
  ctx: TenantContext,
  phone10: string,
  fullName: string,
): Promise<PatientSummary[]> {
  const name = fullName.trim().replace(/\s+/g, ' ').toLowerCase();
  return summaries(
    ctx.orgId,
    or(
      eq(patients.phone, phone10),
      sql`lower(regexp_replace(trim(${patients.fullName}), '\\s+', ' ', 'g')) = ${name}`,
    ),
    10,
  );
}

/**
 * `formMs`: how long the New patient form was open before this successful
 * save, measured in the browser (T26). Optional, untrusted, clamped; it only
 * feeds the usage log and never affects the registration itself.
 */
export async function registerPatient(ctx: TenantContext, raw: RegisterPatientInput & { formMs?: unknown }): Promise<RegisterResult> {
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, 'patient.register', branchId);

  const parsed = registerPatientInput.safeParse(raw);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  }
  const phone10 = normaliseIndianMobile(String(raw.phone ?? ''));
  if (!phone10) fieldErrors.phone = 'Enter a 10-digit Indian mobile number.';
  if (!parsed.success || !phone10) return { ok: false, fieldErrors };
  const input = parsed.data;

  if (!input.acknowledgedDuplicate) {
    const duplicates = await findPossibleDuplicates(ctx, phone10, input.fullName);
    if (duplicates.length > 0) return { ok: false, duplicates };
  }

  const today = businessDate();
  const patientId = await getDb().transaction(async (tx) => {
    // Lock the branch row so concurrent registrations get distinct file numbers.
    const [branch] = await tx
      .select({ id: branches.id, code: branches.code })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)))
      .for('update');
    if (!branch) throw new ForbiddenError();

    const [p] = await tx
      .insert(patients)
      .values({
        orgId: ctx.orgId,
        fullName: input.fullName.replace(/\s+/g, ' '),
        phone: phone10,
        sex: input.sex,
        approximateAge: input.age,
        ageRecordedOn: today,
        referralSource: input.referralSource,
        referralDetail: input.referralDetail || null,
      })
      .returning({ id: patients.id });
    await registerAtBranch(tx, ctx.orgId, branch, p!.id);
    await writeAudit(tx, ctx, {
      action: 'patient.register',
      entityType: 'patient',
      entityId: p!.id,
      branchId,
      after: { referralSource: input.referralSource },
    });
    return p!.id;
  });
  // Outside the transaction: a usage-log failure must never undo a registration.
  await recordRegistrationTime(ctx, branchId, raw.formMs);
  return { ok: true, patientId };
}

/** Give a patient a file number at a branch (first visit there). Caller holds the branch row lock. */
export async function registerAtBranch(
  tx: Tx,
  orgId: string,
  branch: { id: string; code: string },
  patientId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ fileNumber: patientRegistrations.fileNumber })
    .from(patientRegistrations)
    .where(and(eq(patientRegistrations.branchId, branch.id), eq(patientRegistrations.patientId, patientId)))
    .limit(1);
  if (existing) return existing.fileNumber;
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(patientRegistrations)
    .where(eq(patientRegistrations.branchId, branch.id));
  const fileNumber = `${branch.code}-${String((count?.n ?? 0) + 1).padStart(4, '0')}`;
  await tx.insert(patientRegistrations).values({ orgId, branchId: branch.id, patientId, fileNumber });
  return fileNumber;
}

/** Search by phone digits (any part), name or file number. Empty query → most recent patients. */
export async function searchPatients(ctx: TenantContext, query: string, limit = 20): Promise<PatientSummary[]> {
  if (!canAnywhere(ctx, 'patient.view')) throw new ForbiddenError();
  const q = query.trim();
  if (!q) return summaries(ctx.orgId, undefined, limit);
  const digits = phoneSearchDigits(q);
  const conds = [
    ilike(patients.fullName, `%${q.replace(/[%_]/g, '')}%`),
    sql`exists (select 1 from patient_registrations r where r.patient_id = ${patients.id} and r.file_number ilike ${`%${q.replace(/[%_]/g, '')}%`})`,
  ];
  if (digits) conds.push(sql`${patients.phone} like ${`%${digits}%`}`);
  return summaries(ctx.orgId, or(...conds), limit);
}

export async function getPatient(ctx: TenantContext, patientId: string): Promise<PatientSummary | null> {
  if (!canAnywhere(ctx, 'patient.view')) throw new ForbiddenError();
  if (!isUuid(patientId)) return null;
  const [p] = await summaries(ctx.orgId, eq(patients.id, patientId), 1);
  return p ?? null;
}
