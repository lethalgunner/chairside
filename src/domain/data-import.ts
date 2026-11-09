import { checkBooking } from './appointments';
import { splitRecords } from './catalogue-import';
import { isIsoDate } from './dates';
import { normaliseIndianMobile } from './phone';
import { minutesOf } from './providers';

/**
 * Bring your data (Sprint 9, "switch in a day"): patients and future
 * appointments pasted from Excel or a CSV exported from the old software.
 * Columns are found by their header names, so most exports work as they
 * are; without a header the order below is assumed. Pure parsing and
 * checks only; the service matches against the clinic's data, shows a dry
 * run, and saves everything or nothing.
 *
 * Opening balances (money owed from the old system) are deliberately not
 * imported yet: how they enter the books is a decision for KS and the CA.
 */

export const DATA_IMPORT_MAX_ROWS = 1000;
export const DATA_IMPORT_MAX_BYTES = 400 * 1024;

export type ImportKind = 'patients' | 'appointments';

type Field = 'name' | 'mobile' | 'sex' | 'age' | 'dob' | 'date' | 'time' | 'doctor' | 'minutes';

export const PATIENT_COLUMNS: readonly Field[] = ['name', 'mobile', 'sex', 'age', 'dob'];
export const APPOINTMENT_COLUMNS: readonly Field[] = ['mobile', 'name', 'date', 'time', 'doctor', 'minutes'];
export const COLUMN_LABEL: Record<Field, string> = {
  name: 'Name',
  mobile: 'Mobile',
  sex: 'Sex (M/F/O)',
  age: 'Age',
  dob: 'Date of birth',
  date: 'Date',
  time: 'Time',
  doctor: 'Doctor',
  minutes: 'Minutes',
};

/** Header words other software uses for each column (lower case, letters only). */
const SYNONYMS: Record<Field, string[]> = {
  name: ['name', 'patientname', 'fullname', 'patient', 'nameofpatient', 'firstname'],
  mobile: ['mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'phonenumber', 'contact', 'contactno', 'contactnumber', 'cell', 'whatsapp'],
  sex: ['sex', 'gender'],
  age: ['age', 'ageyears', 'ageinyears'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'birthday'],
  date: ['date', 'appointmentdate', 'apptdate', 'day', 'scheduleddate', 'startdate'],
  time: ['time', 'appointmenttime', 'appttime', 'starttime', 'slot', 'from'],
  doctor: ['doctor', 'doctorname', 'provider', 'dentist', 'consultant', 'dr'],
  minutes: ['minutes', 'duration', 'durationmin', 'durationminutes', 'length', 'mins'],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Map header cells to fields; null when the row doesn't look like a header. */
export function headerMap(cells: string[], fields: readonly Field[]): Map<Field, number> | null {
  const map = new Map<Field, number>();
  cells.forEach((c, i) => {
    const n = norm(c);
    const f = fields.find((x) => !map.has(x) && SYNONYMS[x].includes(n));
    if (f) map.set(f, i);
  });
  return map.size >= 2 ? map : null;
}

export interface ParsedRow<T> {
  line: number;
  value: T | null;
  error: string | null;
}

export type Parsed<T> = { ok: true; header: boolean; rows: ParsedRow<T>[] } | { ok: false; error: string };

function records(text: string, kind: ImportKind): { ok: true; recs: { line: number; cells: string[] }[] } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: 'Paste the rows first.' };
  if (new TextEncoder().encode(text).length > DATA_IMPORT_MAX_BYTES) return { ok: false, error: `That's more than ${DATA_IMPORT_MAX_BYTES / 1024} KB. Import it in parts of up to ${DATA_IMPORT_MAX_ROWS} rows.` };
  const delimiter = text.includes('\t') ? '\t' : ',';
  const recs = splitRecords(text, delimiter).filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (recs.length === 0) return { ok: false, error: 'Paste the rows first.' };
  if (recs.length > DATA_IMPORT_MAX_ROWS + 1) return { ok: false, error: `Up to ${DATA_IMPORT_MAX_ROWS} ${kind} at a time. Import the rest in another go.` };
  return { ok: true, recs };
}

function columns(recs: { line: number; cells: string[] }[], fields: readonly Field[]) {
  const map = headerMap(recs[0]!.cells, fields);
  const order = map ?? new Map(fields.map((f, i) => [f, i] as const));
  const cell = (cells: string[], f: Field) => (order.has(f) ? (cells[order.get(f)!] ?? '').trim() : '');
  return { header: !!map, body: map ? recs.slice(1) : recs, cell, mapped: order };
}

