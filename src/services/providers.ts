import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { branches, memberships, providerBranches, providers, users } from '@/db/schema';
import { checkHours, checkProvider, type EngagementType, type HoursInput, type ProviderInput } from '@/domain/providers';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { canAnywhere, ForbiddenError, type TenantContext } from './context';
import { isUuid } from './util';

/**
 * Doctor profiles (Sprint 4, LET-166, ADR-008). A provider is the clinician
 * on bills, appointments and plans; a user is a login. Every clinical and
 * money doctor_id points here.
 */

export interface ProviderOption {
  id: string;
  fullName: string;
  slotMinutes: number;
  colour: string | null;
}

export interface BranchHours {
  branchId: string;
  branchName: string;
  days: number[];
  startTime: string;
  endTime: string;
}

export interface ProviderRow {
  id: string;
  userId: string | null;
  loginName: string | null;
  fullName: string;
  qualification: string | null;
  registrationNumber: string | null;
  registrationCouncil: string | null;
  specialty: string | null;
  engagementType: EngagementType;
  colour: string | null;
  slotMinutes: number;
  active: boolean;
  hasCalendarLink: boolean;
  hours: BranchHours[];
}

/** Active doctors who work at this branch, for the bill, appointments and plans. */
export async function listProviders(ctx: TenantContext, branchId: string, db: DB | Tx = getDb()): Promise<ProviderOption[]> {
  if (!ctx.branchIds.includes(branchId)) return [];
  return db
    .selectDistinct({ id: providers.id, fullName: providers.fullName, slotMinutes: providers.slotMinutes, colour: providers.colour })
    .from(providers)
    .innerJoin(providerBranches, eq(providerBranches.providerId, providers.id))
    .where(and(eq(providers.orgId, ctx.orgId), eq(providers.active, true), eq(providerBranches.branchId, branchId)))
    .orderBy(asc(providers.fullName));
}

/** The provider row if it is active, in this org and works at this branch; else null. */
export async function providerAtBranch(db: DB | Tx, ctx: TenantContext, providerId: string, branchId: string) {
  if (!isUuid(providerId)) return null;
  const [row] = await db
    .select({ id: providers.id, fullName: providers.fullName, slotMinutes: providers.slotMinutes, userId: providers.userId, registrationNumber: providers.registrationNumber, qualification: providers.qualification, registrationCouncil: providers.registrationCouncil })
    .from(providers)
    .innerJoin(providerBranches, eq(providerBranches.providerId, providers.id))
    .where(and(eq(providers.id, providerId), eq(providers.orgId, ctx.orgId), eq(providers.active, true), eq(providerBranches.branchId, branchId)))
    .limit(1);
  return row ?? null;
}

/** The signed-in user's own doctor profile, if they have one. */
export async function myProvider(ctx: TenantContext, db: DB | Tx = getDb()) {
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.userId, ctx.userId), eq(providers.orgId, ctx.orgId), eq(providers.active, true)))
    .limit(1);
  return row ?? null;
}

/**
 * ADR-008 invariant: a doctor grant needs a linked provider. Called whenever a
 * doctor role is granted (invite, command line, seed). Creates the provider if
 * missing and adds the branch (or every branch for an org-wide grant).
 */
export async function ensureProvider(
  db: DB | Tx,
  orgId: string,
  userId: string,
  branchId: string | null,
  engagementType: EngagementType = 'salaried',
): Promise<string> {
  let [p] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.userId, userId), eq(providers.orgId, orgId))).limit(1);
  if (!p) {
    const [u] = await db.select({ fullName: users.fullName, registrationNumber: users.registrationNumber }).from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId)));
    if (!u) throw new ForbiddenError();
    [p] = await db.insert(providers).values({ orgId, userId, fullName: u.fullName, registrationNumber: u.registrationNumber, engagementType }).returning({ id: providers.id });
  }
  const targets = branchId
    ? [branchId]
    : (await db.select({ id: branches.id }).from(branches).where(eq(branches.orgId, orgId))).map((b) => b.id);
  for (const b of targets) {
    await db.insert(providerBranches).values({ orgId, providerId: p!.id, branchId: b }).onConflictDoNothing();
  }
  return p!.id;
}

