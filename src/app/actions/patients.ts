'use server';

import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/auth';
import { registerPatient, updatePatient, type PatientSummary } from '@/services/patients';
import { run, signedOut } from './run';

export interface RegisterFormState {
  fieldErrors?: Record<string, string>;
  duplicates?: PatientSummary[];
  error?: string;
  createdId?: string;
  /** The session ran out (T29); useActionForm sends the desk to sign in and back. */
  signedOut?: true;
}

export async function registerPatientAction(input: {
  fullName: string;
  phone: string;
  sex: string;
  age: string;
  referralSource: string;
  referralDetail?: string;
  acknowledgedDuplicate: boolean;
  /** Milliseconds the form was open before this submit (T26 usage log). */
  formMs?: number;
}): Promise<RegisterFormState> {
  const ctx = await getContext();
  if (!ctx) return signedOut('patient.register');
  const res = await run('patient.register', () =>
    registerPatient(ctx, {
      fullName: input.fullName,
      phone: input.phone,
      sex: input.sex as 'F' | 'M' | 'O',
      age: input.age === '' ? Number.NaN : Number(input.age),
      referralSource: input.referralSource,
      referralDetail: input.referralDetail,
      acknowledgedDuplicate: input.acknowledgedDuplicate,
      formMs: input.formMs,
    }),
  );
  if (!res.ok) return { error: res.error };
  if (!res.data.ok) return { fieldErrors: res.data.fieldErrors, duplicates: res.data.duplicates };
  revalidatePath('/patients');
  return { createdId: res.data.patientId };
}

/** Fix a patient's details (Sprint 3, T38). Same answer shape as registration. */
export async function editPatientAction(
  patientId: string,
  input: { fullName: string; phone: string; sex: string; age: string; referralSource: string; referralDetail?: string; acknowledgedDuplicate: boolean },
): Promise<RegisterFormState> {
  const ctx = await getContext();
  if (!ctx) return signedOut('patient.edit');
  const res = await run('patient.edit', () =>
    updatePatient(ctx, patientId, {
      fullName: input.fullName,
      phone: input.phone,
      sex: input.sex as 'F' | 'M' | 'O',
      age: input.age === '' ? Number.NaN : Number(input.age),
      referralSource: input.referralSource,
      referralDetail: input.referralDetail,
      acknowledgedDuplicate: input.acknowledgedDuplicate,
    }),
  );
  if (!res.ok) return { error: res.error };
  if (!res.data.ok) return { fieldErrors: res.data.fieldErrors, duplicates: res.data.duplicates };
  revalidatePath('/patients');
  revalidatePath(`/patients/${patientId}`);
  return { createdId: patientId };
}
