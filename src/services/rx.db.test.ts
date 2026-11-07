import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, prescriptions } from '@/db/schema';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError } from './context';
import { issueBill } from './invoices';
import { registerPatient } from './patients';
import { addStarterMedicines, getPrescription, listMedicines, listPrescriptions, listTemplates, patientAllergies, saveMedicine, saveTemplate, suggestedTemplateIds, writePrescription } from './rx';

let f: Fixture;
let other: Fixture;
let pid: string;

const rxLine = (medicineId: string, name: string) => ({ medicineId, name, strength: '', form: '', dose: '1 tablet', frequency: '1-0-1', days: '5', instructions: 'After food' });

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
  const r = await registerPatient(f.ctx('desk'), { fullName: 'Rx Patient', phone: `93${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, sex: 'F', age: 33, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  pid = r.patientId;
});
afterAll(async () => {
  await closeDb();
});

describe('medicines, templates and prescriptions (LET-172/173)', () => {
  let amox: string;
  let pcm: string;
  let rxId: string;

  it('owner adds the starter list once; a duplicate name+strength is refused', async () => {
    const n = await addStarterMedicines(f.ctx('owner'));
    expect(n).toBeGreaterThan(20);
    expect(await addStarterMedicines(f.ctx('owner'))).toBe(0);
    const meds = await listMedicines(f.ctx('owner'));
    amox = meds.find((m) => m.name === 'Amoxicillin')!.id;
    pcm = meds.find((m) => m.name === 'Paracetamol')!.id;
    expect(await saveMedicine(f.ctx('owner'), null, { name: 'amoxicillin', strength: '500 MG', form: 'capsule', dose: '', frequency: '', days: '', instructions: '' })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    await expect(addStarterMedicines(f.ctx('desk'))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a template for root canal is suggested when RCT was done today', async () => {
    const t = await saveTemplate(f.ctx('owner'), null, {
      name: 'Root canal',
      catalogueItemId: f.items.rct,
      advice: 'Avoid chewing on that side until the crown.',
      lines: [
        { medicineId: amox, dose: '1 capsule', frequency: '1-1-1', days: '5', instructions: 'After food' },
        { medicineId: pcm, dose: '1 tablet', frequency: 'SOS', days: '3', instructions: 'For pain' },
      ],
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect((await listTemplates(f.ctx('desk', f.pune.id)).catch(() => null))).toBeNull(); // desk neither prescribes nor manages
    expect((await listTemplates(f.ctx('owner')))[0]).toMatchObject({ name: 'Root canal', treatmentName: 'Root canal treatment', lines: [{ name: 'Amoxicillin' }, { name: 'Paracetamol' }] });
    expect(await suggestedTemplateIds(f.ctx('owner', f.pune.id), pid, f.pune.id)).toEqual([]);
    await issueBill(f.ctx('desk'), { patientId: pid, doctorId: f.doctorId, idempotencyKey: key(), mode: 'unbilled', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    expect(await suggestedTemplateIds(f.ctx('owner', f.pune.id), pid, f.pune.id)).toEqual([t.id]);
  });

  it('only a doctor with a profile signs; allergies are saved on the patient', async () => {
    const input = { patientId: pid, complaint: 'Pain in 36, deep caries', advice: 'Warm saline rinses', allergies: 'Penicillin? ask', lines: [rxLine(amox, 'Amoxicillin'), rxLine('', 'Hexidine mouthwash')] };
    await expect(writePrescription(f.ctx('desk'), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(writePrescription(f.ctx('manager'), input)).rejects.toBeInstanceOf(ForbiddenError);
    const bad = await writePrescription(f.ctx('owner', f.pune.id), { ...input, lines: [{ ...rxLine(amox, 'Amoxicillin'), frequency: '', instructions: '' }] });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { 'lines.0.frequency': expect.any(String) } });
    const r = await writePrescription(f.ctx('owner', f.pune.id), input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    rxId = r.id;
    expect(await patientAllergies(f.ctx('desk'), pid)).toBe('Penicillin? ask');
    const rx = (await getPrescription(f.ctx('desk'), rxId))!;
    expect(rx).toMatchObject({ ref: `RX/${f.pune.code}/0001`, doctorName: 'Dr Owner', status: 'signed', allergies: 'Penicillin? ask', complaint: 'Pain in 36, deep caries' });
    expect(rx.lines.map((l) => l.name)).toEqual(['Amoxicillin', 'Hexidine mouthwash']);
    expect(rx.lines[0]).toMatchObject({ strength: null }); // the line keeps what was written
    // Reading a prescription is audited.
    const views = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, rxId), eq(auditLog.action, 'prescription.view')));
    expect(views.length).toBeGreaterThanOrEqual(1);
  });

  it('a correction is a new prescription; the old one is marked replaced and never changes', async () => {
    const [before] = await getDb().select().from(prescriptions).where(eq(prescriptions.id, rxId));
    const r = await writePrescription(f.ctx('owner', f.pune.id), { patientId: pid, complaint: 'Pain in 36', advice: '', allergies: 'Penicillin', replacesId: rxId, lines: [rxLine(pcm, 'Paracetamol')] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [after] = await getDb().select().from(prescriptions).where(eq(prescriptions.id, rxId));
    expect(after).toEqual({ ...before, status: 'replaced' });
    expect((await getPrescription(f.ctx('desk'), rxId))!.replacedById).toBe(r.id);
    await expect(writePrescription(f.ctx('owner', f.pune.id), { patientId: pid, complaint: '', advice: '', allergies: '', replacesId: rxId, lines: [rxLine(pcm, 'Paracetamol')] })).rejects.toBeInstanceOf(UserFacingError);
    const list = await listPrescriptions(f.ctx('desk'), pid);
    expect(list.map((x) => [x.status, x.count])).toEqual([['signed', 1], ['replaced', 2]]);
  });

  it('other orgs can’t read, correct, or use these medicines', async () => {
    expect(await getPrescription(other.ctx('owner'), rxId)).toBeNull();
    await expect(writePrescription(other.ctx('owner', other.pune.id), { patientId: pid, complaint: '', advice: '', allergies: '', lines: [rxLine(amox, 'Amoxicillin')] })).rejects.toBeInstanceOf(ForbiddenError);
    const op = await registerPatient(other.ctx('desk'), { fullName: 'Other Rx', phone: `92${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, sex: 'M', age: 50, acknowledgedDuplicate: true });
    if (!op.ok) throw new Error('reg');
    await expect(writePrescription(other.ctx('owner', other.pune.id), { patientId: op.patientId, complaint: '', advice: '', allergies: '', lines: [rxLine(amox, 'Amoxicillin')] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