/**
 * "I also see patients" (QA 9 Nov): an owner who is a dentist gets a doctor
 * profile linked to their own login at every branch, so they appear in the
 * doctor lists and can sign prescriptions (owners already hold rx.write).
 * Idempotent; a deactivated profile comes back. Owner only (provider.manage).
 */
export async function addMeAsDoctor(ctx: TenantContext): Promise<{ providerId: string }> {
  if (!canAnywhere(ctx, 'provider.manage')) throw new ForbiddenError();
  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select({ id: providers.id, active: providers.active }).from(providers).where(and(eq(providers.userId, ctx.userId), eq(providers.orgId, ctx.orgId))).for('update');
    if (existing && !existing.active) await tx.update(providers).set({ active: true }).where(and(eq(providers.id, existing.id), eq(providers.orgId, ctx.orgId)));
    const providerId = await ensureProvider(tx, ctx.orgId, ctx.userId, null, 'owner_partner');
    await writeAudit(tx, ctx, { action: 'provider.self_add', entityType: 'provider', entityId: providerId, after: { userId: ctx.userId, reactivated: !!existing && !existing.active, created: !existing } });
    return { providerId };
  });
}

function assertManager(ctx: TenantContext) {
  if (!canAnywhere(ctx, 'provider.manage')) throw new ForbiddenError();
}

/** Settings → Doctors: every provider with their hours per branch. */
export async function listProvidersForSettings(ctx: TenantContext): Promise<ProviderRow[]> {
  assertManager(ctx);
  const db = getDb();
  const rows = await db
    .select({ p: providers, loginName: users.fullName })
    .from(providers)
    .leftJoin(users, eq(users.id, providers.userId))
    .where(eq(providers.orgId, ctx.orgId))
    .orderBy(asc(providers.fullName));
  if (rows.length === 0) return [];
  const hours = await db
    .select({ providerId: providerBranches.providerId, branchId: providerBranches.branchId, branchName: branches.name, days: providerBranches.days, startTime: providerBranches.startTime, endTime: providerBranches.endTime })
    .from(providerBranches)
    .innerJoin(branches, eq(branches.id, providerBranches.branchId))
    .where(and(eq(providerBranches.orgId, ctx.orgId), inArray(providerBranches.providerId, rows.map((r) => r.p.id))))
    .orderBy(asc(branches.name));
  return rows.map(({ p, loginName }) => ({
    id: p.id,
    userId: p.userId,
    loginName,
    fullName: p.fullName,
    qualification: p.qualification,
    registrationNumber: p.registrationNumber,
    registrationCouncil: p.registrationCouncil,
    specialty: p.specialty,
    engagementType: p.engagementType as EngagementType,
    colour: p.colour,
    slotMinutes: p.slotMinutes,
    active: p.active,
    hasCalendarLink: !!p.calendarTokenHash,
    hours: hours.filter((h) => h.providerId === p.id).map(({ providerId: _p, ...h }) => h),
  }));
}

export type SaveProviderResult = { ok: true; id: string } | { ok: false; fieldErrors: FieldErrors };

async function lockProvider(tx: Tx, ctx: TenantContext, id: string) {
  if (!isUuid(id)) throw new ForbiddenError();
  const [p] = await tx.select().from(providers).where(and(eq(providers.id, id), eq(providers.orgId, ctx.orgId))).for('update');
  if (!p) throw new ForbiddenError();
  return p;
}

/** Create (id null) a doctor without a login, e.g. a visiting specialist, or edit a profile. */
export async function saveProvider(ctx: TenantContext, id: string | null, input: ProviderInput): Promise<SaveProviderResult> {
  assertManager(ctx);
  const checked = checkProvider(input);
  if (!checked.ok) return checked;
  return getDb().transaction(async (tx) => {
    if (id === null) {
      const [row] = await tx.insert(providers).values({ orgId: ctx.orgId, ...checked.value }).returning({ id: providers.id });
      await writeAudit(tx, ctx, { action: 'provider.create', entityType: 'provider', entityId: row!.id, after: checked.value });
      return { ok: true as const, id: row!.id };
    }
    const before = await lockProvider(tx, ctx, id);
    await tx.update(providers).set(checked.value).where(and(eq(providers.id, before.id), eq(providers.orgId, ctx.orgId)));
    const { calendarTokenHash: _t, ...safeBefore } = before;
    await writeAudit(tx, ctx, { action: 'provider.update', entityType: 'provider', entityId: before.id, before: safeBefore, after: checked.value });
    return { ok: true as const, id: before.id };
  });
}

