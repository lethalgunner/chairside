import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, memberships } from '@/db/schema';
import { createFixture, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError } from './context';
import { doctorsWithoutProvider, listProviders } from './providers';
import { addRole, listStaff, removeRole } from './staff';

let f: Fixture;
let other: Fixture;

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

const grantsOf = async (userId: string) => (await listStaff(f.ctx('owner'))).find((p) => p.id === userId)!.grants;

describe('roles on the Team page (LET-175)', () => {
  it('moves the desk from Pune to Kanpur: add the new role, then remove the old', async () => {
    const deskId = (await listStaff(f.ctx('owner'))).find((p) => p.fullName === 'Desk Pune')!.id;
    await addRole(f.ctx('owner'), deskId, 'front_desk', f.kanpur.id);
    const g = await grantsOf(deskId);
    expect(g.map((x) => x.branchName).sort()).toEqual(['Kanpur', 'Pune']);
    await removeRole(f.ctx('owner'), g.find((x) => x.branchName === 'Pune')!.id);
    expect((await grantsOf(deskId)).map((x) => x.branchName)).toEqual(['Kanpur']);
    await expect(addRole(f.ctx('owner'), deskId, 'front_desk', f.kanpur.id)).rejects.toBeInstanceOf(UserFacingError);
    const audit = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, deskId), eq(auditLog.orgId, f.orgId)));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['staff.role_added', 'staff.role_removed']));
  });

  it('making someone a doctor gives them a doctor profile at that branch', async () => {
    const mgr = (await listStaff(f.ctx('owner'))).find((p) => p.fullName === 'Manager Pune')!.id;
    await addRole(f.ctx('owner'), mgr, 'doctor', f.pune.id);
    expect(await doctorsWithoutProvider(f.orgId)).toEqual([]);
    expect((await listProviders(f.ctx('desk', f.pune.id), f.pune.id)).map((p) => p.fullName)).toContain('Manager Pune');
  });

  it('guards: not the only role, not your own owner role, never the last owner; bad input refused', async () => {
    const ca = (await listStaff(f.ctx('owner'))).find((p) => p.fullName === 'CA')!;
    await expect(removeRole(f.ctx('owner'), ca.grants[0]!.id)).rejects.toBeInstanceOf(UserFacingError);
    const mine = await grantsOf(f.ownerId);
    await expect(removeRole(f.ctx('owner'), mine.find((g) => g.role === 'owner')!.id)).rejects.toBeInstanceOf(UserFacingError);
    await expect(addRole(f.ctx('owner'), ca.id, 'owner', f.pune.id)).rejects.toBeInstanceOf(UserFacingError);
    await expect(addRole(f.ctx('owner'), ca.id, 'front_desk', null)).rejects.toBeInstanceOf(UserFacingError);
    await expect(addRole(f.ctx('owner'), ca.id, 'emperor', f.pune.id)).rejects.toBeInstanceOf(UserFacingError);
    // A second owner can be added; then one owner role can go, but never the last.
    await addRole(f.ctx('owner'), ca.id, 'owner', null);
    const caOwner = (await grantsOf(ca.id)).find((g) => g.role === 'owner')!;
    await removeRole(f.ctx('owner'), caOwner.id);
    const [stillOwner] = await getDb().select().from(memberships).where(and(eq(memberships.userId, f.ownerId), eq(memberships.role, 'owner')));
    expect(stillOwner).toBeTruthy();
  });

  it('only the owner, only this org', async () => {
    const ca = (await listStaff(f.ctx('owner'))).find((p) => p.fullName === 'CA')!;
    await expect(addRole(f.ctx('manager'), ca.id, 'front_desk', f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeRole(f.ctx('desk'), ca.grants[0]!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addRole(other.ctx('owner'), ca.id, 'front_desk', other.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addRole(f.ctx('owner'), ca.id, 'front_desk', other.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeRole(other.ctx('owner'), ca.grants[0]!.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
