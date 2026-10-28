'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireContext } from '@/lib/auth';
import { parseRupeesInput, type Paise } from '@/domain/money';
import { closeDay, recordCashOut, reopenDay, type CloseDayInput } from '@/services/daybook';
import { issueBill, voidInvoice, type IssueBillInput, type IssueBillResult } from '@/services/invoices';
import { cancelReceipt, recordReceipt, type RecordReceiptInput, type RecordReceiptResult } from '@/services/receipts';
import { dismissProcedure } from '@/services/procedures';
import { UserFacingError } from '@/services/context';
import { run, type ActionResult } from './run';

/** A string argument from the client, or '' (which every service refuses) for anything else. */
function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function refresh() {
  revalidatePath('/', 'layout');
}

export async function issueBillAction(input: IssueBillInput): Promise<ActionResult<IssueBillResult>> {
  const ctx = await requireContext();
  const res = await run('bill.issue', () => issueBill(ctx, input));
  if (res.ok) refresh();
  return res;
}

export async function recordReceiptAction(input: RecordReceiptInput): Promise<ActionResult<RecordReceiptResult>> {
  const ctx = await requireContext();
  const res = await run('receipt.record', () => recordReceipt(ctx, input));
  if (res.ok) refresh();
  return res;
}

/** `workDone` answers "Was this work done?" on the cancel dialog (Q20, T28); it must be stated. */
export async function voidInvoiceAction(invoiceId: string, reason: string, workDone: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const res = await run('invoice.void', async () => {
    const answer = z.boolean().safeParse(workDone);
    if (!answer.success) throw new UserFacingError('Say whether the work on this bill was done.');
    await voidInvoice(ctx, text(invoiceId), text(reason), answer.data);
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

/** "Not done: remove" on the Unbilled list (Q20, T28). */
export async function dismissProcedureAction(procedureId: string, reason: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const res = await run('procedure.dismiss', async () => {
    await dismissProcedure(ctx, text(procedureId), text(reason));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function cancelReceiptAction(receiptId: string, reason: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const res = await run('receipt.cancel', async () => {
    await cancelReceipt(ctx, receiptId, reason);
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

function rupees(input: string, what: string): Paise {
  const r = parseRupeesInput(input, what);
  if (!r.ok) throw new UserFacingError(r.error);
  return r.paise;
}

export async function recordCashOutAction(amount: string, description: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const res = await run('cash.out', async () => {
    await recordCashOut(ctx, { amountPaise: rupees(amount, 'the amount'), description });
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function closeDayAction(input: {
  denominations: Record<string, number>;
  varianceReason?: string;
  legacyBillCount?: string;
  legacyCollected?: string;
}): Promise<ActionResult<{ variancePaise: number }>> {
  const ctx = await requireContext();
  const res = await run('day.close', async () => {
    const payload: CloseDayInput = {
      denominations: input.denominations,
      varianceReason: input.varianceReason,
      legacyBillCount: input.legacyBillCount ? Number(input.legacyBillCount) : null,
      legacyCollectedPaise: input.legacyCollected ? rupees(input.legacyCollected, 'the old system’s collection') : null,
    };
    const rec = await closeDay(ctx, payload);
    return { variancePaise: rec.variancePaise };
  });
  if (res.ok) refresh();
  return res;
}

export async function reopenDayAction(branchId: string, date: string, reason: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const res = await run('day.reopen', async () => {
    await reopenDay(ctx, { branchId, date, reason });
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}
