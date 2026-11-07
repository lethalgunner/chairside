/**
 * Treatment plans and estimates (Sprint 4, LET-168/169). Pure rules.
 *
 * A plan lists work for several sittings at an agreed price. Ticking an item
 * "done" records it as work done (the existing procedure, at the agreed
 * price); billing then goes through the normal bill. The estimate is a
 * printout, not a tax document, and never takes a bill number.
 */
import { parseRupeesInput, type Paise } from './money';
import type { Checked, FieldErrors } from './staff';
import { computeInvoice, type LineInput, type TaxCategory } from './tax';

export type PlanStatus = 'draft' | 'accepted' | 'completed' | 'cancelled';
export type PlanItemStatus = 'planned' | 'done' | 'dropped';
/** What the patient page and the plan show for an item: done work is billed or not. */
export type ItemStage = 'planned' | 'done_unbilled' | 'billed' | 'dropped';

export const PLAN_LABEL: Record<PlanStatus, string> = { draft: 'Draft', accepted: 'Accepted', completed: 'Completed', cancelled: 'Cancelled' };
export const STAGE_LABEL: Record<ItemStage, string> = { planned: 'To do', done_unbilled: 'Done, not billed', billed: 'Billed', dropped: 'Dropped' };

export interface PlanItemInput {
  catalogueItemId: string;
  toothNumber: string;
  quantity: number;
  /** Rupees as typed. Empty means the price-list price. */
  price: string;
  priceReason: string;
  session: number;
}

export interface PlanItemValues {
  catalogueItemId: string;
  toothNumber: string | null;
  quantity: number;
  unitPricePaise: Paise;
  priceReason: string | null;
  session: number;
}

/**
 * Check one plan line against the price-list price. A different price needs a
 * reason (like a discount on a bill), so the owner can see why an estimate
 * moved. Tooth numbers are FDI digits, e.g. "36" or "11, 21".
 */
export function checkPlanItem(input: PlanItemInput, listPricePaise: Paise): Checked<PlanItemValues> {
  const fieldErrors: FieldErrors = {};
  const tooth = input.toothNumber.trim().replace(/\s+/g, ' ');
  if (tooth && !/^\d{2}(\s*,\s*\d{2})*$/.test(tooth)) fieldErrors.toothNumber = 'Tooth numbers are two digits, like 36 or 11, 21.';
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) fieldErrors.quantity = 'Quantity is a whole number from 1 to 99.';
  if (!Number.isInteger(input.session) || input.session < 1 || input.session > 30) fieldErrors.session = 'Sitting is a number from 1 to 30.';
  let price: Paise = listPricePaise;
  if (input.price.trim()) {
    const r = parseRupeesInput(input.price, 'the price');
    if (!r.ok) fieldErrors.price = r.error;
    else price = r.paise;
  }
  const reason = input.priceReason.trim().replace(/\s+/g, ' ');
  if (price !== listPricePaise && reason.length < 3) fieldErrors.priceReason = 'Say why the price differs from the price list.';
  if (reason.length > 120) fieldErrors.priceReason = 'Keep the reason under 120 characters.';
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { catalogueItemId: input.catalogueItemId, toothNumber: tooth || null, quantity: input.quantity, unitPricePaise: price, priceReason: price !== listPricePaise ? reason : null, session: input.session } };
}

export function checkPlanTitle(title: string): Checked<string> {
  const t = title.trim().replace(/\s+/g, ' ');
  if (t.length < 3 || t.length > 80) return { ok: false, fieldErrors: { title: 'Give the plan a short name, like “Upper right RCT and crown” (3 to 80 characters).' } };
  return { ok: true, value: t };
}

/** Estimate reference, e.g. EST/PUN/0007. Not a tax document number. */
export function estimateRef(branchCode: string, n: number): string {
  return `EST/${branchCode}/${String(n).padStart(4, '0')}`;
}

export interface StagedItem {
  stage: ItemStage;
  quantity: number;
  unitPricePaise: Paise;
  description: string;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  gstRateBp: number;
}

/**
 * Estimate totals with GST worked out the way a bill would, plus how much of
 * the plan is done, billed and still to do (agreed prices, before GST).
 * Dropped items count nowhere.
 */
export function planTotals(items: StagedItem[], seller: { gstRegistered: boolean; gstin: string | null; state: string | null }) {
  const live = items.filter((i) => i.stage !== 'dropped');
  const value = (s: ItemStage[]) => live.filter((i) => s.includes(i.stage)).reduce((sum, i) => sum + i.unitPricePaise * i.quantity, 0) as Paise;
  const lines: LineInput[] = live.map((i) => ({ description: i.description, quantity: i.quantity, unitPricePaise: i.unitPricePaise, taxCategory: i.taxCategory, hsnSacCode: i.hsnSacCode, gstRateBp: i.gstRateBp }));
  const estimate = lines.length > 0 ? computeInvoice(lines, { gstRegistered: seller.gstRegistered, gstin: seller.gstin, placeOfSupplyState: seller.state }, seller.state) : null;
  return {
    estimateTotalPaise: (estimate?.totalPaise ?? 0) as Paise,
    estimateTaxPaise: (estimate ? estimate.cgstPaise + estimate.sgstPaise + estimate.igstPaise : 0) as Paise,
    todoPaise: value(['planned']),
    doneUnbilledPaise: value(['done_unbilled']),
    billedPaise: value(['billed']),
    doneCount: live.filter((i) => i.stage !== 'planned').length,
    count: live.length,
  };
}

/** Plan status moves. Completed can reopen to accepted (more work turned up). */
export function canMovePlan(from: PlanStatus, to: PlanStatus): boolean {
  const moves: Record<PlanStatus, PlanStatus[]> = { draft: ['accepted', 'cancelled'], accepted: ['completed', 'cancelled'], completed: ['accepted'], cancelled: [] };
  return moves[from].includes(to);
}
