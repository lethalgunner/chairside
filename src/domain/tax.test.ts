import { describe, it, expect } from 'vitest';
import { computeInvoice, lineFromCategory, summariseByHsn, itcEligibleBp, TaxError } from './tax';
import { fromRupeeString, rupees, add, formatINR, ZERO } from './money';

const REGISTERED = { gstRegistered: true, gstin: '27AAAAA0000A1Z5', placeOfSupplyState: 'Maharashtra' };
const UNREGISTERED = { gstRegistered: false, placeOfSupplyState: 'Maharashtra' };
const MH = 'Maharashtra';

describe('the mixed invoice — the case incumbent software gets wrong', () => {
  it('carries exempt treatment and taxable goods on one document', () => {
    const inv = computeInvoice(
      [
        lineFromCategory('Root canal treatment, 26', rupees(6000), 'exempt_healthcare'),
        lineFromCategory('Zirconia crown, 26', rupees(12000), 'goods_prosthetic'),
        lineFromCategory('Interdental brush pack', fromRupeeString('250.00'), 'goods_retail'),
      ],
      REGISTERED,
      MH,
    );

    // The RCT carries no tax at all.
    expect(inv.lines[0]?.gstRateBp).toBe(0);
    expect(inv.lines[0]?.cgstPaise).toBe(0);
    expect(inv.lines[0]?.isExempt).toBe(true);

    // The crown carries 12%, split evenly into CGST and SGST.
    expect(inv.lines[1]?.gstRateBp).toBe(1200);
    expect(inv.lines[1]?.cgstPaise).toBe(72000); // ₹720
    expect(inv.lines[1]?.sgstPaise).toBe(72000);
    expect(inv.lines[1]?.lineTotalPaise).toBe(1344000); // ₹13,440

    // The brush carries 18%.
    expect(inv.lines[2]?.gstRateBp).toBe(1800);
    expect(add(inv.lines[2]!.cgstPaise, inv.lines[2]!.sgstPaise)).toBe(4500); // ₹45

    // And the document splits the two kinds of value correctly.
    expect(inv.exemptPaise).toBe(600000); // ₹6,000 of exempt treatment
    expect(inv.taxablePaise).toBe(1225000); // ₹12,250 of taxable goods
    expect(inv.cgstPaise).toBe(74250);
    expect(inv.sgstPaise).toBe(74250);
    expect(inv.igstPaise).toBe(0);
    expect(inv.totalPaise).toBe(1973500); // ₹19,735
    expect(formatINR(inv.totalPaise)).toBe('₹19,735.00');
  });

  it('always has CGST and SGST summing exactly to the tax charged', () => {
    // An odd amount at 18% gives a tax with an odd paise count, which is where
    // computing each half independently would drift.
    const inv = computeInvoice(
      [lineFromCategory('Whitening', fromRupeeString('999.99'), 'cosmetic_service')],
      REGISTERED,
      MH,
    );
    const line = inv.lines[0]!;
    const totalTax = add(line.cgstPaise, line.sgstPaise);
    expect(totalTax).toBe(18000); // 18% of 99999 paise = 17999.82 -> 18000
    expect(line.cgstPaise).toBe(9000);
    expect(line.sgstPaise).toBe(9000);
  });

  it('never loses a paisa on an odd tax split', () => {
    const inv = computeInvoice(
      [lineFromCategory('Odd item', fromRupeeString('100.03'), 'goods_retail')],
      REGISTERED,
      MH,
    );
    const line = inv.lines[0]!;
    // 18% of 10003 paise = 1800.54 -> 1801, which does not halve evenly.
    expect(add(line.cgstPaise, line.sgstPaise)).toBe(1801);
    expect(line.cgstPaise).toBe(901);
    expect(line.sgstPaise).toBe(900);
  });
});

describe('branch registration', () => {
  it('charges nothing at an unregistered branch, whatever the catalogue says', () => {
    const lines = [
      lineFromCategory('RCT', rupees(6000), 'exempt_healthcare'),
      lineFromCategory('Crown', rupees(12000), 'goods_prosthetic'),
    ];
    const inv = computeInvoice(lines, UNREGISTERED, MH);

    expect(inv.cgstPaise).toBe(0);
    expect(inv.sgstPaise).toBe(0);
    expect(inv.taxablePaise).toBe(0);
    expect(inv.exemptPaise).toBe(1800000);
    expect(inv.totalPaise).toBe(1800000); // ₹18,000 flat — an 18% edge over a registered rival
    expect(inv.lines.every((l) => l.isExempt)).toBe(true);
  });

  it('charges IGST instead when the supply crosses a state line', () => {
    const inv = computeInvoice(
      [lineFromCategory('Crown', rupees(12000), 'goods_prosthetic')],
      { gstRegistered: true, placeOfSupplyState: 'Gujarat' },
      MH,
    );
    expect(inv.igstPaise).toBe(144000); // ₹1,440 at 12%
    expect(inv.cgstPaise).toBe(0);
    expect(inv.sgstPaise).toBe(0);
    expect(inv.totalPaise).toBe(1344000);
  });
});

