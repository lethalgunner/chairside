/**
 * Rules for staff accounts (Pilot 0 slice 2, T14). Pure, so the invite form,
 * the service and scripts/add-user.ts all apply the same ones.
 */
import { ROLES, type Role } from './permissions';

export type FieldErrors = Record<string, string>;
export type Checked<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export interface StaffGrantInput {
  /** Required for a new person; ignored when linking an existing record (e.g. a doctor with no login). */
  fullName: string;
  email: string;
  role: string;
  /** Null means every branch; only the owner role may be org-wide. */
  branchId: string | null;
  linkUserId?: string | null;
}

export interface StaffGrant {
  fullName: string | null;
  email: string;
  role: Role;
  branchId: string | null;
  linkUserId: string | null;
}

/**
 * Validate an invite. Owner grants are org-wide only; every other role needs
 * one branch, so nobody gets more reach than the owner chose to give.
 * `orgWideAllowed` keeps the command line's documented org-wide grants (an
 * accountant across all branches); the app's invite form does not offer them.
 */
export function checkStaffGrant(input: StaffGrantInput, opts: { orgWideAllowed?: boolean } = {}): Checked<StaffGrant> {
  const fieldErrors: FieldErrors = {};
  const linkUserId = input.linkUserId || null;
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  if (!linkUserId && (fullName.length < 2 || fullName.length > 80)) fieldErrors.fullName = 'Enter their name (2 to 80 characters).';
  const email = normaliseEmail(input.email);
  if (!isPlausibleEmail(email)) fieldErrors.email = 'Enter an email address, like name@example.com.';
  const role = ROLES.find((r) => r === input.role);
  if (!role) fieldErrors.role = 'Pick a role.';
  const branchId = input.branchId || null;
  if (role === 'owner' && branchId) fieldErrors.branchId = 'The owner sees every branch. Leave the branch empty.';
  if (role && role !== 'owner' && !branchId && !opts.orgWideAllowed) fieldErrors.branchId = 'Pick the branch they work at.';
  if (Object.keys(fieldErrors).length > 0 || !role) return { ok: false, fieldErrors };
  return { ok: true, value: { fullName: linkUserId ? null : fullName, email, role, branchId, linkUserId } };
}

export type InviteStatus = 'set_up' | 'pending' | 'expired' | 'no_login';

/** Where someone is with their login, for the team list. */
export function inviteStatus(p: {
  hasPassword: boolean;
  hasEmail: boolean;
  latestInvite: { expiresAt: Date; usedAt: Date | null } | null;
  now: Date;
}): InviteStatus {
  if (p.hasPassword) return 'set_up';
  if (!p.hasEmail) return 'no_login';
  if (!p.latestInvite) return 'expired';
  if (!p.latestInvite.usedAt && p.latestInvite.expiresAt.getTime() > p.now.getTime()) return 'pending';
  return 'expired';
}

/**
 * Guards on deactivation: nobody locks themself out, and the clinic always
 * keeps at least one active owner who can undo a mistake.
 */
export function deactivationBlocker(p: {
  actorId: string;
  targetId: string;
  targetIsOwner: boolean;
  otherActiveOwners: number;
}): string | null {
  if (p.actorId === p.targetId) return 'You can’t deactivate yourself.';
  if (p.targetIsOwner && p.otherActiveOwners === 0) return 'This is the last active owner. Add another owner first.';
  return null;
}
