'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/auth';
import { registerPatient, type PatientSummary } from '@/services/patients';
import { run } from './run';

export interface RegisterFormState {
  fieldErrors?: Record<string, string>;
  duplicates?: PatientSummary[];
  error?: string;
  createdId?: string;
}

export async function registerPatientAction(input: {
  fullName: string;
  phone: string;
  sex: string;
  age: string;
  referralSource: string;
  referralDetail?: string;
  acknowledgedDuplicate: boolean;
}): Promise<RegisterFormState> {
  const ctx = await requireContext();
  const res = await run('patient.register', () =>
    registerPatient(ctx, {
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
  return { createdId: res.data.patientId };
}
