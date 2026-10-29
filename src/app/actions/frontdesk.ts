'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { ForbiddenError } from '@/services/context';
import { closeRecall, logRecallReminder, setRecall } from '@/services/recalls';
import { addToQueue, moveVisit } from '@/services/visits';
import { run, signedOut, type ActionResult } from './run';

/** Waiting room (T36) and recalls (T37). Thin: parse, then the service checks and audits. */

const id = z.string().uuid();
const status = z.enum(['waiting', 'in_chair', 'done', 'left']);

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ForbiddenError();
  return r.data;
}

export async function addToQueueAction(patientId: string): Promise<ActionResult<{ token: number }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('visit.add');
  const res = await run('visit.add', async () => ({ token: (await addToQueue(ctx, parse(id, patientId))).token }));
  if (res.ok) revalidatePath('/queue');
  return res;
}

export async function moveVisitAction(visitId: string, to: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('visit.move');
  const res = await run('visit.move', async () => {
    await moveVisit(ctx, parse(id, visitId), parse(status, to));
    return undefined;
  });
  if (res.ok) revalidatePath('/queue');
  return res;
}

export async function setRecallAction(patientId: string, kind: string, dueOn: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('recall.set');
  const res = await run('recall.set', async () => {
    await setRecall(ctx, parse(id, patientId), parse(z.string().max(20), kind), parse(z.string().max(10), dueOn));
    return undefined;
  });
  if (res.ok) revalidatePath('/recalls');
  return res;
}

export async function closeRecallAction(recallId: string, outcome: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('recall.close');
  const res = await run('recall.close', async () => {
    await closeRecall(ctx, parse(id, recallId), parse(z.enum(['done', 'cancelled']), outcome));
    return undefined;
  });
  if (res.ok) revalidatePath('/recalls');
  return res;
}

export async function logRecallReminderAction(recallId: string): Promise<ActionResult<{ sentAt: string }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('recall.remind');
  return run('recall.remind', async () => ({ sentAt: (await logRecallReminder(ctx, parse(id, recallId))).remindedAt.toISOString() }));
}
