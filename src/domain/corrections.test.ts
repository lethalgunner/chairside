import { describe, expect, it } from 'vitest';
import { can, ROLE_CAPABILITIES, ROLES } from './permissions';

describe('receipt.cancel (T19)', () => {
  it('is owner only', () => {
    for (const r of ROLES) expect(ROLE_CAPABILITIES[r].includes('receipt.cancel'), r).toBe(r === 'owner');
    expect(can([{ role: 'owner', branchId: null }], 'receipt.cancel', 'pune')).toBe(true);
    expect(can([{ role: 'branch_manager', branchId: 'pune' }], 'receipt.cancel', 'pune')).toBe(false);
    expect(can([{ role: 'front_desk', branchId: 'pune' }], 'receipt.cancel', 'pune')).toBe(false);
  });
});
