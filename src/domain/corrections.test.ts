import { describe, expect, it } from 'vitest';
import { billCancellation } from './corrections';
import { can, ROLE_CAPABILITIES, ROLES } from './permissions';

describe('receipt.cancel (T19)', () => {
  it('is owner only', () => {
    for (const r of ROLES) expect(ROLE_CAPABILITIES[r].includes('receipt.cancel'), r).toBe(r === 'owner');
    expect(can([{ role: 'owner', branchId: null }], 'receipt.cancel', 'pune')).toBe(true);
    expect(can([{ role: 'branch_manager', branchId: 'pune' }], 'receipt.cancel', 'pune')).toBe(false);
    expect(can([{ role: 'front_desk', branchId: 'pune' }], 'receipt.cancel', 'pune')).toBe(false);
  });
});


describe('who may cancel a bill (T20, Q9)', () => {
  const base = { status: 'issued', paidPaise: 0, issuedOn: '2026-10-26', createdBy: 'desk', userId: 'desk', today: '2026-10-26', canVoidAny: false, canVoidOwnToday: true };

  it('lets the desk cancel its own unpaid bill on the same day', () => {
    expect(billCancellation(base)).toEqual({ allowed: true });
  });
  it('not someone else’s bill', () => {
    expect(billCancellation({ ...base, createdBy: 'other' })).toMatchObject({ allowed: false, reason: expect.stringMatching(/^Only the owner can cancel this bill\. You can cancel only bills you issued yourself/) });
  });
  it('not a bill from an earlier day', () => {
    expect(billCancellation({ ...base, issuedOn: '2026-10-25' })).toMatchObject({ allowed: false, reason: expect.stringMatching(/only on the day/) });
  });
  it('not a paid bill, and the owner is told to cancel the payments first', () => {
    expect(billCancellation({ ...base, paidPaise: 1 })).toMatchObject({ allowed: false, reason: 'This bill has payments. Only the owner can cancel this bill.' });
    expect(billCancellation({ ...base, paidPaise: 1, canVoidAny: true })).toMatchObject({ allowed: false, needsPaymentsCancelled: true });
  });
  it('not a cancelled bill', () => {
    expect(billCancellation({ ...base, status: 'void', canVoidAny: true }).allowed).toBe(false);
  });
  it('the owner may cancel any unpaid bill; others are told who can', () => {
    expect(billCancellation({ ...base, createdBy: 'x', issuedOn: '2026-01-01', canVoidAny: true, canVoidOwnToday: false })).toEqual({ allowed: true });
    expect(billCancellation({ ...base, canVoidOwnToday: false })).toEqual({ allowed: false, reason: 'Only the owner can cancel this bill.' });
  });
  it('only the front desk holds the own-bill latitude', () => {
    for (const r of ROLES) expect(ROLE_CAPABILITIES[r].includes('invoice.void_own_today'), r).toBe(r === 'front_desk' || r === 'owner' || r === 'branch_manager');
  });
});
