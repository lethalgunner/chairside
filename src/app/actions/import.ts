'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { ForbiddenError } from '@/services/context';
import { previewImport, saveImport, type DataImportResult, type DataPreview } from '@/services/data-import';
import { run, signedOut, type ActionResult } from './run';

/** Bring your data (Sprint 9). Thin: the service checks who may, parses and matches. */

const kind = z.enum(['patients', 'appointments']);
const text = z.string().max(450 * 1024);

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ForbiddenError();
  return r.data;
}

export async function previewImportAction(k: string, t: string): Promise<ActionResult<DataPreview>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('import.preview');
  return run('import.preview', () => previewImport(ctx, parse(kind, k), parse(text, t)));
}

export async function saveImportAction(k: string, t: string, expectNew: number): Promise<ActionResult<DataImportResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('import.save');
  const res = await run('import.save', () => saveImport(ctx, parse(kind, k), parse(text, t), parse(z.number().int().min(0).max(5000), expectNew)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}
