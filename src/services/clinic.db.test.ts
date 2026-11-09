import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { createFixture, type Fixture } from '@/test/fixtures';
import { getClinicSettings, saveClinicSettings } from './clinic';
import { ForbiddenError } from './context';

let f: Fixture;
let other: Fixture;
beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('clinic settings and the parallel-run switch (Sprint 7)', () => {
  it('existing clinics start with the parallel run on (nothing changes for them)', async () => {
    expect((await getClinicSettings(f.ctx('desk'))).parallelRun).toBe(true);
  });
  it('the owner renames the clinic and switches the parallel run off; audited; other clinics untouched', async () => {
    const res = await saveClinicSettings(f.ctx('owner'), { name: '  Vij   Dental Care ', parallelRun: false });
    expect(res.ok).toBe(true);
    expect(await getClinicSettings(f.ctx('desk'))).toMatchObject({ name: 'Vij Dental Care', parallelRun: false });
    expect((await getClinicSettings(other.ctx('desk'))).parallelRun).toBe(true);
    const audit = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, f.orgId), eq(auditLog.action, 'clinic.update')));
    expect(audit).toHaveLength(1);
  });
  it('a bad name comes back on the field; only the owner may save', async () => {
    const bad = await saveClinicSettings(f.ctx('owner'), { name: 'x', parallelRun: true });
    expect(bad.ok ? null : bad.fieldErrors.name).toBeTruthy();
    await expect(saveClinicSettings(f.ctx('manager'), { name: 'Nope', parallelRun: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveClinicSettings(f.ctx('desk'), { name: 'Nope', parallelRun: true })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
