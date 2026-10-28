import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { usageEvents } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { clampFormMs } from '@/domain/scorecard';
import { canAnywhere, type TenantContext } from './context';

/**
 * The Pilot 0 usage log (T26). These rows are telemetry for the scorecard,
 * not business writes, so they deliberately skip the audit wrapper: auditing
 * every dashboard view would bury the real audit trail. They hold only the
 * kind, who, which branch, a duration and a timestamp: never patient data,
 * names, phones or amounts.
 *
 * Recording must never break what the person was doing, so every failure is
 * swallowed and logged as a fixed line with no data in it.
 */

/** IST midnight at the start of an ISO business date, as an instant. */
export function istStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:30`);
}

function logFailure(kind: string): void {
  console.warn(`[usage] could not record ${kind}`);
}

/**
 * One dashboard_view per user per IST business day, for people who can see
 * branch reports. A single INSERT … WHERE NOT EXISTS; two renders racing in
 * the same instant could both insert, which the scorecard tolerates because
 * it counts distinct days.
 */
export async function recordDashboardView(ctx: TenantContext, now: Date = new Date()): Promise<void> {
  try {
    if (!canAnywhere(ctx, 'report.branch')) return;
    const today = businessDate(now);
    const from = istStart(today);
    const to = istStart(addDays(today, 1));
    const branchId = ctx.activeBranchId === 'all' ? null : ctx.activeBranchId;
    await getDb().execute(sql`
      insert into usage_events (org_id, branch_id, user_id, kind, occurred_at)
      select ${ctx.orgId}, ${branchId}, ${ctx.userId}, 'dashboard_view', ${now.toISOString()}::timestamptz
      where not exists (
        select 1 from usage_events e
        where e.org_id = ${ctx.orgId} and e.user_id = ${ctx.userId} and e.kind = 'dashboard_view'
          and e.occurred_at >= ${from.toISOString()}::timestamptz and e.occurred_at < ${to.toISOString()}::timestamptz
      )`);
  } catch {
    logFailure('dashboard_view');
  }
}

/** How long a successful registration took on the form. Missing or invalid durations are ignored. */
export async function recordRegistrationTime(ctx: TenantContext, branchId: string, formMs: unknown): Promise<void> {
  const durationMs = clampFormMs(formMs);
  if (durationMs === null) return;
  try {
    await getDb().insert(usageEvents).values({ orgId: ctx.orgId, branchId, userId: ctx.userId, kind: 'patient_register', durationMs });
  } catch {
    logFailure('patient_register');
  }
}

/** Someone opened the day-close summary in WhatsApp (T33). Kind, who, where, when: nothing else. */
export async function recordDaySummaryOpen(ctx: TenantContext, branchId: string): Promise<void> {
  if (!ctx.branchIds.includes(branchId)) return;
  try {
    await getDb().insert(usageEvents).values({ orgId: ctx.orgId, branchId, userId: ctx.userId, kind: 'day_summary_open' });
  } catch {
    logFailure('day_summary_open');
  }
}