/** Set where and when a doctor works at one branch; `null` hours removes them from that branch. */
export async function setProviderHours(ctx: TenantContext, providerId: string, branchId: string, hours: HoursInput | null): Promise<{ ok: true } | { ok: false; fieldErrors: FieldErrors }> {
  assertManager(ctx);
  if (!isUuid(branchId) || !ctx.branchIds.includes(branchId)) throw new ForbiddenError();
  const checked = hours ? checkHours(hours) : null;
  if (checked && !checked.ok) return checked;
  return getDb().transaction(async (tx) => {
    const p = await lockProvider(tx, ctx, providerId);
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)));
    if (!branch) throw new ForbiddenError();
    if (checked) {
      await tx
        .insert(providerBranches)
        .values({ orgId: ctx.orgId, providerId: p.id, branchId, ...checked.value })
        .onConflictDoUpdate({ target: [providerBranches.providerId, providerBranches.branchId], set: checked.value });
    } else {
      await tx.delete(providerBranches).where(and(eq(providerBranches.providerId, p.id), eq(providerBranches.branchId, branchId), eq(providerBranches.orgId, ctx.orgId)));
    }
    await writeAudit(tx, ctx, { action: checked ? 'provider.hours' : 'provider.branch_removed', entityType: 'provider', entityId: p.id, branchId, after: checked ? checked.value : null });
    return { ok: true as const };
  });
}

/** Stop offering a doctor on new bills, appointments and plans. Old records keep them. */
export async function setProviderActive(ctx: TenantContext, providerId: string, active: boolean): Promise<void> {
  assertManager(ctx);
  await getDb().transaction(async (tx) => {
    const p = await lockProvider(tx, ctx, providerId);
    if (p.active === active) return;
    await tx.update(providers).set({ active }).where(and(eq(providers.id, p.id), eq(providers.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, { action: active ? 'provider.reactivate' : 'provider.deactivate', entityType: 'provider', entityId: p.id });
  });
}

/** For the ADR-008 invariant check in tests and the Team page: doctor grants with no provider. */
export async function doctorsWithoutProvider(orgId: string, db: DB | Tx = getDb()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .leftJoin(providers, eq(providers.userId, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.role, ['doctor', 'associate_doctor']), isNull(providers.id)));
  return rows.map((r) => r.userId);
}

// ---------------------------------------------------------------------------
// Private calendar link (Sprint 4, LET-170). The token is shown once to the
// owner and stored only as a SHA-256 hash; a new link replaces the old one.
// ---------------------------------------------------------------------------

export function hashCalendarToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueCalendarToken(ctx: TenantContext, providerId: string): Promise<string> {
  assertManager(ctx);
  const token = randomBytes(32).toString('base64url');
  await getDb().transaction(async (tx) => {
    const p = await lockProvider(tx, ctx, providerId);
    await tx.update(providers).set({ calendarTokenHash: hashCalendarToken(token) }).where(and(eq(providers.id, p.id), eq(providers.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, { action: p.calendarTokenHash ? 'provider.calendar_link_replaced' : 'provider.calendar_link_created', entityType: 'provider', entityId: p.id });
  });
  return token;
}

export async function revokeCalendarToken(ctx: TenantContext, providerId: string): Promise<void> {
  assertManager(ctx);
  await getDb().transaction(async (tx) => {
    const p = await lockProvider(tx, ctx, providerId);
    if (!p.calendarTokenHash) return;
    await tx.update(providers).set({ calendarTokenHash: null }).where(and(eq(providers.id, p.id), eq(providers.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, { action: 'provider.calendar_link_revoked', entityType: 'provider', entityId: p.id });
  });
}
