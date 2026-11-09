import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { appointments, messageSends } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { afterQuiet, DEFAULT_QUIET } from '@/domain/messages';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { bookAppointment, rescheduleAppointment, setAppointmentStatus } from './appointments';
import { ForbiddenError } from './context';
import { issueBill } from './invoices';
import { addRule, addSuggestedReminders, getMessageSettings, markMessage, removeRule, saveMessageOptions, saveTemplate, setMessagesStopped, setRuleActive, todaysMessages } from './messages';
import { registerPatient } from './patients';

let f: Fixture;
let other: Fixture;
const today = businessDate();
const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`);
const workday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? addDays(d, 1) : d);
const D = workday(addDays(today, 5));
const D2 = workday(addDays(D, 1));

async function patient(name: string, fx = f): Promise<string> {
  const phone = `93${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const r = await registerPatient(fx.ctx('desk'), { fullName: name, phone, sex: 'F', age: 35, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('Reminders: nothing changes until the owner sets them up', () => {
  it('a clinic with no rules has an empty, unconfigured queue', async () => {
    expect(await todaysMessages(f.ctx('desk'), f.pune.id)).toEqual({ configured: false, dueNow: [], laterToday: [] });
  });
  it('only the owner sees or changes settings; the accountant cannot read the queue', async () => {
    await expect(getMessageSettings(f.ctx('desk'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveTemplate(f.ctx('manager'), null, { name: 'x', language: 'en', body: 'Hello there' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addSuggestedReminders(f.ctx('desk'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(todaysMessages(f.ctx('accountant', f.pune.id), f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('Reminders: suggested set, rules and wording', () => {
  it('one tap adds 6 wordings and 6 rules; a second tap is refused', async () => {
    await addSuggestedReminders(f.ctx('owner'));
    const s = await getMessageSettings(f.ctx('owner'));
    expect(s.templates).toHaveLength(6);
    expect(s.rules.map((r) => r.timing)).toEqual([
      'Right after booking',
      '1 day before',
      '2 hours before',
      '2 hours after a missed appointment',
      'The day a come-back is due',
      'Every 7 days while money is owed, up to 3 times',
    ]);
    expect(s.quiet).toEqual(DEFAULT_QUIET);
    expect(s.doctorName).toBe(false);
    await expect(addSuggestedReminders(f.ctx('owner'))).rejects.toThrow(/already have reminders/);
  });

  it('at most 6 per appointment; wording must fit the kind of reminder', async () => {
    const s = await getMessageSettings(f.ctx('owner'));
    const remind = s.templates.find((t) => t.name === 'Appointment reminder')!.id;
    const dues = s.templates.find((t) => t.name === 'Money owed')!.id;
    const wrong = await addRule(f.ctx('owner'), { trigger: 'before_appointment', amount: '3', unit: 'days', templateId: dues, branchId: '' });
    expect(wrong.ok ? '' : wrong.fieldErrors.templateId).toMatch(/amount_due/);
    for (const h of ['3', '4', '5']) expect((await addRule(f.ctx('owner'), { trigger: 'before_appointment', amount: h, unit: 'hours', templateId: remind, branchId: '' })).ok).toBe(true);
    const seventh = await addRule(f.ctx('owner'), { trigger: 'before_appointment', amount: '6', unit: 'hours', templateId: remind, branchId: f.pune.id });
    expect(seventh.ok ? '' : seventh.fieldErrors.trigger).toMatch(/At most 6/);
    // Tidy: take the three extra ones away again.
    for (const r of (await getMessageSettings(f.ctx('owner'))).rules.filter((r) => ['3 hours before', '4 hours before', '5 hours before'].includes(r.timing))) await removeRule(f.ctx('owner'), r.id);
    expect((await getMessageSettings(f.ctx('owner'))).rules).toHaveLength(6);
  });

  it('{doctor} only when the owner switches it on, and can’t be switched off while used', async () => {
    const off = await saveTemplate(f.ctx('owner'), null, { name: 'With doctor', language: 'en', body: 'See {doctor} on {date}.' });
    expect(off.ok).toBe(false);
    expect(await saveMessageOptions(f.ctx('owner'), { quietStart: '21:00', quietEnd: '08:00', doctorName: true })).toEqual({ ok: true });
    const on = await saveTemplate(f.ctx('owner'), null, { name: 'With doctor', language: 'en', body: 'See {doctor} on {date}.' });
    expect(on.ok).toBe(true);
    const back = await saveMessageOptions(f.ctx('owner'), { quietStart: '21:00', quietEnd: '08:00', doctorName: false });
    expect(back.ok ? '' : back.fieldErrors.doctorName).toMatch(/With doctor/);
    const bad = await saveMessageOptions(f.ctx('owner'), { quietStart: '21:00', quietEnd: '21:00', doctorName: true });
    expect(bad.ok).toBe(false);
  });

  it('editing wording that a rule uses must still fit that rule', async () => {
    const s = await getMessageSettings(f.ctx('owner'));
    const remind = s.templates.find((t) => t.name === 'Appointment reminder')!;
    const r = await saveTemplate(f.ctx('owner'), remind.id, { name: remind.name, language: 'en', body: 'You owe {amount_due}' });
    expect(r.ok ? '' : r.fieldErrors.body).toMatch(/amount_due/);
  });
});

describe("Today's messages", () => {
  let appt: string;
  let pid: string;

  it('right after booking: the confirmation is due, with time and place only', async () => {
    pid = await patient('Asha Kulkarni');
    const r = await bookAppointment(f.ctx('desk'), { patientId: pid, providerId: f.doctorId, date: D, time: '11:00', minutes: 0, reason: 'Secret RCT detail' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    appt = r.id;
    const [a] = await getDb().select().from(appointments).where(eq(appointments.id, appt));
    const now = new Date(afterQuiet(a!.createdAt, DEFAULT_QUIET).getTime() + 60_000);
    const q = await todaysMessages(f.ctx('desk'), f.pune.id, now);
    const mine = q.dueNow.filter((i) => i.patientId === pid);
    expect(mine.map((i) => i.ruleLabel)).toEqual(['Right after booking']);
    expect(mine[0]!.text).toContain('Namaste Asha');
    expect(mine[0]!.text).toContain('at 11:00');
    expect(mine[0]!.text).not.toContain('Secret');
    expect(mine[0]!.href).toMatch(/^https:\/\/wa\.me\/91/);
    // Send it: gone from the list, recorded once, audited; a second tap or a made-up key does nothing.
    await markMessage(f.ctx('desk'), f.pune.id, mine[0]!.key, 'sent', now);
    await markMessage(f.ctx('desk'), f.pune.id, mine[0]!.key, 'sent', now);
    await markMessage(f.ctx('desk'), f.pune.id, 'not-a-real-key', 'sent', now);
    expect((await todaysMessages(f.ctx('desk'), f.pune.id, now)).dueNow.filter((i) => i.patientId === pid)).toEqual([]);
    expect(await getDb().select().from(messageSends).where(and(eq(messageSends.orgId, f.orgId), eq(messageSends.patientId, pid)))).toHaveLength(1);
  });

  it('the day before at 12:00: the 1-day reminder is due; 2 hours before is tomorrow, not shown', async () => {
    const q = await todaysMessages(f.ctx('desk'), f.pune.id, ist(addDays(D, -1), '12:00'));
    const mine = q.dueNow.filter((i) => i.patientId === pid);
    expect(mine.map((i) => i.timing)).toEqual(['1 day before']);
    expect(q.laterToday.filter((i) => i.patientId === pid)).toEqual([]);
    // On the day at 08:30: the 2-hours-before one (09:00) is listed for later today.
    const morning = await todaysMessages(f.ctx('desk'), f.pune.id, ist(D, '08:30'));
    expect(morning.laterToday.filter((i) => i.patientId === pid).map((i) => i.timing)).toEqual(['2 hours before']);
  });

  it('STOP is honoured under every rule, and can be undone', async () => {
    await setMessagesStopped(f.ctx('desk'), pid, true);
    expect((await todaysMessages(f.ctx('desk'), f.pune.id, ist(addDays(D, -1), '12:00'))).dueNow.filter((i) => i.patientId === pid)).toEqual([]);
    await setMessagesStopped(f.ctx('desk'), pid, false);
    expect((await todaysMessages(f.ctx('desk'), f.pune.id, ist(addDays(D, -1), '12:00'))).dueNow.filter((i) => i.patientId === pid)).toHaveLength(1);
    await expect(setMessagesStopped(other.ctx('owner'), pid, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('moving the appointment re-plans (a fresh confirmation); cancelling drops everything', async () => {
    expect(await rescheduleAppointment(f.ctx('desk'), appt, { providerId: f.doctorId, date: D2, time: '12:00', minutes: 0, reason: '' })).toEqual({ ok: true, id: appt });
    const [a] = await getDb().select().from(appointments).where(eq(appointments.id, appt));
    const now = new Date(afterQuiet(a!.updatedAt, DEFAULT_QUIET).getTime() + 60_000);
    const moved = (await todaysMessages(f.ctx('desk'), f.pune.id, now)).dueNow.filter((i) => i.patientId === pid);
    expect(moved.map((i) => i.ruleLabel)).toEqual(['Right after booking']);
    expect(moved[0]!.text).toContain('at 12:00');
    await setAppointmentStatus(f.ctx('desk'), appt, 'cancelled', 'Patient travelling');
    expect((await todaysMessages(f.ctx('desk'), f.pune.id, now)).dueNow.filter((i) => i.patientId === pid)).toEqual([]);
    expect((await todaysMessages(f.ctx('desk'), f.pune.id, ist(addDays(D2, -1), '12:00'))).dueNow.filter((i) => i.patientId === pid)).toEqual([]);
  });

  it('money owed: 7 days after the bill, with the amount; paid-up patients get nothing; a paused rule stops it', async () => {
    const owes = await patient('Vikram Joshi');
    await issueBill(f.ctx('desk'), { patientId: owes, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    const at = ist(addDays(today, 7), '12:00');
    const q = await todaysMessages(f.ctx('desk'), f.pune.id, at);
    const mine = q.dueNow.filter((i) => i.patientId === owes);
    // Fixture RCT is ₹4,500, nothing paid.
    expect(mine.map((i) => i.about)).toEqual(['₹4,500.00 owed']);
    expect(mine[0]!.text).toContain('₹4,500.00 is pending');
    const duesRule = (await getMessageSettings(f.ctx('owner'))).rules.find((r) => r.trigger === 'dues')!;
    await setRuleActive(f.ctx('owner'), duesRule.id, false);
    expect((await todaysMessages(f.ctx('desk'), f.pune.id, at)).dueNow.filter((i) => i.patientId === owes)).toEqual([]);
    await setRuleActive(f.ctx('owner'), duesRule.id, true);
  });

  it('another clinic sees none of this', async () => {
    expect(await todaysMessages(other.ctx('desk'), other.pune.id, ist(addDays(today, 7), '12:00'))).toMatchObject({ configured: false });
    await expect(todaysMessages(other.ctx('desk'), f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
