import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { appointments, patientRegistrations, patients } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { createFixture, type Fixture } from '@/test/fixtures';
import { ForbiddenError } from './context';
import { DATA_CHANGED, DATA_HAS_ERRORS, previewImport, saveImport } from './data-import';
import { addLeave } from './leave';
import { registerPatient } from './patients';

let f: Fixture;
let other: Fixture;
const today = businessDate();
const workday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? addDays(d, 1) : d);
const D = workday(addDays(today, 4));
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const tag = String(Date.now()).slice(-6);
const m = (n: number) => `91${tag}${String(n).padStart(2, '0')}`; // 10-digit, starts with 9

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('import patients (Sprint 9)', () => {
  const sheet = () => `Patient Name,Gender,Contact No.,Age\nAsha Import,F,${m(1)},34\nRavi Import,M,${m(2)},\nAsha Import,F,${m(1)},34\n`;

  it('Check is a dry run: per-row status, nothing written', async () => {
    const p = await previewImport(f.ctx('owner', f.pune.id), 'patients', sheet());
    expect(p.ok && p.counts).toEqual({ new: 2, skip: 0, error: 1 });
    expect(p.ok && p.rows[2]).toMatchObject({ line: 4, status: 'error', note: 'Same patient as line 2. Remove one.' });
    expect(await getDb().select().from(patients).where(and(eq(patients.orgId, f.orgId), eq(patients.phone, m(1))))).toHaveLength(0);
  });

  it('any error row means nothing is imported', async () => {
    const r = await saveImport(f.ctx('owner', f.pune.id), 'patients', sheet(), 2);
    expect(r).toMatchObject({ ok: false, error: DATA_HAS_ERRORS });
    expect(await getDb().select().from(patients).where(and(eq(patients.orgId, f.orgId), eq(patients.phone, m(2))))).toHaveLength(0);
  });

  it('clean sheet: all imported with file numbers at the branch; a second import skips them', async () => {
    const clean = `Patient Name,Gender,Contact No.,Age\nAsha Import,F,${m(1)},34\nRavi Import,M,${m(2)},\n`;
    expect(await saveImport(f.ctx('owner', f.pune.id), 'patients', clean, 1)).toEqual({ ok: false, error: DATA_CHANGED, preview: expect.anything() });
    expect(await saveImport(f.ctx('owner', f.pune.id), 'patients', clean, 2)).toEqual({ ok: true, created: 2, skipped: 0 });
    const [asha] = await getDb().select().from(patients).where(and(eq(patients.orgId, f.orgId), eq(patients.phone, m(1))));
    expect(asha).toMatchObject({ fullName: 'Asha Import', sex: 'F', approximateAge: 34, referralSource: 'Imported' });
    const files = await getDb().select().from(patientRegistrations).where(eq(patientRegistrations.patientId, asha!.id));
    expect(files.map((x) => x.branchId)).toEqual([f.pune.id]);
    const again = await previewImport(f.ctx('owner', f.pune.id), 'patients', clean);
    expect(again.ok && again.counts).toEqual({ new: 0, skip: 2, error: 0 });
  });

  it('owner only, at a picked branch; other clinics see their own data only', async () => {
    await expect(previewImport(f.ctx('desk'), 'patients', sheet())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(previewImport(f.ctx('owner', 'all'), 'patients', sheet())).rejects.toThrow(/Pick a branch/);
    const o = await previewImport(other.ctx('owner', other.pune.id), 'patients', `Name,Mobile\nAsha Import,${m(1)}\n`);
    expect(o.ok && o.counts).toEqual({ new: 1, skip: 0, error: 0 });
  });
});

describe('import future appointments (Sprint 9)', () => {
  it('matches patient by mobile and doctor by name; past rows skipped; clashes and unknowns explained', async () => {
    const shared = `98${tag}77`;
    for (const n of ['Kiran One', 'Kiran Two']) await registerPatient(f.ctx('desk'), { fullName: n, phone: shared, sex: 'F', age: 30, acknowledgedDuplicate: true });
    const sheet = [
      'Mobile,Patient,Date,Time,Doctor,Duration',
      `${m(1)},Asha Import,${dmy(D)},11:00 am,Dr Associate,30`,
      `${m(2)},Ravi Import,${dmy(D)},11:15,associate,`,
      `${m(2)},Ravi Import,${dmy(addDays(today, -3))},11:00,Dr Associate,`,
      `9000000001,Nobody,${dmy(D)},12:00,Dr Associate,`,
      `${m(2)},Ravi Import,${dmy(D)},13:00,Dr Who,`,
      `${shared},Kiran Two,${dmy(D)},14:00,Dr Associate,`,
      `${shared},Kiran Three,${dmy(D)},15:00,Dr Associate,`,
    ].join('\n');
    const p = await previewImport(f.ctx('owner', f.pune.id), 'appointments', sheet);
    if (!p.ok) throw new Error(p.error);
    expect(p.rows.map((r) => [r.line, r.status])).toEqual([[2, 'new'], [3, 'error'], [4, 'skip'], [5, 'error'], [6, 'error'], [7, 'new'], [8, 'error']]);
    expect(p.rows[1]!.note).toBe('Clashes with line 2 for Dr Associate.');
    expect(p.rows[3]!.note).toBe('No patient with this mobile. Import patients first.');
    expect(p.rows[4]!.note).toMatch(/^No doctor called “Dr Who” works at this branch\. Doctors here: /);
    expect(p.rows[6]!.note).toBe('Several patients share this mobile and the name matches none of them.');
  });

  it('a clean sheet imports; the appointments are marked imported; importing again skips them; leave is respected', async () => {
    const sheet = `Mobile,Patient,Date,Time,Doctor,Duration\n${m(1)},Asha Import,${dmy(D)},11:00,Dr Associate,30\n${m(2)},Ravi Import,${dmy(D)},12:00,Dr Associate,\n`;
    expect(await saveImport(f.ctx('owner', f.pune.id), 'appointments', sheet, 2)).toEqual({ ok: true, created: 2, skipped: 0 });
    const rows = await getDb().select().from(appointments).where(and(eq(appointments.orgId, f.orgId), eq(appointments.imported, true)));
    expect(rows).toHaveLength(2);
    expect(rows.map((a) => (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000).sort()).toEqual([15, 30]); // slot default for blank
    const again = await previewImport(f.ctx('owner', f.pune.id), 'appointments', sheet);
    expect(again.ok && again.counts).toEqual({ new: 0, skip: 2, error: 0 });
    await addLeave(f.ctx('owner'), f.doctorId, { from: addDays(D, 1), to: addDays(D, 1) });
    const onLeave = await previewImport(f.ctx('owner', f.pune.id), 'appointments', `Mobile,Patient,Date,Time,Doctor\n${m(1)},Asha Import,${dmy(addDays(D, 1))},11:00,Dr Associate\n`);
    expect(onLeave.ok && onLeave.rows[0]!.note).toMatch(/on leave/);
  });
});
