/**
 * Branch details and GSTIN rules (Pilot 0 slice 2, T16). Pure and unit-tested.
 *
 * UNVERIFIED until a CA confirms: the state-code table follows the GST state
 * code list as published (37 for Andhra Pradesh after 2014, 26 for the merged
 * Dadra and Nagar Haveli and Daman and Diu, 38 for Ladakh). The GSTIN check
 * here is format plus state code only; the check digit is not verified.
 */
import { fromRupeeString, type Paise } from './money';
import type { Checked, FieldErrors } from './staff';

/** GST state codes: the first two digits of every GSTIN registered in that state or UT. */
export const GST_STATE_CODES: Record<string, string> = {
  'Jammu and Kashmir': '01',
  'Himachal Pradesh': '02',
  Punjab: '03',
  Chandigarh: '04',
  Uttarakhand: '05',
  Haryana: '06',
  Delhi: '07',
  Rajasthan: '08',
  'Uttar Pradesh': '09',
  Bihar: '10',
  Sikkim: '11',
  'Arunachal Pradesh': '12',
  Nagaland: '13',
  Manipur: '14',
  Mizoram: '15',
  Tripura: '16',
  Meghalaya: '17',
  Assam: '18',
  'West Bengal': '19',
  Jharkhand: '20',
  Odisha: '21',
  Chhattisgarh: '22',
  'Madhya Pradesh': '23',
  Gujarat: '24',
  'Dadra and Nagar Haveli and Daman and Diu': '26',
  Maharashtra: '27',
  Karnataka: '29',
  Goa: '30',
  Lakshadweep: '31',
  Kerala: '32',
  'Tamil Nadu': '33',
  Puducherry: '34',
  'Andaman and Nicobar Islands': '35',
  Telangana: '36',
  'Andhra Pradesh': '37',
  Ladakh: '38',
};

export const STATES: readonly string[] = Object.keys(GST_STATE_CODES).sort((a, b) => a.localeCompare(b));

/** 2-digit state code, 10-character PAN, entity number, 'Z', check character. */
const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Null when the GSTIN is acceptable for a branch in this state, else a message for the owner. */
export function gstinProblem(gstin: string, state: string): string | null {
  if (!GSTIN_FORMAT.test(gstin)) return 'A GSTIN is 15 characters, like 27ABCDE1234F1Z5.';
  const code = GST_STATE_CODES[state];
  if (!code) return 'Pick the branch’s state first.';
  if (gstin.slice(0, 2) !== code) return `A GSTIN for ${state} starts with ${code}.`;
  return null;
}

export interface BranchDetailsInput {
  name: string;
  addressLine: string;
  city: string;
  state: string;
  phone: string;
  gstRegistered: boolean;
  gstin: string;
  /** Rupees as typed. */
  dayCloseTolerance: string;
  defaultFloat: string;
}

export interface BranchDetails {
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string;
  phone: string | null;
  gstRegistered: boolean;
  gstin: string | null;
  dayCloseTolerancePaise: Paise;
  defaultFloatPaise: Paise;
}

function rupeesField(raw: string, key: string, label: string, errors: FieldErrors): Paise | null {
  try {
    const v = fromRupeeString(raw);
    if (v < 0) {
      errors[key] = `${label} can’t be negative.`;
      return null;
    }
    return v;
  } catch {
    errors[key] = `Enter ${label.toLowerCase()} in rupees, like 100 or 2000.`;
    return null;
  }
}

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Validate an edit. The branch code is not here: it is in every document number and never changes. */
export function checkBranchDetails(input: BranchDetailsInput): Checked<BranchDetails> {
  const fieldErrors: FieldErrors = {};
  const name = tidy(input.name);
  if (name.length < 2 || name.length > 80) fieldErrors.name = 'Enter the branch name (2 to 80 characters).';
  const addressLine = tidy(input.addressLine) || null;
  if (addressLine && addressLine.length > 200) fieldErrors.addressLine = 'Keep the address under 200 characters.';
  const city = tidy(input.city) || null;
  if (city && city.length > 60) fieldErrors.city = 'Keep the city under 60 characters.';
  const state = input.state;
  if (!GST_STATE_CODES[state]) fieldErrors.state = 'Pick the state.';
  const phone = tidy(input.phone) || null;
  if (phone && !/^\+?[\d\s-]{6,20}$/.test(phone)) fieldErrors.phone = 'Use digits, spaces, dashes and an optional +.';

  const gstRegistered = input.gstRegistered;
  const gstinRaw = input.gstin.replace(/\s+/g, '').toUpperCase();
  let gstin: string | null = null;
  if (gstRegistered) {
    if (!gstinRaw) fieldErrors.gstin = 'A GST-registered branch needs its GSTIN.';
    else {
      const problem = gstinProblem(gstinRaw, state);
      if (problem) fieldErrors.gstin = problem;
      else gstin = gstinRaw;
    }
  }
  // An unregistered branch charges no GST and prints no GSTIN, so none is kept.

  const dayCloseTolerancePaise = rupeesField(input.dayCloseTolerance, 'dayCloseTolerance', 'The day-close tolerance', fieldErrors);
  const defaultFloatPaise = rupeesField(input.defaultFloat, 'defaultFloat', 'The opening float', fieldErrors);

  if (Object.keys(fieldErrors).length > 0 || dayCloseTolerancePaise === null || defaultFloatPaise === null) return { ok: false, fieldErrors };
  return { ok: true, value: { name, addressLine, city, state, phone, gstRegistered, gstin, dayCloseTolerancePaise, defaultFloatPaise } };
}
