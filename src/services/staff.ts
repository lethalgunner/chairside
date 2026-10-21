/**
 * Staff accounts (Pilot 0 slice 2, T14). The owner invites, re-invites,
 * deactivates and reactivates people from /settings/team; scripts/add-user.ts
 * uses upsertStaffGrant for the command-line path. Invite links stay as in
 * ADR-012: single use, 72 hours, only a SHA-256 stored. The raw token is
 * returned to the caller once and never logged or written anywhere.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { branches, memberships, users } from '@/db/schema';
import { canOrgWide, type Role } from '@/domain/permissions';
import {
  checkStaffGrant,
  deactivationBlocker,
  inviteStatus,
  type FieldErrors,
  type InviteStatus,
  type StaffGrant,
  type StaffGrantInput,
} from '@/domain/staff';
import { cancelInvites, createInvite, latestInvites } from '@/lib/auth/invite';
import { revokeUserSessions } from '@/lib/auth/session';
import { writeAudit } from './audit';
import { ForbiddenError, UserFacingError, type TenantContext } from './context';
import { isUniqueViolation, isUuid } from './util';

function assertStaffManager(ctx: TenantContext): void {
  if (!canOrgWide(ctx.grants, 'staff.manage')) throw new ForbiddenError();
}

export interface StaffMember {
  id: string;
  fullName: string;
  email: string | null;
  active: boolean;
  isSelf: boolean;
  grants: { role: Role; branchName: string | null }[];
  status: InviteStatus;
  inviteExpiresAt: Date | null;
}

export async function listStaff(ctx: TenantContext): Promise<StaffMember[]> {
  assertStaffManager(ctx);
  const db = getDb();
  const people = await db.select().from(users).where(eq(users.orgId, ctx.orgId)).orderBy(asc(users.fullName));
  const grantRows = await db
    .select({ userId: memberships.userId, role: memberships.role, branchName: branches.name })
    .from(memberships)
    .leftJoin(branches, eq(branches.id, memberships.branchId))
    .where(eq(memberships.orgId, ctx.orgId))
    .orderBy(asc(memberships.role));
  const invites = await latestInvites(
    ctx.orgId,
    people.map((p) => p.id),
  );
  const now = new Date();
  return people.map((p) => {
    const invite = invites.get(p.id) ?? null;
    const status = inviteStatus({ hasPassword: !!p.passwordHash, hasEmail: !!p.email, latestInvite: invite, now });
    return {
      id: p.id,
      fullName: p.fullName,
      email: p.email,
      active: p.active,
      isSelf: p.id === ctx.userId,
      grants: grantRows.filter((g) => g.userId === p.id).map((g) => ({ role: g.role as Role, branchName: g.branchName })),
      status,
      inviteExpiresAt: status === 'pending' ? invite!.expiresAt : null,
    };
  });
}

/**
 * Create or reuse the person and add the role grant. Same rules everywhere:
 * email lower-cased, an email held by another org is refused, a returning
 * person is reactivated. No permission check here: the caller has done it
 * (the owner in the app, a database admin on the command line).
 */
export async function upsertStaffGrant(
  db: DB | Tx,
  orgId: string,
  actorId: string | null,
  grant: StaffGrant,
  opts: { passwordHash?: string } = {},
): Promise<{ userId: string; created: boolean; hasPassword: boolean }> {
  if (grant.branchId) {
    const [b] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, grant.branchId), eq(branches.orgId, orgId))).limit(1);
    if (!b) throw new UserFacingError('That branch is not part of this clinic.');
  }

  const [byEmail] = await db.select().from(users).where(eq(users.email, grant.email)).limit(1);
  if (byEmail && byEmail.orgId !== orgId) throw new UserFacingError('That email is already used by another organisation.');

  let user: typeof users.$inferSelect | undefined;
  if (grant.linkUserId) {
    if (!isUuid(grant.linkUserId)) throw new UserFacingError('That person is not part of this clinic.');
    [user] = await db.select().from(users).where(and(eq(users.id, grant.linkUserId), eq(users.orgId, orgId))).limit(1);
    if (!user) throw new UserFacingError('That person is not part of this clinic.');
    if (byEmail && byEmail.id !== user.id) throw new UserFacingError('That email already belongs to someone else in this clinic.');
  } else {
    user = byEmail;
  }

  let created = false;
  const before = user ? { active: user.active, hadEmail: !!user.email } : null;
  if (user) {
    [user] = await db
      .update(users)
      .set({
        email: grant.email,
        active: true,
        ...(grant.fullName ? { fullName: grant.fullName } : {}),
        ...(opts.passwordHash ? { passwordHash: opts.passwordHash } : {}),
      })
      .where(eq(users.id, user.id))
      .returning();
  } else {
    if (!grant.fullName) throw new UserFacingError('Enter their name.');
    [user] = await db.insert(users).values({ orgId, fullName: grant.fullName, email: grant.email, passwordHash: opts.passwordHash ?? null }).returning();
    created = true;
  }
  const userId = user!.id;

  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, grant.role), grant.branchId ? eq(memberships.branchId, grant.branchId) : isNull(memberships.branchId)))
    .limit(1);
  if (!existing) await db.insert(memberships).values({ orgId, userId, branchId: grant.branchId, role: grant.role });

  await writeAudit(db, { orgId, userId: actorId }, {
    action: created ? 'staff.create' : 'staff.grant',
    entityType: 'user',
    entityId: userId,
    branchId: grant.branchId,
    before,
    after: { role: grant.role, branchId: grant.branchId, active: true, roleAdded: !existing, passwordSet: !!opts.passwordHash },
  });
  return { userId, created, hasPassword: !!user!.passwordHash };
}

