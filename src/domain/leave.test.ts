import { describe, expect, it } from 'vitest';
import { checkLeave, leaveOn } from './leave';

const today = '2026-11-09';

describe('checkLeave', () => {
  it('one day: "to" defaults to "from"', () => {
    expect(checkLeave({ from: '2026-11-12', to: '' }, today)).toEqual({ ok: true, value: { startsOn: '2026-11-12', endsOn: '2026-11-12', note: null } });
  });
  it('today is allowed, yesterday is not', () => {
    expect(checkLeave({ from: today, to: today }, today).ok).toBe(true);
    const r = checkLeave({ from: '2026-11-08', to: today }, today);
    expect(r.ok ? [] : Object.keys(r.fieldErrors)).toEqual(['from']);
  });
  it('to before from, and longer than 180 days, are refused', () => {
    const back = checkLeave({ from: '2026-11-12', to: '2026-11-11' }, today);
    expect(back.ok ? null : back.fieldErrors.to).toMatch(/before/);
    expect(checkLeave({ from: '2026-11-12', to: '2027-05-10' }, today).ok).toBe(true); // 180 days inclusive
    const long = checkLeave({ from: '2026-11-12', to: '2027-05-11' }, today);
    expect(long.ok ? null : long.fieldErrors.to).toMatch(/180/);
  });
  it('bad dates and a long note go to their fields; the note is trimmed', () => {
    const r = checkLeave({ from: 'soon', to: 'x', note: 'n'.repeat(201) }, today);
    expect(r.ok ? [] : Object.keys(r.fieldErrors).sort()).toEqual(['from', 'note', 'to']);
    expect(checkLeave({ from: today, to: today, note: '  conference ' }, today)).toMatchObject({ value: { note: 'conference' } });
  });
});

describe('leaveOn', () => {
  const leaves = [{ startsOn: '2026-11-12', endsOn: '2026-11-14', note: null }];
  it('both ends are included', () => {
    expect(leaveOn(leaves, '2026-11-11')).toBeNull();
    expect(leaveOn(leaves, '2026-11-12')).not.toBeNull();
    expect(leaveOn(leaves, '2026-11-14')).not.toBeNull();
    expect(leaveOn(leaves, '2026-11-15')).toBeNull();
  });
});
