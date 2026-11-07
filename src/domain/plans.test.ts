import { describe, expect, it } from 'vitest';
import type { Paise } from './money';
import { canMovePlan, checkPlanItem, checkPlanTitle, estimateRef, planTotals, type StagedItem } from './plans';

const p = (n: number) => n as Paise;

describe('treatment plan rules (LET-168)', () => {
  const base = { catalogueItemId: 'x', toothNumber: ' 36 ', quantity: 1, price: '', priceReason: '', session: 1 };
  it('takes the list price by default and needs a reason for any other price', () => {
    const r = checkPlanItem(base, p(450_000));
    expect(r.ok && r.value).toMatchObject({ unitPricePaise: 450_000, priceReason: null, toothNumber: '36' });
    const noReason = checkPlanItem({ ...base, price: '4,000' }, p(450_000));
    expect(!noReason.ok && noReason.fieldErrors.priceReason).toBeTruthy();
    const ok = checkPlanItem({ ...base, price: '4,000', priceReason: 'Family discount agreed by Dr Vij' }, p(450_000));
    expect(ok.ok && ok.value).toMatchObject({ unitPricePaise: 400_000, priceReason: 'Family discount agreed by Dr Vij' });
    // Typing the list price itself needs no reason.
    expect(checkPlanItem({ ...base, price: '4500' }, p(450_000)).ok).toBe(true);
  });
  it('checks teeth, quantity and sitting', () => {
    const r = checkPlanItem({ ...base, toothNumber: '3a', quantity: 0, session: 31, price: 'abc' }, p(100));
    expect(!r.ok && Object.keys(r.fieldErrors).sort()).toEqual(['price', 'quantity', 'session', 'toothNumber']);
    expect(checkPlanItem({ ...base, toothNumber: '11, 21,22' }, p(100)).ok).toBe(true);
  });
  it('names and numbers', () => {
    expect(checkPlanTitle('  RCT  36 ').ok).toBe(true);
    expect(checkPlanTitle('x').ok).toBe(false);
    expect(estimateRef('PUN', 7)).toBe('EST/PUN/0007');
  });
  it('totals the estimate with GST and splits done, billed and to do', () => {
    const items: StagedItem[] = [
      { stage: 'billed', quantity: 1, unitPricePaise: p(450_000), description: 'RCT', taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 },
      { stage: 'done_unbilled', quantity: 1, unitPricePaise: p(100_000), description: 'Core build-up', taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 },
      { stage: 'planned', quantity: 1, unitPricePaise: p(600_000), description: 'Crown', taxCategory: 'goods_prosthetic', hsnSacCode: '9021', gstRateBp: 500 },
      { stage: 'dropped', quantity: 1, unitPricePaise: p(999_900), description: 'Implant', taxCategory: 'goods_prosthetic', hsnSacCode: '9021', gstRateBp: 500 },
    ];
    const t = planTotals(items, { gstRegistered: true, gstin: '27AAAAA0000A1Z5', state: 'Maharashtra' });
    expect(t).toMatchObject({ estimateTaxPaise: 30_000, estimateTotalPaise: 1_180_000, todoPaise: 600_000, doneUnbilledPaise: 100_000, billedPaise: 450_000, doneCount: 2, count: 3 });
    expect(planTotals(items, { gstRegistered: false, gstin: null, state: 'Uttar Pradesh' }).estimateTotalPaise).toBe(1_150_000);
    expect(planTotals([], { gstRegistered: false, gstin: null, state: null }).estimateTotalPaise).toBe(0);
  });
  it('moves plan status', () => {
    expect(canMovePlan('draft', 'accepted')).toBe(true);
    expect(canMovePlan('completed', 'accepted')).toBe(true);
    expect(canMovePlan('cancelled', 'accepted')).toBe(false);
  });
});
