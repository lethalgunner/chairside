import { describe, it, expect } from 'vitest';
import {
  paise,
  rupees,
  fromRupeeString,
  percent,
  basisPoints,
  add,
  subtract,
  multiply,
  applyRate,
  roundToRupee,
  allocate,
  splitEvenly,
  toRupeeString,
  formatINR,
  MoneyError,
  ZERO,
} from './money';

describe('construction', () => {
  it('rejects floats, because that is the entire point', () => {
    expect(() => paise(10.5)).toThrow(MoneyError);
    expect(() => rupees(99.99)).toThrow(MoneyError);
  });

  it('parses rupee strings exactly', () => {
    expect(fromRupeeString('1234.56')).toBe(123456);
    expect(fromRupeeString('1234')).toBe(123400);
    expect(fromRupeeString('0.05')).toBe(5);
    expect(fromRupeeString('0.5')).toBe(50);
    expect(fromRupeeString('-99.05')).toBe(-9905);
  });

  it('tolerates the ways humans actually type money', () => {
    expect(fromRupeeString(' ₹1,234.56 ')).toBe(123456);
    expect(fromRupeeString('12,34,567.89')).toBe(123456789);
  });

  it('rejects more than two decimal places rather than silently truncating', () => {
    expect(() => fromRupeeString('10.555')).toThrow(MoneyError);
    expect(() => fromRupeeString('abc')).toThrow(MoneyError);
    expect(() => fromRupeeString('')).toThrow(MoneyError);
  });

  it('survives the classic float trap', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004. In paise it is simply 30.
    const sum = add(fromRupeeString('0.1'), fromRupeeString('0.2'));
    expect(sum).toBe(30);
    expect(toRupeeString(sum)).toBe('0.30');
  });
});

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(add(rupees(100), rupees(250))).toBe(35000);
    expect(subtract(rupees(100), rupees(250))).toBe(-15000);
    expect(add()).toBe(0);
  });

  it('multiplies by whole quantities only', () => {
    expect(multiply(fromRupeeString('149.50'), 3)).toBe(44850);
    expect(() => multiply(rupees(100), 1.5)).toThrow(MoneyError);
  });

  it('handles amounts large enough to break naive integer maths', () => {
    const large = paise(900_00_00_00_000); // ₹900 crore
    expect(multiply(large, 1)).toBe(900_00_00_00_000);
    expect(applyRate(large, percent(18))).toBe(162_00_00_00_000);
  });
});

describe('applyRate', () => {
  it('computes GST at the rates dentistry actually uses', () => {
    // 12% on an implant fixture priced at ₹18,000
    expect(applyRate(rupees(18000), percent(12))).toBe(216000);
    // 18% on retail oral-care sold at reception
    expect(applyRate(fromRupeeString('450.00'), percent(18))).toBe(8100);
    // 0% on exempt treatment
    expect(applyRate(rupees(5000), percent(0))).toBe(0);
  });

  it('rounds a half paisa away from zero, the way a human checking it would', () => {
    // ₹100.05 at 5% = 500.25 paise -> 500
    expect(applyRate(fromRupeeString('100.05'), percent(5))).toBe(500);
    // ₹0.11 at 5% = 0.55 paise -> 1
    expect(applyRate(fromRupeeString('0.11'), percent(5))).toBe(1);
    expect(applyRate(fromRupeeString('-0.11'), percent(5))).toBe(-1);
  });

  it('honours explicit floor and ceil, toward infinity not toward zero', () => {
    // floor and ceil here mean what Math.floor and Math.ceil mean: they move
    // toward -Infinity and +Infinity, NOT toward or away from zero. So a
    // negative half-paisa floors to -1, not to 0. Anything relying on
    // truncation-toward-zero should say so explicitly rather than assume.
    expect(applyRate(fromRupeeString('0.11'), percent(5), 'floor')).toBe(0);
    expect(applyRate(fromRupeeString('0.11'), percent(5), 'ceil')).toBe(1);
    expect(applyRate(fromRupeeString('-0.11'), percent(5), 'floor')).toBe(-1);
    expect(applyRate(fromRupeeString('-0.11'), percent(5), 'ceil')).toBe(0);
  });

  it('accepts fractional percents via basis points', () => {
    // 2.36% — a payment gateway fee inclusive of GST on the fee
    expect(applyRate(rupees(10000), basisPoints(236))).toBe(23600);
  });
});

