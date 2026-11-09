import { formatINR, type Paise } from './money';
import { ROLE_CAPABILITIES, ROLE_LABELS, type Grant, type Role } from './permissions';
import type { FieldErrors } from './staff';

/**
 * Discount limits per role (Sprint 8, Argon idea, KS self-serve ask). The
 * owner sets "up to N% of a line" for each role that bills. No limit set is
 * the default and means exactly what happens today. The owner is never
 * capped. Plan prices agreed with the patient are prices, not discounts, so
 * they are not capped here.
 */

/** Roles that can bill, other than the owner: the ones a limit makes sense for. */
export const CAPPABLE_ROLES: readonly Role[] = (Object.keys(ROLE_CAPABILITIES) as Role[]).filter((r) => r !== 'owner' && ROLE_CAPABILITIES[r].includes('invoice.issue'));

export type DiscountCaps = Partial<Record<Role, number>>;

/**
 * The most generous limit this person has at a branch, in basis points, or
 * null for no limit. Owner, or any role there without a limit, means none.
 */
export function effectiveCapBp(grants: readonly Grant[], branchId: string, caps: DiscountCaps): number | null {
  const here = grants.filter((g) => g.branchId === null || g.branchId === branchId).map((g) => g.role);
  if (here.length === 0) return 0;
  let best = -1;
  for (const role of here) {
    if (role === 'owner') return null;
    const cap = caps[role];
    if (cap === undefined) return null;
    best = Math.max(best, cap);
  }
  return best;
}

/** The biggest discount allowed on a line worth `grossPaise` (rounded down to the paisa). */
export function maxDiscountPaise(grossPaise: Paise, capBp: number): Paise {
  return Math.floor((grossPaise * capBp) / 10_000) as Paise;
}

/** A message for the first line over the limit, or null when every line is within it. */
export function overCap(lines: readonly { description: string; grossPaise: Paise; discountPaise: Paise }[], capBp: number | null): string | null {
  if (capBp === null) return null;
  for (const l of lines) {
    if (l.discountPaise <= 0) continue;
    const max = maxDiscountPaise(l.grossPaise, capBp);
    if (l.discountPaise > max) {
      return capBp === 0
        ? `${l.description}: you can't give discounts. Ask the owner to give it, or to change your limit in Settings → Clinic.`
        : `${l.description}: your limit is ${percentWords(capBp)} (${formatINR(max)} here). Ask the owner for more.`;
    }
  }
  return null;
}

export function percentWords(bp: number): string {
  return `${bp / 100}%`;
}

/** Settings form: '' = no limit, else a whole percent 0–100. */
export function checkDiscountCaps(raw: Record<string, string>): { ok: true; value: DiscountCaps } | { ok: false; fieldErrors: FieldErrors } {
  const value: DiscountCaps = {};
  const errors: FieldErrors = {};
  for (const role of CAPPABLE_ROLES) {
    const v = (raw[role] ?? '').trim().replace(/%$/, '');
    if (v === '') continue;
    if (!/^\d{1,3}$/.test(v) || Number(v) > 100) {
      errors[role] = `${ROLE_LABELS[role]}: a whole number from 0 to 100, or blank for no limit.`;
      continue;
    }
    value[role] = Number(v) * 100;
  }
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : { ok: true, value };
}
