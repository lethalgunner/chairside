/**
 * Medicines, prescription templates and prescriptions (Sprint 5, LET-172/173).
 * Pure rules. A signed prescription is never edited: a correction is a new
 * prescription that replaces it. Doses here are what the doctor writes; we
 * make no clinical checks beyond the allergy note (no interaction claims).
 */
import type { Checked, FieldErrors } from './staff';

export const MEDICINE_FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'mouthwash', 'gel', 'paste', 'ointment', 'drops', 'injection', 'toothpaste', 'other'] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];
export const FORM_LABEL: Record<MedicineForm, string> = {
  tablet: 'Tablet', capsule: 'Capsule', syrup: 'Syrup', suspension: 'Suspension', mouthwash: 'Mouthwash', gel: 'Gel', paste: 'Oral paste', ointment: 'Ointment', drops: 'Drops', injection: 'Injection', toothpaste: 'Toothpaste', other: 'Other',
};

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

export interface MedicineInput {
  name: string;
  strength: string;
  form: string;
  dose: string;
  frequency: string;
  days: string;
  instructions: string;
}

export interface MedicineValues {
  name: string;
  strength: string | null;
  form: MedicineForm;
  dose: string | null;
  frequency: string | null;
  days: number | null;
  instructions: string | null;
}

export interface DoseInput {
  dose: string;
  frequency: string;
  days: string;
  instructions: string;
}

export interface DoseValues {
  dose: string | null;
  frequency: string | null;
  days: number | null;
  instructions: string | null;
}

/** Dose words are free text within limits; days is 1–365 or empty (e.g. SOS). */
export function checkDose(input: DoseInput, fieldErrors: FieldErrors, prefix = ''): DoseValues {
  const dose = tidy(input.dose);
  if (dose.length > 40) fieldErrors[`${prefix}dose`] = 'Keep the dose under 40 characters, like “1 tablet”.';
  const frequency = tidy(input.frequency);
  if (frequency.length > 30) fieldErrors[`${prefix}frequency`] = 'Keep it short, like 1-0-1 or “twice a day”.';
  const daysRaw = input.days.trim();
  let days: number | null = null;
  if (daysRaw) {
    if (!/^\d{1,3}$/.test(daysRaw) || Number(daysRaw) < 1 || Number(daysRaw) > 365) fieldErrors[`${prefix}days`] = 'Days is a number from 1 to 365, or empty.';
    else days = Number(daysRaw);
  }
  const instructions = tidy(input.instructions);
  if (instructions.length > 80) fieldErrors[`${prefix}instructions`] = 'Keep instructions under 80 characters.';
  return { dose: dose || null, frequency: frequency || null, days, instructions: instructions || null };
}

export function checkMedicine(input: MedicineInput): Checked<MedicineValues> {
  const fieldErrors: FieldErrors = {};
  const name = tidy(input.name);
  if (name.length < 2 || name.length > 80) fieldErrors.name = 'Enter the medicine name (2 to 80 characters).';
  const strength = tidy(input.strength);
  if (strength.length > 30) fieldErrors.strength = 'Keep the strength short, like 500 mg.';
  const form = MEDICINE_FORMS.find((f) => f === input.form);
  if (!form) fieldErrors.form = 'Pick the form.';
  const dose = checkDose(input, fieldErrors);
  if (Object.keys(fieldErrors).length > 0 || !form) return { ok: false, fieldErrors };
  return { ok: true, value: { name, strength: strength || null, form, ...dose } };
}

export interface RxLineInput extends DoseInput {
  medicineId: string;
  /** Typed when the medicine isn't on the list. */
  name: string;
  strength: string;
  form: string;
}

export interface RxLineValues extends DoseValues {
  medicineId: string | null;
  name: string;
  strength: string | null;
  form: MedicineForm | null;
}

export interface RxInput {
  complaint: string;
  advice: string;
  lines: RxLineInput[];
}

/**
 * Check a prescription. Each line needs a medicine (from the list, or typed)
 * and either a frequency or instructions, so it can be followed. Up to 15 lines.
 */
export function checkPrescription(input: RxInput): Checked<{ complaint: string | null; advice: string | null; lines: RxLineValues[] }> {
  const fieldErrors: FieldErrors = {};
  const complaint = tidy(input.complaint);
  if (complaint.length > 200) fieldErrors.complaint = 'Keep the complaint or diagnosis under 200 characters.';
  const advice = input.advice.trim();
  if (advice.length > 500) fieldErrors.advice = 'Keep advice under 500 characters.';
  if (input.lines.length === 0) fieldErrors.lines = 'Add at least one medicine.';
  if (input.lines.length > 15) fieldErrors.lines = 'A prescription holds at most 15 medicines.';
  const lines = input.lines.map((l, i) => {
    const p = `lines.${i}.`;
    const name = tidy(l.name);
    if (name.length < 2 || name.length > 80) fieldErrors[`${p}name`] = 'Enter the medicine name.';
    const strength = tidy(l.strength);
    if (strength.length > 30) fieldErrors[`${p}strength`] = 'Keep the strength short.';
    const form = MEDICINE_FORMS.find((f) => f === l.form) ?? null;
    const dose = checkDose(l, fieldErrors, p);
    if (!dose.frequency && !dose.instructions) fieldErrors[`${p}frequency`] = 'Say how often, like 1-0-1, or how to use it.';
    return { medicineId: l.medicineId || null, name, strength: strength || null, form, ...dose };
  });
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { complaint: complaint || null, advice: advice || null, lines } };
}

export function checkAllergies(raw: string): Checked<string | null> {
  const v = tidy(raw);
  if (v.length > 200) return { ok: false, fieldErrors: { allergies: 'Keep allergies under 200 characters.' } };
  return { ok: true, value: v || null };
}

/** "1-0-1" → "morning and night"; other text is shown as written. For the printed prescription. */
export function frequencyWords(f: string | null): string {
  if (!f) return '';
  const m = /^(\d|½)-(\d|½)-(\d|½)$/.exec(f);
  if (!m) return f;
  const parts = [m[1] !== '0' ? 'morning' : null, m[2] !== '0' ? 'afternoon' : null, m[3] !== '0' ? 'night' : null].filter(Boolean) as string[];
  if (parts.length === 0) return f;
  const said = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${f} (${said})`;
}

/** Prescription reference, e.g. RX/PUN/0012. */
export function rxRef(branchCode: string, n: number): string {
  return `RX/${branchCode}/${String(n).padStart(4, '0')}`;
}
