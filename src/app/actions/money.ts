'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/auth';
import { fromRupeeString, type Paise } from '@/domain/money';
import { closeDay, recordCashOut, reopenDay, type CloseDayInput } from '@/services/daybook';
import { issueBill, voidInvoice, type IssueBillInput, type IssueBillResult } from '@/services/invoices';
import { cancelReceipt, recordReceipt, type RecordReceiptInput, type RecordReceiptResult } from '@/services/receipts';
import { UserFacingError } from '@/services/context';
import { run, type ActionResult } from './run';

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

export async function voidInvoiceAction(invoiceId: string, reason: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const res = await run('invoice.void', async () => {
    await voidInvoice(ctx, invoiceId, reason);
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
  try {
    return fromRupeeString(input);
  } catch {
    throw new UserFacingError(`Enter ${what} in rupees, like 1500 or 1500.50.`);
  }
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
