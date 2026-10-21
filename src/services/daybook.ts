import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Tx } from '@/db/client';
import { dayBooks, expenses, invoices, receipts } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import {
  countFromDenominations,
  reconcileDay,
  type DayReconciliation,
  type PaymentMode,
} from '@/domain/ledger';
import { add, ZERO, type Paise } from '@/domain/money';
import { getBranch } from './branches';
import { assertCan, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { writeAudit } from './audit';
import { toInt, toPaise } from './util';

export type DayStatus = 'open' | 'reconciling' | 'closed' | 'reopened';

/**
 * Make sure today's book exists and is open, and hold a share lock on it for
 * the rest of the transaction. Closing takes an exclusive lock on the same row,
 * so a receipt and a close can never interleave.
 */
export async function ensureDayOpen(
  tx: Tx,
  params: { orgId: string; branchId: string; branchName: string; date: string; defaultFloatPaise: Paise },
): Promise<void> {
  await tx
    .insert(dayBooks)
    .values({
      orgId: params.orgId,
      branchId: params.branchId,
      businessDate: params.date,
      status: 'open',
      openingFloatPaise: params.defaultFloatPaise,
    })
    .onConflictDoNothing({ target: [dayBooks.branchId, dayBooks.businessDate] });
  const [row] = await tx
    .select({ status: dayBooks.status })
    .from(dayBooks)
    .where(and(eq(dayBooks.branchId, params.branchId), eq(dayBooks.businessDate, params.date)))
    .for('share');
  if (row?.status === 'closed') {
    throw new UserFacingError(
      `${params.branchName}'s day book for today is closed. Ask the owner to reopen it before adding anything.`,
    );
  }
}

export interface DaySummary {
  branchId: string;
  branchName: string;
  date: string;
  status: DayStatus;
  openingFloatPaise: Paise;
  byMode: Record<PaymentMode, Paise>;
  totalCollectedPaise: Paise;
  cashOutPaise: Paise;
  cashOutEntries: { id: string; description: string; amountPaise: Paise }[];
  expectedCashPaise: Paise;
  billCount: number;
  billedPaise: Paise;
  tolerancePaise: Paise;
  closed: null | {
    countedCashPaise: Paise;
    variancePaise: Paise;
    varianceReason: string | null;
    denominations: Record<string, number>;
    closedAt: Date | null;
    legacyBillCount: number | null;
    legacyCollectedPaise: Paise | null;
  };
  reopenReason: string | null;
}

export async function getDaySummary(ctx: TenantContext, branchId: string, date = businessDate()): Promise<DaySummary> {
  assertCan(ctx, 'day.close', branchId);
  const branch = await getBranch(ctx, branchId);
  const db = getDb();

  const [book] = await db
    .select()
    .from(dayBooks)
    .where(and(eq(dayBooks.orgId, ctx.orgId), eq(dayBooks.branchId, branchId), eq(dayBooks.businessDate, date)))
    .limit(1);

  const modeRows = await db
    .select({ mode: receipts.mode, total: sql<string>`sum(${receipts.amountPaise})` })
    .from(receipts)
    .where(and(eq(receipts.orgId, ctx.orgId), eq(receipts.branchId, branchId), eq(receipts.receivedOn, date), isNull(receipts.cancelledAt)))
    .groupBy(receipts.mode);

  const cashOut = await db
    .select({ id: expenses.id, description: expenses.description, category: expenses.category, amount: expenses.amountPaise })
    .from(expenses)
    .where(
      and(
        eq(expenses.orgId, ctx.orgId),
        eq(expenses.branchId, branchId),
        eq(expenses.incurredOn, date),
        eq(expenses.paidFromDrawer, true),
      ),
    );

  const [billed] = await db
    .select({ n: sql<string>`count(*)`, total: sql<string>`coalesce(sum(${invoices.totalPaise}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.orgId, ctx.orgId),
        eq(invoices.branchId, branchId),
        eq(invoices.issuedOn, date),
        eq(invoices.status, 'issued'),
      ),
    );

  const opening = (book?.openingFloatPaise ?? branch.defaultFloatPaise) as Paise;
  const cashOutPaise = add(...cashOut.map((c) => c.amount as Paise));
  const preview = reconcileDay({
    receipts: modeRows.map((r) => ({ mode: r.mode as PaymentMode, amountPaise: toPaise(r.total) })),
    openingFloatPaise: opening,
    cashExpensesPaise: cashOutPaise,
    countedCashPaise: ZERO,
    tolerancePaise: branch.dayCloseTolerancePaise,
  });

  return {
    branchId,
    branchName: branch.name,
    date,
    status: (book?.status ?? 'open') as DayStatus,
    openingFloatPaise: opening,
    byMode: preview.byMode,
    totalCollectedPaise: preview.totalCollectedPaise,
    cashOutPaise,
    cashOutEntries: cashOut.map((c) => ({
      id: c.id,
      description: c.description ?? c.category,
      amountPaise: c.amount as Paise,
    })),
    expectedCashPaise: preview.expectedCashPaise,
    billCount: toInt(billed?.n),
    billedPaise: toPaise(billed?.total),
    tolerancePaise: branch.dayCloseTolerancePaise,
    closed:
      book && (book.status === 'closed' || book.closedAt)
        ? {
            countedCashPaise: (book.countedCashPaise ?? 0) as Paise,
            variancePaise: (book.variancePaise ?? 0) as Paise,
            varianceReason: book.varianceReason,
            denominations: book.denominationCount ?? {},
            closedAt: book.closedAt,
            legacyBillCount: book.legacyBillCount,
            legacyCollectedPaise: (book.legacyCollectedPaise ?? null) as Paise | null,
          }
        : null,
    reopenReason: book?.reopenReason ?? null,
  };
}

export async function recordCashOut(
  ctx: TenantContext,
  input: { amountPaise: Paise; description: string },
): Promise<void> {
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, 'expense.record_cash', branchId);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new UserFacingError('Enter the amount paid out.');
  }
  const description = input.description.trim();
  if (description.length < 2) throw new UserFacingError('Say what the cash was paid for.');
  const branch = await getBranch(ctx, branchId);
  const date = businessDate();
  await getDb().transaction(async (tx) => {
    await ensureDayOpen(tx, { orgId: ctx.orgId, branchId, branchName: branch.name, date, defaultFloatPaise: branch.defaultFloatPaise });
    const [row] = await tx
      .insert(expenses)
      .values({
        orgId: ctx.orgId,
        branchId,
        category: 'petty_cash',
        description,
        amountPaise: input.amountPaise,
        incurredOn: date,
        paidOn: date,
        paidFromDrawer: true,
        createdBy: ctx.userId,
      })
      .returning({ id: expenses.id });
    await writeAudit(tx, ctx, { action: 'cash_out.record', entityType: 'expense', entityId: row!.id, branchId, after: { amountPaise: input.amountPaise } });
  });
}

export interface CloseDayInput {
  denominations: Record<string, number>;
  varianceReason?: string;
  legacyBillCount?: number | null;
  legacyCollectedPaise?: Paise | null;
}

export async function closeDay(ctx: TenantContext, input: CloseDayInput): Promise<DayReconciliation> {
  const branchId = requireActiveBranch(ctx);
  assertCan(ctx, 'day.close', branchId);
  const branch = await getBranch(ctx, branchId);
  const date = businessDate();
  let counted: Paise;
  try {
    counted = countFromDenominations(input.denominations);
  } catch (e) {
    throw new UserFacingError((e as Error).message);
  }
  if (input.legacyBillCount != null && (!Number.isInteger(input.legacyBillCount) || input.legacyBillCount < 0)) {
    throw new UserFacingError('Bills in the old system must be a whole number.');
  }

  return getDb().transaction(async (tx) => {
    await tx
      .insert(dayBooks)
      .values({ orgId: ctx.orgId, branchId, businessDate: date, status: 'open', openingFloatPaise: branch.defaultFloatPaise })
      .onConflictDoNothing({ target: [dayBooks.branchId, dayBooks.businessDate] });
    const [book] = await tx
      .select()
      .from(dayBooks)
      .where(and(eq(dayBooks.branchId, branchId), eq(dayBooks.businessDate, date)))
      .for('update');
    if (!book) throw new Error('Day book missing after insert');
    if (book.status === 'closed') throw new UserFacingError('Today is already closed.');

    const modeRows = await tx
      .select({ mode: receipts.mode, total: sql<string>`sum(${receipts.amountPaise})` })
      .from(receipts)
      .where(and(eq(receipts.branchId, branchId), eq(receipts.receivedOn, date), isNull(receipts.cancelledAt)))
      .groupBy(receipts.mode);
    const [cash] = await tx
      .select({ total: sql<string>`coalesce(sum(${expenses.amountPaise}), 0)` })
      .from(expenses)
      .where(and(eq(expenses.branchId, branchId), eq(expenses.incurredOn, date), eq(expenses.paidFromDrawer, true)));

    const rec = reconcileDay({
      receipts: modeRows.map((r) => ({ mode: r.mode as PaymentMode, amountPaise: toPaise(r.total) })),
      openingFloatPaise: book.openingFloatPaise as Paise,
      cashExpensesPaise: toPaise(cash?.total),
      countedCashPaise: counted,
      tolerancePaise: branch.dayCloseTolerancePaise,
    });
    const reason = input.varianceReason?.trim() || null;
    if (rec.requiresExplanation && (!reason || reason.length < 5)) {
      throw new UserFacingError('The cash is off by more than the allowed amount. Write what happened before closing.');
    }

    await tx
      .update(dayBooks)
      .set({
        status: 'closed',
        expectedCashPaise: rec.expectedCashPaise,
        countedCashPaise: counted,
        variancePaise: rec.variancePaise,
        varianceReason: reason,
        denominationCount: input.denominations,
        closedBy: ctx.userId,
        closedAt: new Date(),
        legacyBillCount: input.legacyBillCount ?? null,
        legacyCollectedPaise: input.legacyCollectedPaise ?? null,
      })
      .where(eq(dayBooks.id, book.id));
    await writeAudit(tx, ctx, {
      action: 'day.close',
      entityType: 'day_book',
      entityId: book.id,
      branchId,
      after: { date, variancePaise: rec.variancePaise, countedCashPaise: counted },
    });
    return rec;
  });
}

export async function reopenDay(ctx: TenantContext, input: { branchId: string; date: string; reason: string }): Promise<void> {
  assertCan(ctx, 'day.reopen', input.branchId);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new UserFacingError('Say why the day is being reopened.');
  await getDb().transaction(async (tx) => {
    const [book] = await tx
      .select()
      .from(dayBooks)
      .where(and(eq(dayBooks.orgId, ctx.orgId), eq(dayBooks.branchId, input.branchId), eq(dayBooks.businessDate, input.date)))
      .for('update');
    if (!book || book.status !== 'closed') throw new UserFacingError('That day is not closed.');
    await tx
      .update(dayBooks)
      .set({ status: 'reopened', reopenedBy: ctx.userId, reopenedAt: new Date(), reopenReason: reason })
      .where(eq(dayBooks.id, book.id));
    await writeAudit(tx, ctx, {
      action: 'day.reopen',
      entityType: 'day_book',
      entityId: book.id,
      branchId: input.branchId,
      before: { status: book.status, countedCashPaise: book.countedCashPaise, variancePaise: book.variancePaise },
      after: { status: 'reopened', reason },
    });
  });
}
