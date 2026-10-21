import { describe, expect, it } from 'vitest';
import { parseQuantity } from './input';
import { parseRupeesInput } from './money';
import { phoneSearchDigits } from './phone';
import { computeInvoice } from './tax';
import type { Paise } from './money';

describe('amounts as staff type them (T22, Q16)', () => {
  it.each([
    ['500', 50_000],
    ['500/-', 50_000],
    ['500 /-', 50_000],
    ['Rs 500', 50_000],
    ['Rs. 500', 50_000],
    ['rs.500', 50_000],
    ['₹500', 50_000],
    ['₹ 1,500', 150_000],
    ['1,500', 150_000],
    ['1,500.50/-', 150_050],
    ['INR 2000', 200_000],
    ['0', 0],
  ])('%s → %i paise', (input, paise) => expect(parseRupeesInput(input)).toEqual({ ok: true, paise }));

  it.each(['', '  ', 'abc', '1500.555', '-500', '5OO', '500/', '$500', '1e3'])('refuses %j with a message', (input) => {
    const r = parseRupeesInput(input, 'the amount');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Enter the amount in rupees, like 500, 1,500 or 1500.50.');
  });
});

describe('quantity (T22, Q11)', () => {
  it('keeps what was typed and accepts 1 to 99 only', () => {
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity('12')).toBe(12);
    expect(parseQuantity(' 3 ')).toBe(3);
    for (const bad of ['', '0', '00', '100', '1.5', '-1', 'two']) expect(parseQuantity(bad), bad).toBeNull();
  });
});

describe('phone search (T22, Q14)', () => {
  it.each([
    ['+91 94575 11208', '9457511208'],
    ['09457511208', '9457511208'],
    ['91-9457511208', '9457511208'],
    ['94575 11208', '9457511208'],
    ['11208', '11208'],
    ['512', '512'],
  ])('%s → %s', (q, digits) => expect(phoneSearchDigits(q)).toBe(digits));
  it('needs at least 3 digits', () => {
    expect(phoneSearchDigits('Asha')).toBeNull();
    expect(phoneSearchDigits('12')).toBeNull();
  });
});

describe('no paise in front of staff (T22, Q17)', () => {
  it('a discount larger than the price is explained in rupees with the item name', () => {
    expect(() =>
      computeInvoice(
        [{ description: 'Consultation', quantity: 1, unitPricePaise: 50_000 as Paise, discountPaise: 60_000 as Paise, taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 }],
        { gstRegistered: false },
        'Uttar Pradesh',
      ),
    ).toThrow('Discount on Consultation is more than its price (₹500).');
  });
});
