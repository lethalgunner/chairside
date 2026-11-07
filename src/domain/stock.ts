/**
 * Stock-lite rules (Sprint 6, LET-176). Pure. Whole units only. Expiry is a
 * hint: without batch tracking we flag stock that "may expire" when anything
 * received recently enough to still be on the shelf expires soon.
 */
import { addDays } from './dates';
import { parseRupeesInput, type Paise } from './money';
import type { Checked, FieldErrors } from './staff';

export const STOCK_KINDS = ['medicine', 'supply'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export const STOCK_KIND_LABEL: Record<StockKind, string> = { medicine: 'Medicines', supply: 'Clinic supplies' };
export const UNITS = ['piece', 'strip', 'box', 'bottle', 'tube', 'pack', 'vial', 'ml', 'g'] as const;
export const EXPIRY_WARN_DAYS = 60;

export type ManualMovement = 'received' | 'used' | 'adjusted';

export interface StockItemInput {
  kind: string;
  name: string;
  unit: string;
  reorderLevel: string;
}

export function checkStockItem(input: StockItemInput): Checked<{ kind: StockKind; name: string; unit: string; reorderLevel: number }> {
  const fieldErrors: FieldErrors = {};
  const kind = STOCK_KINDS.find((k) => k === input.kind);
  if (!kind) fieldErrors.kind = 'Pick medicine or clinic supply.';
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) fieldErrors.name = 'Enter the item name (2 to 80 characters).';
  const unit = (UNITS as readonly string[]).includes(input.unit) ? input.unit : '';
  if (!unit) fieldErrors.unit = 'Pick a unit.';
  const r = input.reorderLevel.trim() || '0';
  if (!/^\d{1,5}$/.test(r)) fieldErrors.reorderLevel = 'Reorder level is a whole number, 0 for none.';
  if (Object.keys(fieldErrors).length > 0 || !kind) return { ok: false, fieldErrors };
  return { ok: true, value: { kind, name, unit, reorderLevel: Number(r) } };
}

export interface MovementInput {
  kind: string;
  /** Always typed as a positive number; "used" makes it negative; "adjusted" takes a sign from `direction`. */
  quantity: string;
  direction: 'in' | 'out';
  expiresOn: string;
  unitCost: string;
  reason: string;
}

export interface MovementValues {
  kind: ManualMovement;
  quantity: number;
  expiresOn: string | null;
  unitCostPaise: Paise | null;
  reason: string | null;
}

/** Received needs nothing more; used and adjusted need a reason; expiry is today or later. */
export function checkMovement(input: MovementInput, today: string): Checked<MovementValues> {
  const fieldErrors: FieldErrors = {};
  const kind = (['received', 'used', 'adjusted'] as const).find((k) => k === input.kind);
  if (!kind) fieldErrors.kind = 'Pick received, used or adjust.';
  const q = input.quantity.trim();
  if (!/^\d{1,5}$/.test(q) || Number(q) < 1) fieldErrors.quantity = 'Enter how many, a whole number from 1.';
  let expiresOn: string | null = null;
  if (input.expiresOn.trim()) {
    const e = input.expiresOn.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e) || Number.isNaN(Date.parse(`${e}T00:00:00Z`))) fieldErrors.expiresOn = 'Pick the expiry date.';
    else if (e < today) fieldErrors.expiresOn = 'That date has passed: this stock has expired.';
    else expiresOn = e;
  }
  let unitCostPaise: Paise | null = null;
  if (input.unitCost.trim()) {
    const c = parseRupeesInput(input.unitCost, 'the cost');
    if (!c.ok) fieldErrors.unitCost = c.error;
    else unitCostPaise = c.paise;
  }
  const reason = input.reason.trim().replace(/\s+/g, ' ');
  if (kind && kind !== 'received' && reason.length < 3) fieldErrors.reason = kind === 'used' ? 'Say what it was used for (at least 3 characters).' : 'Say why (at least 3 characters), e.g. counted 4 short.';
  if (reason.length > 120) fieldErrors.reason = 'Keep the reason under 120 characters.';
  if (Object.keys(fieldErrors).length > 0 || !kind) return { ok: false, fieldErrors };
  const n = Number(q);
  const quantity = kind === 'received' ? n : kind === 'used' ? -n : input.direction === 'in' ? n : -n;
  return { ok: true, value: { kind, quantity, expiresOn: kind === 'received' ? expiresOn : null, unitCostPaise: kind === 'received' ? unitCostPaise : null, reason: reason || null } };
}

/**
 * Received lots that may still be on the shelf: newest first, the received
 * quantities that add up to what is on hand (first in, first out). The
 * earliest expiry among them is the one to warn about.
 */
export function mayExpireOn(onHand: number, received: { quantity: number; expiresOn: string | null; at: Date }[]): string | null {
  if (onHand <= 0) return null;
  let left = onHand;
  let earliest: string | null = null;
  for (const r of [...received].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    if (left <= 0) break;
    if (r.expiresOn && (!earliest || r.expiresOn < earliest)) earliest = r.expiresOn;
    left -= r.quantity;
  }
  return earliest;
}

export function stockFlags(onHand: number, reorderLevel: number, expiry: string | null, today: string): { low: boolean; expiring: boolean; expired: boolean } {
  return {
    low: reorderLevel > 0 ? onHand <= reorderLevel : onHand <= 0,
    expired: !!expiry && expiry < today,
    expiring: !!expiry && expiry >= today && expiry <= addDays(today, EXPIRY_WARN_DAYS),
  };
}
