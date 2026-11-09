import { describe, expect, it } from 'vitest';
import { CAPPABLE_ROLES, checkDiscountCaps, effectiveCapBp, maxDiscountPaise, overCap } from './discounts';
import type { Paise } from './money';

const P = (n: number) => n as Paise;
const pune = 'b-pune';
const kanpur = 'b-kanpur';

describe('CAPPABLE_ROLES', () => {
  it('every role that bills except the owner', () => {
    expect([...CAPPABLE_ROLES].sort()).toEqual(['associate_doctor', 'branch_manager', 'doctor', 'front_desk']);
  });
});

describe('effectiveCapBp', () => {
  it('no limits set means no limit (today’s behaviour)', () => {
    expect(effectiveCapBp([{ role: 'front_desk', branchId: pune }], pune, {})).toBeNull();
  });
  it('the owner is never capped, even with a desk grant too', () => {
    expect(effectiveCapBp([{ role: 'owner', branchId: null }, { role: 'front_desk', branchId: pune }], pune, { front_desk: 500 })).toBeNull();
  });
  it('a capped role uses its cap; the most generous of several wins; an uncapped role lifts it', () => {
    expect(effectiveCapBp([{ role: 'front_desk', branchId: pune }], pune, { front_desk: 1000 })).toBe(1000);
    expect(effectiveCapBp([{ role: 'front_desk', branchId: pune }, { role: 'branch_manager', branchId: pune }], pune, { front_desk: 1000, branch_manager: 2500 })).toBe(2500);
    expect(effectiveCapBp([{ role: 'front_desk', branchId: pune }, { role: 'doctor', branchId: pune }], pune, { front_desk: 1000 })).toBeNull();
  });
  it('only grants at this branch (or org-wide) count', () => {
    expect(effectiveCapBp([{ role: 'front_desk', branchId: pune }, { role: 'doctor', branchId: kanpur }], pune, { front_desk: 0 })).toBe(0);
    expect(effectiveCapBp([{ role: 'doctor', branchId: null }], pune, { doctor: 1500 })).toBe(1500);
  });
});

describe('maxDiscountPaise and overCap', () => {
  it('rounds down to the paisa: 10% of ₹333.33 is ₹33.33', () => {
    expect(maxDiscountPaise(P(33_333), 1000)).toBe(3_333);
  });
  it('10% of a ₹4,500 line: ₹450 passes, ₹450.01 does not', () => {
    const line = (d: number) => [{ description: 'Root canal', grossPaise: P(450_000), discountPaise: P(d) }];
    expect(overCap(line(45_000), 1000)).toBeNull();
    expect(overCap(line(45_001), 1000)).toMatch(/Root canal: your limit is 10% \(₹450\.00 here\)/);
  });
  it('0% refuses any discount; no limit allows all; lines without a discount are ignored', () => {
    expect(overCap([{ description: 'Scaling', grossPaise: P(150_000), discountPaise: P(1) }], 0)).toMatch(/can't give discounts/);
    expect(overCap([{ description: 'Scaling', grossPaise: P(150_000), discountPaise: P(150_000) }], null)).toBeNull();
    expect(overCap([{ description: 'Scaling', grossPaise: P(150_000), discountPaise: P(0) }], 0)).toBeNull();
  });
});

describe('checkDiscountCaps', () => {
  it('blank = no limit; whole percents become basis points; "10%" is fine', () => {
    expect(checkDiscountCaps({ front_desk: '10%', branch_manager: '', doctor: '0' })).toEqual({ ok: true, value: { front_desk: 1000, doctor: 0 } });
  });
  it('over 100, decimals and words are refused per role; unknown roles ignored', () => {
    const r = checkDiscountCaps({ front_desk: '101', doctor: '7.5', associate_doctor: 'ten', owner: '5' });
    expect(r.ok ? [] : Object.keys(r.fieldErrors).sort()).toEqual(['associate_doctor', 'doctor', 'front_desk']);
  });
});
