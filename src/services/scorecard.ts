import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { branches, dayBooks, invoices, memberships, receipts, usageEvents } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import type { Paise } from '@/domain/money';
import { scoreScope, type CriterionResult, type ScoreDay } from '@/domain/scorecard';
import { canDo, ForbiddenError, type TenantContext } from './context';
import { istStart } from './usage';
import { toInt, toPaise } from './util';

export interface ScorecardScope {
  /** Branch id, or 'total' for every branch in view together. */
  id: string;
  name: string;
  criteria: CriterionResult[];
}

export interface Scorecard {
  from: string;
  to: string;
  /** Total first when more than one branch is in view, then each branch by name. */
  scopes: ScorecardScope[];
}

export const SCORECARD_REFUSED = 'The pilot scorecard is for the owner, branch managers, the accountant and the auditor.';

/** Business date of a timestamptz in IST, as YYYY-MM-DD. */
const istDate = sql<string>`to_char(${usageEvents.occurredAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;

/**
 * The Pilot 0 scorecard (T26) for `from`..`to` (inclusive business dates)
 * over the branches given, keeping only those where the user holds
 * report.branch. Every query filters by org, so another org's rows never count.
 */
export async function pilotScorecard(ctx: TenantContext, branchIds: string[], from: string, to: string = businessDate()): Promise<Scorecard> {
  const ids = branchIds.filter((b) => canDo(ctx, 'report.branch', b));
  if (ids.length === 0) throw new ForbiddenError(SCORECARD_REFUSED);
  const db = getDb();
  const startAt = istStart(from);
  const endAt = istStart(addDays(to, 1));

  const names = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, ids)))
    .orderBy(asc(branches.name));
  const books = await db
    .select({ b: dayBooks.branchId, d: dayBooks.businessDate, status: dayBooks.status, legacyN: dayBooks.legacyBillCount, legacyP: dayBooks.legacyCollectedPaise })
    .from(dayBooks)
    .where(and(eq(dayBooks.orgId, ctx.orgId), inArray(dayBooks.branchId, ids), gte(dayBooks.businessDate, from), lte(dayBooks.businessDate, to)));
  // Chairside bills: issued and not cancelled (a cancelled bill has status 'void').
  const bills = await db
    .select({ b: invoices.branchId, d: invoices.issuedOn, n: sql<string>`count(*)` })
    .from(invoices)
    .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.branchId, ids), eq(invoices.status, 'issued'), gte(invoices.issuedOn, from), lte(invoices.issuedOn, to)))
    .groupBy(invoices.branchId, invoices.issuedOn);
  const cash = await db
    .select({ b: receipts.branchId, d: receipts.receivedOn, t: sql<string>`sum(${receipts.amountPaise})` })
    .from(receipts)
    .where(and(eq(receipts.orgId, ctx.orgId), inArray(receipts.branchId, ids), isNull(receipts.cancelledAt), gte(receipts.receivedOn, from), lte(receipts.receivedOn, to)))
    .groupBy(receipts.branchId, receipts.receivedOn);
  const regs = await db
    .select({ b: usageEvents.branchId, ms: usageEvents.durationMs })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.orgId, ctx.orgId),
        eq(usageEvents.kind, 'patient_register'),
        gte(usageEvents.occurredAt, startAt),
        lt(usageEvents.occurredAt, endAt),
        inArray(usageEvents.branchId, ids),
      ),
    );
  // Criterion 4 asks about the owner specifically, so this reads the role on
  // purpose. It is a measurement of who looked, not a permission check (ADR-009
  // governs permission checks, which stay capability-based).
  const ownerViews = await db
    .selectDistinct({ d: istDate })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.orgId, ctx.orgId),
        eq(usageEvents.kind, 'dashboard_view'),
        gte(usageEvents.occurredAt, startAt),
        lt(usageEvents.occurredAt, endAt),
        inArray(
          usageEvents.userId,
          db.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.role, 'owner'))),
        ),
      ),
    );
  const ownerViewDates = new Set(ownerViews.map((v) => v.d));

  // One ScoreDay per branch-day with a bill, a payment or a day book.
  const keys = new Set<string>([...books, ...bills, ...cash].map((r) => `${r.b}|${r.d}`));
  const days = new Map<string, ScoreDay[]>(ids.map((id) => [id, []]));
  for (const k of keys) {
    const [branchId, date] = k.split('|') as [string, string];
    const book = books.find((x) => x.b === branchId && x.d === date);
    days.get(branchId)?.push({
      date,
      billCount: toInt(bills.find((x) => x.b === branchId && x.d === date)?.n),
      collectedPaise: toPaise(cash.find((x) => x.b === branchId && x.d === date)?.t),
      legacyBillCount: book?.legacyN ?? null,
      legacyCollectedPaise: (book?.legacyP ?? null) as Paise | null,
      closed: book?.status === 'closed',
    });
  }
  const msFor = (branchId: string | null) => regs.filter((r) => (branchId === null || r.b === branchId) && r.ms !== null).map((r) => r.ms!);

  const perBranch: ScorecardScope[] = names.map(({ id, name }) => ({
    id,
    name,
    criteria: scoreScope({ days: days.get(id) ?? [], registrationMs: msFor(id), ownerViewDates }),
  }));
  if (perBranch.length < 2) return { from, to, scopes: perBranch };
  const total: ScorecardScope = {
    id: 'total',
    name: 'All branches in view',
    criteria: scoreScope({ days: [...days.values()].flat(), registrationMs: msFor(null), ownerViewDates, unit: 'branch-days' }),
  };
  return { from, to, scopes: [total, ...perBranch] };
}
