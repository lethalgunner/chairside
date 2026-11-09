import { and, count, eq, isNotNull, or } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { branches, catalogueItems, invoices, memberships, organisations, patients, providerBranches, providers, users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import type { SignupValues } from '@/domain/signup';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { insertBranch } from './branches';
import { canOrgWide } from '@/domain/permissions';
import { type TenantContext } from './context';
import { ensureProvider } from './providers';
import { isUniqueViolation } from './util';

export type SignupResult = { ok: true; orgId: string; userId: string } | { ok: false; fieldErrors: FieldErrors };

/**
 * A new clinic signs itself up (Sprint 7): the clinic, its first branch, the
 * owner's login and, for a dentist-owner, their doctor profile, in one
 * transaction. It starts with the parallel run off: it isn't running
 * alongside our pilot's old software. Bills still use the test series while
 * CHAIRSIDE_TEST_SERIES is on (the CA gate is deployment-wide).
 */
export async function signUpClinic(v: SignupValues): Promise<SignupResult> {
  const passwordHash = await hashPassword(v.password);
  try {
    return await getDb().transaction(async (tx) => {
      const [org] = await tx.insert(organisations).values({ name: v.clinicName, parallelRun: false }).returning({ id: organisations.id });
      const orgId = org!.id;
      const branchId = await insertBranch(tx, orgId, v.branchCode, { ok: true, value: v.branch });
      const [u] = await tx.insert(users).values({ orgId, fullName: v.fullName, email: v.email, passwordHash }).returning({ id: users.id });
      const userId = u!.id;
      await tx.insert(memberships).values({ orgId, userId, branchId: null, role: 'owner' });
      if (v.isDentist) await ensureProvider(tx, orgId, userId, null, 'owner_partner');
      await writeAudit(tx, { orgId, userId }, { action: 'org.signup', entityType: 'organisation', entityId: orgId, branchId, after: { clinicName: v.clinicName, branchCode: v.branchCode, isDentist: v.isDentist } });
      return { ok: true as const, orgId, userId };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_unique')) return { ok: false, fieldErrors: { email: 'An account with this email already exists. Sign in instead.' } };
    throw err;
  }
}

export interface SetupStep {
  key: 'prices' | 'doctors' | 'header' | 'team' | 'patient' | 'bill';
  done: boolean;
}

/**
 * The getting-started checklist (Sprint 7), worked out from what exists, so
 * nothing is stored and a clinic set up by hand counts as done too.
 */
export async function setupProgress(ctx: TenantContext): Promise<SetupStep[]> {
  const db = getDb();
  const one = async (q: Promise<{ n: number }[]>) => ((await q)[0]?.n ?? 0) > 0;
  const [prices, doctors, header, team, patient, bill] = await Promise.all([
    one(db.select({ n: count() }).from(catalogueItems).where(and(eq(catalogueItems.orgId, ctx.orgId), eq(catalogueItems.active, true)))),
    one(db.select({ n: count() }).from(providers).innerJoin(providerBranches, eq(providerBranches.providerId, providers.id)).where(and(eq(providers.orgId, ctx.orgId), eq(providers.active, true)))),
    one(db.select({ n: count() }).from(branches).where(and(eq(branches.orgId, ctx.orgId), or(isNotNull(branches.printName), isNotNull(branches.printLogo), isNotNull(branches.upiId))))),
    one(db.select({ n: count() }).from(users).where(and(eq(users.orgId, ctx.orgId), eq(users.active, true))).then((r) => [{ n: (r[0]?.n ?? 0) - 1 }])),
    one(db.select({ n: count() }).from(patients).where(eq(patients.orgId, ctx.orgId))),
    one(db.select({ n: count() }).from(invoices).where(eq(invoices.orgId, ctx.orgId))),
  ]);
  return [
    { key: 'prices', done: prices },
    { key: 'doctors', done: doctors },
    { key: 'header', done: header },
    { key: 'team', done: team },
    { key: 'patient', done: patient },
    { key: 'bill', done: bill },
  ];
}

/** Steps a clinic can't run without; the optional ones never trigger the dashboard nudge. */
export const REQUIRED_STEPS: readonly SetupStep['key'][] = ['prices', 'doctors', 'patient', 'bill'];

/** Only the owner sees the checklist; it hides itself once every step is done. */
export function showsSetup(ctx: TenantContext): boolean {
  return canOrgWide(ctx.grants, 'staff.manage');
}