describe('discounts', () => {
  it('applies discount before tax, not after', () => {
    const inv = computeInvoice(
      [
        {
          ...lineFromCategory('Crown', rupees(12000), 'goods_prosthetic'),
          discountPaise: rupees(2000),
          discountReason: 'Long-standing patient',
        },
      ],
      REGISTERED,
      MH,
    );
    const line = inv.lines[0]!;
    expect(line.taxableValuePaise).toBe(1000000); // ₹10,000 after ₹2,000 off
    expect(add(line.cgstPaise, line.sgstPaise)).toBe(120000); // 12% of ₹10,000
    expect(inv.discountPaise).toBe(200000);
    expect(inv.subtotalPaise).toBe(1200000); // subtotal is gross of discount
  });

  it('refuses a discount larger than the line', () => {
    expect(() =>
      computeInvoice(
        [{ ...lineFromCategory('Crown', rupees(1000), 'goods_prosthetic'), discountPaise: rupees(2000) }],
        REGISTERED,
        MH,
      ),
    ).toThrow(TaxError);
  });
});

describe('quantities and validation', () => {
  it('multiplies by quantity before tax', () => {
    const inv = computeInvoice(
      [lineFromCategory('Implant fixture', rupees(18000), 'goods_prosthetic', { quantity: 2 })],
      REGISTERED,
      MH,
    );
    expect(inv.lines[0]?.taxableValuePaise).toBe(3600000);
    expect(add(inv.cgstPaise, inv.sgstPaise)).toBe(432000); // 12% of ₹36,000
  });

  it('rejects nonsense rather than quietly producing a wrong invoice', () => {
    expect(() => computeInvoice([], REGISTERED, MH)).toThrow(TaxError);
    expect(() =>
      computeInvoice(
        [{ ...lineFromCategory('X', rupees(100), 'goods_retail'), quantity: 0 }],
        REGISTERED,
        MH,
      ),
    ).toThrow(TaxError);
    expect(() =>
      computeInvoice(
        [{ ...lineFromCategory('X', rupees(100), 'goods_retail'), quantity: 1.5 }],
        REGISTERED,
        MH,
      ),
    ).toThrow(TaxError);
  });
});

describe('rounding line', () => {
  it('rounds the payable total to a whole rupee and records the difference', () => {
    // 18% on ₹1,111.11 gives a total with paise.
    const inv = computeInvoice(
      [lineFromCategory('Whitening', fromRupeeString('1111.11'), 'cosmetic_service')],
      REGISTERED,
      MH,
    );
    const raw = add(inv.taxablePaise, inv.exemptPaise, inv.cgstPaise, inv.sgstPaise, inv.igstPaise);
    expect(add(raw, inv.roundingPaise)).toBe(inv.totalPaise);
    expect(inv.totalPaise % 100).toBe(0);
  });

  it('leaves rounding at zero when the total is already whole', () => {
    const inv = computeInvoice(
      [lineFromCategory('RCT', rupees(6000), 'exempt_healthcare')],
      REGISTERED,
      MH,
    );
    expect(inv.roundingPaise).toBe(0);
    expect(inv.totalPaise).toBe(600000);
  });
});

describe('accountant-facing output', () => {
  it('summarises by HSN/SAC the way a return expects', () => {
    const a = computeInvoice(
      [
        lineFromCategory('RCT', rupees(6000), 'exempt_healthcare'),
        lineFromCategory('Crown', rupees(12000), 'goods_prosthetic'),
      ],
      REGISTERED,
      MH,
    );
    const b = computeInvoice(
      [lineFromCategory('Crown', rupees(8000), 'goods_prosthetic')],
      REGISTERED,
      MH,
    );

    const rows = summariseByHsn([a, b]);
    expect(rows).toHaveLength(2);

    const exempt = rows.find((r) => r.hsnSacCode === '9993')!;
    expect(exempt.valuePaise).toBe(600000);
    expect(exempt.cgstPaise).toBe(0);

    const prosthetic = rows.find((r) => r.hsnSacCode === '9021')!;
    expect(prosthetic.valuePaise).toBe(2000000); // ₹20,000 across both invoices
    expect(add(prosthetic.cgstPaise, prosthetic.sgstPaise)).toBe(240000);
  });

  it('computes the input tax credit proportion', () => {
    // A practice doing ₹6,000 exempt and ₹2,000 taxable recovers a quarter.
    expect(itcEligibleBp(rupees(2000), rupees(6000))).toBe(2500);
    // An entirely exempt practice recovers nothing.
    expect(itcEligibleBp(ZERO, rupees(6000))).toBe(0);
    expect(itcEligibleBp(ZERO, ZERO)).toBe(0);
  });
});
