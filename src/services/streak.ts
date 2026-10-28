import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { dayBooks, invoices, receipts } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { closeStreak, type StreakDay } from '@/domain/streak';
import type { TenantContext } from './context';

/** How far back a streak is counted. A longer one shows as "60+". */
export const STREAK_WINDOW_DAYS = 60;

/**
 * Day-close streak per branch (Sprint 2, T35): consecutive days with
 * activity that were closed. Reads only dates and statuses; derived each
 * time, never stored. Branches the user can't see are dropped.
 */
export async function closeStreaks(ctx: TenantContext, branchIds: string[], today: string = businessDate()): Promise<Map<string, number>> {
  const ids = branchIds.filter((b) => ctx.branchIds.includes(b));
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const from = addDays(today, -STREAK_WINDOW_DAYS);
  const db = getDb();
  const [books, bills, pays] = await Promise.all([
    db
      .select({ b: dayBooks.branchId, d: dayBooks.businessDate, status: dayBooks.status })
      .from(dayBooks)
      .where(and(eq(dayBooks.orgId, ctx.orgId), inArray(dayBooks.branchId, ids), gte(dayBooks.businessDate, from), lte(dayBooks.businessDate, today))),
    db
      .selectDistinct({ b: invoices.branchId, d: invoices.issuedOn })
      .from(invoices)
      .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids), gte(invoices.issuedOn, from), lte(invoices.issuedOn, today))),
    db
      .selectDistinct({ b: receipts.branchId, d: receipts.receivedOn })
      .from(receipts)
      .where(and(eq(receipts.orgId, ctx.orgId), inArray(receipts.branchId, ids), isNull(receipts.cancelledAt), gte(receipts.receivedOn, from), lte(receipts.receivedOn, today))),
  ]);
  for (const id of ids) {
    const days = new Map<string, StreakDay>();
    const touch = (d: string) => days.get(d) ?? { date: d, active: false, closed: false };
    for (const r of [...bills, ...pays]) if (r.b === id) days.set(r.d, { ...touch(r.d), active: true });
    for (const r of books) if (r.b === id) days.set(r.d, { ...touch(r.d), active: true, closed: r.status === 'closed' });
    out.set(id, closeStreak([...days.values()], today));
  }
  return out;
}