/** "Dr. Anil Mehta" → "anil mehta": for matching doctor names across systems. */
export function doctorKey(name: string): string {
  return name.toLowerCase().replace(/^\s*(dr\.?|doctor)\s+/, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

/** dd/mm/yyyy, dd-mm-yyyy, dd.mm.yy and yyyy-mm-dd (Indian exports put the day first). */
export function readDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isIsoDate(iso)) return null;
  const back = new Date(`${iso}T00:00:00Z`);
  return back.getUTCDate() === d && back.getUTCMonth() + 1 === mo ? iso : null;
}

/** "11:00", "9:30", "4 pm", "04:30 PM" → "HH:MM" (24-hour). */
export function readTime(raw: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const ap = m[3]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (m[2] === undefined) return null;
  const out = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return minutesOf(out) === null ? null : out;
}

export interface PatientRow {
  fullName: string;
  phone: string;
  sex: 'F' | 'M' | 'O' | null;
  age: number | null;
  dateOfBirth: string | null;
}

function readSex(raw: string): 'F' | 'M' | 'O' | null | undefined {
  const s = norm(raw);
  if (!s) return null;
  if (['f', 'female', 'woman', 'w'].includes(s)) return 'F';
  if (['m', 'male', 'man'].includes(s)) return 'M';
  if (['o', 'other', 'others', 't', 'transgender'].includes(s)) return 'O';
  return undefined;
}

export function parsePatients(text: string, today: string): Parsed<PatientRow> {
  const r = records(text, 'patients');
  if (!r.ok) return r;
  const { header, body, cell } = columns(r.recs, PATIENT_COLUMNS);
  const rows = body.map(({ line, cells }): ParsedRow<PatientRow> => {
    const problems: string[] = [];
    const fullName = cell(cells, 'name').replace(/\s+/g, ' ');
    if (fullName.length < 2 || fullName.length > 120) problems.push('name is missing');
    const phone = normaliseIndianMobile(cell(cells, 'mobile'));
    if (!phone) problems.push('mobile isn’t a 10-digit Indian number');
    const sex = readSex(cell(cells, 'sex'));
    if (sex === undefined) problems.push('sex should be M, F or O (or blank)');
    const ageRaw = cell(cells, 'age');
    let age: number | null = null;
    if (ageRaw) {
      const n = Number(ageRaw.replace(/\s*(y|yr|yrs|years?)\.?$/i, ''));
      if (!Number.isInteger(n) || n < 0 || n > 120) problems.push('age should be 0 to 120');
      else age = n;
    }
    const dobRaw = cell(cells, 'dob');
    let dateOfBirth: string | null = null;
    if (dobRaw) {
      dateOfBirth = readDate(dobRaw);
      if (!dateOfBirth || dateOfBirth > today) problems.push('date of birth isn’t a past date like 21/03/1985');
    }
    if (problems.length) return { line, value: null, error: cap(problems.join('; ')) };
    return { line, value: { fullName, phone: phone!, sex: sex ?? null, age, dateOfBirth }, error: null };
  });
  return { ok: true, header, rows };
}

export interface AppointmentRow {
  phone: string;
  name: string;
  date: string;
  time: string;
  doctor: string;
  minutes: number | null;
}

export function parseAppointments(text: string): Parsed<AppointmentRow> {
  const r = records(text, 'appointments');
  if (!r.ok) return r;
  const { header, body, cell } = columns(r.recs, APPOINTMENT_COLUMNS);
  const rows = body.map(({ line, cells }): ParsedRow<AppointmentRow> => {
    const problems: string[] = [];
    const phone = normaliseIndianMobile(cell(cells, 'mobile'));
    if (!phone) problems.push('mobile isn’t a 10-digit Indian number');
    const name = cell(cells, 'name').replace(/\s+/g, ' ');
    const date = readDate(cell(cells, 'date'));
    if (!date) problems.push('date should look like 21/11/2026');
    const time = readTime(cell(cells, 'time'));
    if (!time) problems.push('time should look like 11:00 or 4:30 pm');
    const doctor = cell(cells, 'doctor');
    if (!doctor) problems.push('doctor is missing');
    const minRaw = cell(cells, 'minutes').replace(/\s*(m|min|mins|minutes)\.?$/i, '');
    let minutes: number | null = null;
    if (minRaw) {
      const n = Number(minRaw);
      if (!Number.isInteger(n) || n < 5 || n > 240 || n % 5 !== 0) problems.push('minutes should be 5 to 240, in 5s');
      else minutes = n;
    }
    if (problems.length) return { line, value: null, error: cap(problems.join('; ')) };
    return { line, value: { phone: phone!, name, date: date!, time: time!, doctor, minutes }, error: null };
  });
  return { ok: true, header, rows };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + '.';

/** Booking checks shared with the booking form (5-minute steps, length). Past dates are reported as skipped by the service. */
export function bookingFor(row: AppointmentRow, slotMinutes: number) {
  return checkBooking({ date: row.date, time: row.time, minutes: row.minutes ?? slotMinutes, reason: '' }, '0000-01-01');
}
