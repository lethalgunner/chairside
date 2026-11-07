'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { ForbiddenError } from '@/services/context';
import { addStarterMedicines, saveMedicine, saveTemplate, setMedicineActive, setTemplateActive, writePrescription, type SaveResult, type WriteRxResult } from '@/services/rx';
import { run, signedOut, type ActionResult } from './run';

/** Medicines, templates and prescriptions (Sprint 5, LET-172/173). Thin wrappers. */

const id = z.string().uuid();
const str = (n: number) => z.string().max(n);
const medicine = z.object({ name: str(200), strength: str(60), form: str(30), dose: str(80), frequency: str(60), days: str(5), instructions: str(200) });
const dose = z.object({ dose: str(80), frequency: str(60), days: str(5), instructions: str(200) });

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ForbiddenError();
  return r.data;
}
const refresh = () => revalidatePath('/', 'layout');

export async function saveMedicineAction(medicineId: string | null, input: z.input<typeof medicine>): Promise<ActionResult<SaveResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('medicine.save');
  const res = await run('medicine.save', () => saveMedicine(ctx, medicineId === null ? null : parse(id, medicineId), parse(medicine, input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function setMedicineActiveAction(medicineId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('medicine.active');
  const res = await run('medicine.active', async () => {
    await setMedicineActive(ctx, parse(id, medicineId), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function addStarterMedicinesAction(): Promise<ActionResult<{ added: number }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('medicine.starter_list');
  const res = await run('medicine.starter_list', async () => ({ added: await addStarterMedicines(ctx) }));
  if (res.ok) refresh();
  return res;
}

const template = z.object({ name: str(200), catalogueItemId: str(40), advice: str(1000), lines: z.array(dose.extend({ medicineId: str(40) })).max(15) });

export async function saveTemplateAction(templateId: string | null, input: z.input<typeof template>): Promise<ActionResult<SaveResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('rx_template.save');
  const res = await run('rx_template.save', () => saveTemplate(ctx, templateId === null ? null : parse(id, templateId), parse(template, input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function setTemplateActiveAction(templateId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('rx_template.active');
  const res = await run('rx_template.active', async () => {
    await setTemplateActive(ctx, parse(id, templateId), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

const rx = z.object({
  patientId: z.string().uuid(),
  complaint: str(400),
  advice: str(1000),
  allergies: str(400),
  replacesId: z.string().uuid().nullable(),
  lines: z.array(dose.extend({ medicineId: str(40), name: str(200), strength: str(60), form: str(30) })).max(15),
});

export async function writePrescriptionAction(input: z.input<typeof rx>): Promise<ActionResult<WriteRxResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('prescription.sign');
  const res = await run('prescription.sign', () => writePrescription(ctx, parse(rx, input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}
