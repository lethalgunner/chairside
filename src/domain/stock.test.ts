import { describe, expect, it } from 'vitest';
import { checkMovement, checkStockItem, mayExpireOn, stockFlags, unitLabel } from './stock';

const today = '2026-11-08';
const mv = { kind: 'received', quantity: '10', direction: 'in' as const, expiresOn: '', unitCost: '', reason: '' };

describe('stock-lite (LET-176)', () => {
  it('checks an item', () => {
    expect(checkStockItem({ kind: 'supply', name: ' Nitrile gloves (M) ', unit: 'box', reorderLevel: '2' })).toMatchObject({ ok: true, value: { name: 'Nitrile gloves (M)', reorderLevel: 2 } });
    const bad = checkStockItem({ kind: 'food', name: 'x', unit: 'crate', reorderLevel: '-1' });
    expect(!bad.ok && Object.keys(bad.fieldErrors).sort()).toEqual(['kind', 'name', 'reorderLevel', 'unit']);
  });
  it('signs movements and asks for reasons', () => {
    expect(checkMovement({ ...mv, expiresOn: '2027-03-31', unitCost: '45.50' }, today)).toMatchObject({ ok: true, value: { quantity: 10, expiresOn: '2027-03-31', unitCostPaise: 4550 } });
    expect(checkMovement({ ...mv, kind: 'used', reason: 'Extraction tray' }, today)).toMatchObject({ ok: true, value: { quantity: -10, expiresOn: null } });
    expect(checkMovement({ ...mv, kind: 'adjusted', direction: 'out', reason: 'Counted 2 short' }, today)).toMatchObject({ ok: true, value: { quantity: -10 } });
    expect(checkMovement({ ...mv, kind: 'adjusted', direction: 'in', reason: 'Found a box' }, today)).toMatchObject({ ok: true, value: { quantity: 10 } });
    const bad = checkMovement({ ...mv, kind: 'used', quantity: '0', reason: '' }, today);
    expect(!bad.ok && Object.keys(bad.fieldErrors).sort()).toEqual(['quantity', 'reason']);
    expect(checkMovement({ ...mv, expiresOn: '2026-01-01' }, today)).toMatchObject({ ok: false, fieldErrors: { expiresOn: expect.stringContaining('expired') } });
  });
  it('finds the expiry of what is probably still on the shelf', () => {
    const r = [
      { quantity: 10, expiresOn: '2026-12-01', at: new Date('2026-09-01') },
      { quantity: 10, expiresOn: '2027-06-01', at: new Date('2026-11-01') },
    ];
    expect(mayExpireOn(5, r)).toBe('2027-06-01'); // only the newest lot is left
    expect(mayExpireOn(15, r)).toBe('2026-12-01'); // some of the old lot too
    expect(mayExpireOn(0, r)).toBeNull();
  });
  it('flags low, expiring and expired', () => {
    expect(stockFlags(2, 2, '2026-12-01', today)).toEqual({ low: true, expiring: true, expired: false });
    expect(stockFlags(5, 2, '2027-12-01', today)).toEqual({ low: false, expiring: false, expired: false });
    expect(stockFlags(0, 0, '2026-01-01', today)).toEqual({ low: true, expiring: false, expired: true });
  });
  it('says units properly', () => {
    expect([unitLabel('box', 10), unitLabel('box', 1), unitLabel('strip', 3), unitLabel('ml', 50)]).toEqual(['boxes', 'box', 'strips', 'ml']);
  });
});