export type InviteStaffResult =
  | { ok: true; userId: string; fullName: string; token: string | null; expiresAt: Date | null }
  | { ok: false; fieldErrors: FieldErrors };

/**
 * Invite from the app: grant the role and, unless the person already has a
 * password, issue a fresh link. An existing login is never reset this way.
 */
export async function inviteStaff(ctx: TenantContext, input: StaffGrantInput): Promise<InviteStaffResult> {
  assertStaffManager(ctx);
  const checked = checkStaffGrant(input);
  if (!checked.ok) return checked;
  try {
    return await getDb().transaction(async (tx) => {
      const r = await upsertStaffGrant(tx, ctx.orgId, ctx.userId, checked.value);
      const [u] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, r.userId));
      if (r.hasPassword) return { ok: true as const, userId: r.userId, fullName: u!.fullName, token: null, expiresAt: null };
      const { token, expiresAt } = await createInvite(tx, { orgId: ctx.orgId, userId: r.userId });
      await writeAudit(tx, ctx, { action: 'staff.invite', entityType: 'user', entityId: r.userId, after: { expiresAt } });
      return { ok: true as const, userId: r.userId, fullName: u!.fullName, token, expiresAt };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserFacingError('Someone just added that email. Refresh the page and check the list.');
    throw err;
  }
}

async function orgUser(db: DB | Tx, ctx: TenantContext, userId: string, lock = false) {
  if (!isUuid(userId)) throw new ForbiddenError();
  const q = db.select().from(users).where(and(eq(users.id, userId), eq(users.orgId, ctx.orgId))).limit(1);
  const [u] = lock ? await q.for('update') : await q;
  if (!u) throw new ForbiddenError();
  return u;
}

/** A new link for someone who has not set a password yet. Cancels the old one. */
export async function reissueInvite(ctx: TenantContext, userId: string): Promise<{ token: string; expiresAt: Date; fullName: string }> {
  assertStaffManager(ctx);
  return getDb().transaction(async (tx) => {
    const u = await orgUser(tx, ctx, userId, true);
    if (!u.active) throw new UserFacingError('Reactivate them before sending a new link.');
    if (!u.email) throw new UserFacingError('Add an email for them first, using Invite.');
    if (u.passwordHash) throw new UserFacingError('They have already set a password and can sign in.');
    const { token, expiresAt } = await createInvite(tx, { orgId: ctx.orgId, userId: u.id });
    await writeAudit(tx, ctx, { action: 'staff.invite_reissued', entityType: 'user', entityId: u.id, after: { expiresAt } });
    return { token, expiresAt, fullName: u.fullName };
  });
}

/**
 * Deactivate or reactivate. Deactivating signs the person out everywhere and
 * cancels any unused link. Owner rows are locked first so two owners cannot
 * deactivate each other at the same moment and leave the clinic with none.
 */
export async function setStaffActive(ctx: TenantContext, userId: string, active: boolean): Promise<void> {
  assertStaffManager(ctx);
  await getDb().transaction(async (tx) => {
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(users.orgId, ctx.orgId), eq(users.active, true), eq(memberships.role, 'owner')))
      .for('update', { of: users });
    const target = await orgUser(tx, ctx, userId, true);
    if (target.active === active) return;
    if (!active) {
      const [ownerGrant] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, target.id), eq(memberships.role, 'owner')))
        .limit(1);
      const others = new Set(owners.map((o) => o.id).filter((id) => id !== target.id));
      const blocker = deactivationBlocker({ actorId: ctx.userId, targetId: target.id, targetIsOwner: !!ownerGrant, otherActiveOwners: others.size });
      if (blocker) throw new UserFacingError(blocker);
    }
    await tx.update(users).set({ active }).where(and(eq(users.id, target.id), eq(users.orgId, ctx.orgId)));
    if (!active) {
      await revokeUserSessions(tx, target.id);
      await cancelInvites(tx, target.id);
    }
    await writeAudit(tx, ctx, {
      action: active ? 'staff.reactivate' : 'staff.deactivate',
      entityType: 'user',
      entityId: target.id,
      before: { active: target.active },
      after: { active },
    });
  });
}

/** People recorded without a login (doctors from the seed), who can be given one. */
export async function listWithoutLogin(ctx: TenantContext): Promise<{ id: string; fullName: string }[]> {
  assertStaffManager(ctx);
  return getDb()
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(and(eq(users.orgId, ctx.orgId), isNull(users.email), eq(users.active, true)))
    .orderBy(asc(users.fullName));
}

/** Branch choices for the invite form. */
export async function staffBranchOptions(ctx: TenantContext): Promise<{ id: string; name: string }[]> {
  assertStaffManager(ctx);
  return getDb()
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, ctx.branchIds)))
    .orderBy(asc(branches.name));
}
