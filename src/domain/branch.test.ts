import { describe, expect, it } from 'vitest';
import { checkBranchDetails, GST_STATE_CODES, gstinProblem, STATES, type BranchDetailsInput } from './branch';
import { can, ROLE_CAPABILITIES, ROLES } from './permissions';

describe('branch.manage (T16)', () => {
  it('is owner only', () => {
    for (const r of ROLES) expect(ROLE_CAPABILITIES[r].includes('branch.manage'), r).toBe(r === 'owner');
    expect(can([{ role: 'branch_manager', branchId: 'pune' }], 'branch.manage', 'pune')).toBe(false);
    expect(can([{ role: 'owner', branchId: null }], 'branch.manage', 'pune')).toBe(true);
  });
});

describe('GST state codes', () => {
  it('maps the pilot states and every state code is two digits and unique', () => {
    expect(GST_STATE_CODES['Uttar Pradesh']).toBe('09');
    expect(GST_STATE_CODES['Maharashtra']).toBe('27');
    expect(GST_STATE_CODES['Delhi']).toBe('07');
    expect(GST_STATE_CODES['Karnataka']).toBe('29');
    expect(GST_STATE_CODES['Telangana']).toBe('36');
    expect(GST_STATE_CODES['Andhra Pradesh']).toBe('37');
    const codes = Object.values(GST_STATE_CODES);
    expect(codes.every((c) => /^\d{2}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(STATES).toHaveLength(36); // 28 states + 8 union territories
  });
});

describe('GSTIN', () => {
  it('accepts a well-formed GSTIN for its own state', () => {
    expect(gstinProblem('27AAAAA0000A1Z5', 'Maharashtra')).toBeNull();
    expect(gstinProblem('09ABCDE1234F1Z5', 'Uttar Pradesh')).toBeNull();
  });

  it('refuses one from another state', () => {
    expect(gstinProblem('27AAAAA0000A1Z5', 'Uttar Pradesh')).toBe('A GSTIN for Uttar Pradesh starts with 09.');
    expect(gstinProblem('09ABCDE1234F1Z5', 'Maharashtra')).toMatch(/starts with 27/);
  });

  it.each(['27AAAAA0000A1Z', '27AAAAA0000A1Z55', '27aaaaa0000a1z5', '2AAAAA00000A1Z5', '27AAAA00000A1Z5', '27AAAAA0000A1X5', '27AAAAA0000A0Z5'])('refuses malformed %s', (g) => {
    expect(gstinProblem(g, 'Maharashtra')).toMatch(/15 characters/);
  });
});

describe('branch details validation', () => {
  const base: BranchDetailsInput = {
    name: ' Demo  Kanpur ',
    addressLine: '12 Mall Road',
    city: 'Kanpur',
    state: 'Uttar Pradesh',
    phone: '+91 512 222 3333',
    gstRegistered: true,
    gstin: ' 09abcde1234f1z5 ',
    dayCloseTolerance: '100',
    defaultFloat: '2,000.50',
  };

  it('normalises and converts rupees to paise', () => {
    expect(checkBranchDetails(base)).toEqual({
      ok: true,
      value: {
        name: 'Demo Kanpur',
        addressLine: '12 Mall Road',
        city: 'Kanpur',
        state: 'Uttar Pradesh',
        phone: '+91 512 222 3333',
        gstRegistered: true,
        gstin: '09ABCDE1234F1Z5',
        dayCloseTolerancePaise: 10_000,
        defaultFloatPaise: 200_050,
      },
    });
  });

  it('requires a GSTIN when registered, and drops it when not', () => {
    expect(checkBranchDetails({ ...base, gstin: '' })).toMatchObject({ ok: false, fieldErrors: { gstin: expect.stringMatching(/needs its GSTIN/) } });
    expect(checkBranchDetails({ ...base, state: 'Maharashtra' })).toMatchObject({ ok: false, fieldErrors: { gstin: expect.stringMatching(/starts with 27/) } });
    expect(checkBranchDetails({ ...base, gstRegistered: false, gstin: 'anything' })).toMatchObject({ ok: true, value: { gstin: null } });
  });

  it('refuses negative or malformed money, unknown states and odd phones', () => {
    const r = checkBranchDetails({ ...base, gstRegistered: false, dayCloseTolerance: '-5', defaultFloat: 'lots', state: 'Atlantis', phone: 'call me' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(['dayCloseTolerance', 'defaultFloat', 'phone', 'state']);
  });

  it('allows empty optional fields', () => {
    expect(checkBranchDetails({ ...base, addressLine: '', city: ' ', phone: '' })).toMatchObject({ ok: true, value: { addressLine: null, city: null, phone: null } });
  });
});
