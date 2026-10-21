import { describe, expect, it } from 'vitest';
import { can, canOrgWide, ROLE_CAPABILITIES, ROLE_LABELS, ROLES, type Grant } from './permissions';
import { checkStaffGrant, deactivationBlocker, inviteStatus } from './staff';

describe('staff.manage (T14)', () => {
  const owner: Grant[] = [{ role: 'owner', branchId: null }];
  const manager: Grant[] = [{ role: 'branch_manager', branchId: 'pune' }];

  it('is held by the owner only', () => {
    for (const r of ROLES) expect(ROLE_CAPABILITIES[r].includes('staff.manage'), r).toBe(r === 'owner');
    expect(can(owner, 'staff.manage', 'pune')).toBe(true);
    expect(can(manager, 'staff.manage', 'pune')).toBe(false);
  });

  it('needs an org-wide grant for org-level settings', () => {
    expect(canOrgWide(owner, 'staff.manage')).toBe(true);
    expect(canOrgWide(manager, 'staff.manage')).toBe(false);
    // A branch-scoped grant never reaches org-level settings, even for a capability the role holds.
    expect(canOrgWide(manager, 'catalogue.manage')).toBe(false);
  });

  it('has a plain label for all eight roles', () => {
    expect(ROLES).toHaveLength(8);
    for (const r of ROLES) expect(ROLE_LABELS[r].length).toBeGreaterThan(3);
  });
});

describe('invite validation', () => {
  const base = { fullName: '  Ravi   Kumar ', email: ' Ravi@Example.COM ', role: 'front_desk', branchId: 'b1' };

  it('lower-cases the email and tidies the name', () => {
    const r = checkStaffGrant(base);
    expect(r).toEqual({ ok: true, value: { fullName: 'Ravi Kumar', email: 'ravi@example.com', role: 'front_desk', branchId: 'b1', linkUserId: null } });
  });

  it('requires a branch for every role except owner, and none for owner', () => {
    expect(checkStaffGrant({ ...base, branchId: null })).toMatchObject({ ok: false, fieldErrors: { branchId: expect.any(String) } });
    expect(checkStaffGrant({ ...base, role: 'owner' })).toMatchObject({ ok: false, fieldErrors: { branchId: expect.any(String) } });
    expect(checkStaffGrant({ ...base, role: 'owner', branchId: null }).ok).toBe(true);
    // The command line keeps its documented org-wide grants.
    expect(checkStaffGrant({ ...base, role: 'accountant', branchId: null }, { orgWideAllowed: true }).ok).toBe(true);
  });

  it('rejects unknown roles, bad emails and missing names', () => {
    const r = checkStaffGrant({ fullName: 'R', email: 'not-an-email', role: 'superuser', branchId: 'b1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(['email', 'fullName', 'role']);
  });

  it('needs no name when giving an existing record a login', () => {
    const r = checkStaffGrant({ ...base, fullName: '', role: 'doctor', linkUserId: 'u1' });
    expect(r).toMatchObject({ ok: true, value: { fullName: null, linkUserId: 'u1' } });
  });
});

describe('invite status', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const later = new Date('2026-10-22T10:00:00Z');
  const earlier = new Date('2026-10-20T10:00:00Z');

  it.each([
    [{ hasPassword: true, hasEmail: true, latestInvite: null }, 'set_up'],
    [{ hasPassword: false, hasEmail: false, latestInvite: null }, 'no_login'],
    [{ hasPassword: false, hasEmail: true, latestInvite: { expiresAt: later, usedAt: null } }, 'pending'],
    [{ hasPassword: false, hasEmail: true, latestInvite: { expiresAt: earlier, usedAt: null } }, 'expired'],
    [{ hasPassword: false, hasEmail: true, latestInvite: null }, 'expired'],
  ] as const)('%o → %s', (p, expected) => expect(inviteStatus({ ...p, now })).toBe(expected));
});

describe('deactivation guards', () => {
  it('refuses self-deactivation', () => {
    expect(deactivationBlocker({ actorId: 'a', targetId: 'a', targetIsOwner: true, otherActiveOwners: 3 })).toMatch(/yourself/);
  });
  it('refuses to remove the last active owner', () => {
    expect(deactivationBlocker({ actorId: 'a', targetId: 'b', targetIsOwner: true, otherActiveOwners: 0 })).toMatch(/last active owner/);
    expect(deactivationBlocker({ actorId: 'a', targetId: 'b', targetIsOwner: true, otherActiveOwners: 1 })).toBeNull();
    expect(deactivationBlocker({ actorId: 'a', targetId: 'b', targetIsOwner: false, otherActiveOwners: 0 })).toBeNull();
  });
});
