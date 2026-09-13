'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { addPatient, findPossibleDuplicates, BRANCH } from '@/lib/seed';

export interface RegisterResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
}

/**
 * Register a walk-in.
 *
 * Validation here is deliberately thin — name, mobile, sex and an age. Everything
 * else a clinic might eventually want (address, email, medical history, consent)
 * is captured later, because a front desk with a patient standing in front of
 * them will abandon any form that asks for more than this.
 */
export async function registerPatient(
  _prev: RegisterResult | null,
  formData: FormData,
): Promise<RegisterResult> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const sex = String(formData.get('sex') ?? '').trim();
  const ageRaw = String(formData.get('age') ?? '').trim();
  const referralSource = String(formData.get('referralSource') ?? 'Walk-in').trim();
  const referralDetail = String(formData.get('referralDetail') ?? '').trim();
  const acknowledgedDuplicate = formData.get('acknowledgedDuplicate') === 'yes';

  const fieldErrors: Record<string, string> = {};

  if (fullName.length < 2) {
    fieldErrors.fullName = 'Enter the patient’s name.';
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 10) {
    fieldErrors.phone = 'A mobile number is 10 digits.';
  } else if (!/^[6-9]/.test(digits)) {
    fieldErrors.phone = 'Indian mobile numbers start with 6, 7, 8 or 9.';
  }

  if (!sex) {
    fieldErrors.sex = 'Pick one.';
  }

  const age = Number(ageRaw);
  if (!ageRaw || !Number.isFinite(age) || age < 0 || age > 120) {
    fieldErrors.age = 'Enter an age between 0 and 120.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  // A duplicate is not an error to block on — the front desk may genuinely be
  // registering a second family member on one number. But it must be seen and
  // acknowledged, not silently created.
  if (!acknowledgedDuplicate) {
    const dupes = findPossibleDuplicates(phone, fullName);
    if (dupes.length > 0) {
      return {
        ok: false,
        message: `${dupes.length} existing record${dupes.length > 1 ? 's' : ''} may be the same person.`,
      };
    }
  }

  const patient = addPatient({
    fullName,
    phone,
    sex,
    age: Math.round(age),
    branchId: BRANCH.id,
    referralSource,
    referralDetail: referralDetail || undefined,
  });

  revalidatePath('/patients');
  revalidatePath('/');
  redirect(`/patients/${patient.id}?welcome=1`);
}
