import { describe, expect, it } from 'vitest';
import { businessDate, financialYear, financialYearShort, ageNow } from './dates';
import { formatDocumentNumber, NumberingError } from './numbering';
import { normaliseIndianMobile } from './phone';
import { can, accessibleBranches, type Grant } from './permissions';

describe('business date in IST', () => {
  it('rolls over at IST midnight, not UTC midnight', () => {
    // 31 Mar 2027 23:30 IST = 18:00 UTC
    expect(businessDate(new Date('2027-03-31T18:00:00Z'))).toBe('2027-03-31');
    // 1 Apr 2027 00:30 IST = 31 Mar 19:00 UTC
    expect(businessDate(new Date('2027-03-31T19:00:00Z'))).toBe('2027-04-01');
  });

  it('assigns the right financial year either side of 1 April', () => {
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(financialYearShort('2026-10-17')).toBe('26-27');
  });

  it('ages an approximate age forward from the date it was recorded', () => {
    expect(ageNow(30, '2026-10-17', '2027-10-16')).toBe(30);
    expect(ageNow(30, '2026-10-17', '2027-10-17')).toBe(31);
    expect(ageNow(null, null, '2027-01-01')).toBeNull();
  });
});

describe('document numbering (ADR-010, ADR-012)', () => {
  const base = { branchCode: 'PUN', fyShort: '26-27', testSeries: true } as const;

  it('fits every series into 16 characters', () => {
    const sale = formatDocumentNumber({ ...base, documentType: 'sale', sequence: 1 });
    const receipt = formatDocumentNumber({ ...base, documentType: 'receipt', sequence: 1 });
    const live = formatDocumentNumber({ ...base, testSeries: false, documentType: 'sale', sequence: 123 });
    expect(sale).toBe('PUNT/26-27/00001');
    expect(receipt).toBe('PUNTR/26-27/0001');
    expect(live).toBe('PUN/26-27/000123');
    for (const n of [sale, receipt, live]) expect(n.length).toBeLessThanOrEqual(16);
  });

  it('throws when a series is full instead of widening', () => {
    expect(formatDocumentNumber({ ...base, documentType: 'receipt', sequence: 9999 })).toBe('PUNTR/26-27/9999');
    expect(() => formatDocumentNumber({ ...base, documentType: 'receipt', sequence: 10000 })).toThrow(NumberingError);
  });

  it('rejects bad branch codes and sequences', () => {
    expect(() => formatDocumentNumber({ ...base, branchCode: 'PUNE', documentType: 'sale', sequence: 1 })).toThrow();
    expect(() => formatDocumentNumber({ ...base, documentType: 'sale', sequence: 0 })).toThrow();
  });
});

describe('Indian mobile normalisation', () => {
  it.each([
    ['98220 41155', '9822041155'],
    ['+91 98220 41155', '9822041155'],
    ['098220 41155', '9822041155'],
    ['91-9822041155', '9822041155'],
    ['9822041155', '9822041155'],
  ])('%s → %s', (input, out) => expect(normaliseIndianMobile(input)).toBe(out));

  it.each(['982204115', '5822041155', 'abcdefghij', '+1 415 555 0100'])('rejects %s', (input) =>
    expect(normaliseIndianMobile(input)).toBeNull(),
  );
});

describe('capabilities', () => {
  const desk: Grant[] = [{ role: 'front_desk', branchId: 'pune' }];
  const owner: Grant[] = [{ role: 'owner', branchId: null }];
  const manager: Grant[] = [{ role: 'branch_manager', branchId: 'pune' }];

  it('scopes front desk to its own branch', () => {
    expect(can(desk, 'invoice.issue', 'pune')).toBe(true);
    expect(can(desk, 'invoice.issue', 'kanpur')).toBe(false);
    expect(can(desk, 'report.gst', 'pune')).toBe(false);
  });

  it('lets only the owner reopen a day', () => {
    expect(can(owner, 'day.reopen', 'kanpur')).toBe(true);
    expect(can(manager, 'day.reopen', 'pune')).toBe(false);
    expect(can(desk, 'day.reopen', 'pune')).toBe(false);
  });

  it('keeps accountants away from patient records', () => {
    expect(can([{ role: 'accountant', branchId: null }], 'patient.view', 'pune')).toBe(false);
  });

  it('lists accessible branches', () => {
    expect(accessibleBranches(owner, ['kanpur', 'pune'])).toEqual(['kanpur', 'pune']);
    expect(accessibleBranches(desk, ['kanpur', 'pune'])).toEqual(['pune']);
  });
});