describe('roundToRupee', () => {
  it('rounds to whole rupees for the invoice rounding-off line', () => {
    expect(roundToRupee(fromRupeeString('1234.49'))).toBe(123400);
    expect(roundToRupee(fromRupeeString('1234.50'))).toBe(123500);
    expect(roundToRupee(fromRupeeString('1234.99'))).toBe(123500);
    expect(roundToRupee(fromRupeeString('-1234.50'))).toBe(-123500);
  });
});

describe('allocate', () => {
  it('never creates or destroys a paisa', () => {
    const amount = fromRupeeString('1000.00');
    const parts = allocate(amount, [1, 1, 1]);
    expect(add(...parts)).toBe(amount);
    expect(parts).toEqual([33334, 33333, 33333]);
  });

  it('spreads a receipt across invoices in proportion to what is owed', () => {
    // ₹5,000 received against invoices of ₹3,000 and ₹7,000
    const received = rupees(5000);
    const parts = allocate(received, [3000, 7000]);
    expect(add(...parts)).toBe(received);
    expect(parts).toEqual([150000, 350000]);
  });

  it('holds the guarantee across many awkward amounts', () => {
    for (let amt = 1; amt <= 2000; amt += 7) {
      for (let n = 2; n <= 7; n += 1) {
        const parts = splitEvenly(paise(amt), n);
        expect(add(...parts)).toBe(amt);
        expect(parts).toHaveLength(n);
      }
    }
  });

  it('handles negatives, because refunds get split too', () => {
    const refund = fromRupeeString('-100.00');
    const parts = allocate(refund, [1, 1, 1]);
    expect(add(...parts)).toBe(refund);
    expect(parts.every((p) => p <= 0)).toBe(true);
  });

  it('puts everything in the first slot when all weights are zero', () => {
    const parts = allocate(rupees(100), [0, 0, 0]);
    expect(parts).toEqual([10000, 0, 0]);
    expect(add(...parts)).toBe(10000);
  });

  it('rejects nonsense', () => {
    expect(() => allocate(rupees(100), [])).toThrow(MoneyError);
    expect(() => allocate(rupees(100), [1, -1])).toThrow(MoneyError);
    expect(() => splitEvenly(rupees(100), 0)).toThrow(MoneyError);
  });

  it('allocates zero without incident', () => {
    expect(allocate(ZERO, [1, 2, 3])).toEqual([0, 0, 0]);
  });
});

describe('display', () => {
  it('groups digits the Indian way', () => {
    expect(formatINR(fromRupeeString('1234567.89'))).toBe('₹12,34,567.89');
    expect(formatINR(fromRupeeString('123456.78'))).toBe('₹1,23,456.78');
    expect(formatINR(fromRupeeString('1234.56'))).toBe('₹1,234.56');
    expect(formatINR(fromRupeeString('123.45'))).toBe('₹123.45');
    expect(formatINR(fromRupeeString('12345678.00'))).toBe('₹1,23,45,678.00');
  });

  it('handles negatives and the display options', () => {
    expect(formatINR(fromRupeeString('-1234.56'))).toBe('-₹1,234.56');
    expect(formatINR(fromRupeeString('1234.56'), { symbol: false })).toBe('1,234.56');
    expect(formatINR(fromRupeeString('1234.00'), { paise: false })).toBe('₹1,234');
    expect(formatINR(ZERO)).toBe('₹0.00');
  });

  it('round-trips through the plain string form', () => {
    for (const s of ['0.00', '0.01', '99.99', '1234.56', '-1234.56']) {
      expect(toRupeeString(fromRupeeString(s))).toBe(s);
    }
  });
});
