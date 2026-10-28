'use server';

import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { ForbiddenError } from '@/services/context';
import { logReminder } from '@/services/reminders';
import { recordDaySummaryOpen } from '@/services/usage';
import { run, signedOut, type ActionResult } from './run';

const id = z.string().uuid();

/** The desk opened a WhatsApp dues reminder (T32). Logs it; the link itself was built on the server. */
export async function logReminderAction(patientId: string, branchId: string): Promise<ActionResult<{ sentAt: string }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('patient.remind');
  return run('patient.remind', async () => {
    const p = id.safeParse(patientId);
    const b = id.safeParse(branchId);
    if (!p.success || !b.success) throw new ForbiddenError();
    const r = await logReminder(ctx, p.data, b.data);
    return { sentAt: r.sentAt.toISOString() };
  });
}

/** The day summary was opened in WhatsApp (T33). Usage log only; never fails the person. */
export async function daySummaryOpenedAction(branchId: string): Promise<void> {
  const ctx = await getContext();
  if (!ctx) return;
  const b = id.safeParse(branchId);
  if (b.success) await recordDaySummaryOpen(ctx, b.data);
}
