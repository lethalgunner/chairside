import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Tx } from '@/db/client';
import { branches, catalogueItems, encounters, invoiceLines, invoices, patients, proceduresPerformed, providers, receipts, treatmentPlanItems, treatmentPlans } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import type { Paise } from '@/domain/money';
import { canMovePlan, checkPlanItem, checkPlanTitle, estimateRef, planTotals, type ItemStage, type PlanItemInput, type PlanStatus } from '@/domain/plans';
import type { FieldErrors } from '@/domain/staff';
import type { TaxCategory } from '@/domain/tax';
import { writeAudit } from './audit';
import { getBranch } from './branches';
import { listCatalogue } from './catalogue';
import { canDo, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { ensureDayOpen } from './daybook';
import { registerAtBranch } from './patients';
import { providerAtBranch } from './providers';
import { isUniqueViolation, isUuid } from './util';

/**
 * Treatment plans and estimates (Sprint 4, LET-168/169).
 *
 * Marking items done creates the existing `procedures_performed` rows at the
 * agreed price, so the plan's work shows under "Done, not billed" and is billed
 * by the normal bill: issueBill is unchanged. Done and billed are never stored
 * on the plan; they are read from the procedure and its invoice line.
 */

export interface PlanItemRow {
  id: string;
  catalogueItemId: string;
  name: string;
  code: string;
  toothNumber: string | null;
  quantity: number;
  unitPricePaise: Paise;
  listPricePaise: Paise | null;
  priceReason: string | null;
  session: number;
  stage: ItemStage;
  doneAt: Date | null;
  dropReason: string | null;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  gstRateBp: number;
}

export interface PlanRow {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  ref: string;
  title: string;
  status: PlanStatus;
  cancelReason: string | null;
  createdAt: Date;
  acceptedAt: Date | null;
  items: PlanItemRow[];
  totals: ReturnType<typeof planTotals>;
}

function assertPlan(ctx: TenantContext, branchId: string) {
  if (!canDo(ctx, 'plan.manage', branchId)) throw new ForbiddenError();
}

async function priceList(ctx: TenantContext, branchId: string, db?: Tx) {
  return new Map((await listCatalogue(ctx, branchId, db)).map((c) => [c.id, c]));
}

export type PlanItemsInput = PlanItemInput[];
export type SavePlanResult = { ok: true; id: string } | { ok: false; fieldErrors: FieldErrors; itemErrors?: Record<number, FieldErrors> };

/** Check every line against today's price list at the branch; errors come back per line. */
async function checkItems(ctx: TenantContext, branchId: string, items: PlanItemInput[], tx: Tx) {
  const list = await priceList(ctx, branchId, tx);
  const itemErrors: Record<number, FieldErrors> = {};
  const values = items.map((it, i) => {
    const c = isUuid(it.catalogueItemId) ? list.get(it.catalogueItemId) : undefined;
    if (!c) {
      itemErrors[i] = { catalogueItemId: 'That item is not in this branch’s price list.' };
      return null;
    }
    const r = checkPlanItem(it, c.pricePaise);
    if (!r.ok) {
      itemErrors[i] = r.fieldErrors;
      return null;
    }
    return r.value;
  });
  return { values, itemErrors };
}

/** A new plan, as a draft, at the active branch. */
export async function createPlan(ctx: TenantContext, input: { patientId: string; providerId: string; title: string; items: PlanItemInput[] }): Promise<SavePlanResult> {
  const branchId = requireActiveBranch(ctx);
  assertPlan(ctx, branchId);
  if (!isUuid(input.patientId)) throw new ForbiddenError();
  const title = checkPlanTitle(input.title);
  if (input.items.length === 0) return { ok: false, fieldErrors: { items: 'Add at least one treatment.' } };
  if (input.items.length > 40) return { ok: false, fieldErrors: { items: 'A plan holds at most 40 lines.' } };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getDb().transaction(async (tx) => {
        const [p] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.orgId, ctx.orgId))).limit(1);
        if (!p) throw new ForbiddenError();
        const doctor = await providerAtBranch(tx, ctx, input.providerId, branchId);
        const { values, itemErrors } = await checkItems(ctx, branchId, input.items, tx);
        const fieldErrors: FieldErrors = {};
        if (!title.ok) Object.assign(fieldErrors, title.fieldErrors);
        if (!doctor) fieldErrors.providerId = 'Pick a doctor who works at this branch.';
        if (Object.keys(fieldErrors).length > 0 || Object.keys(itemErrors).length > 0) return { ok: false as const, fieldErrors, itemErrors };
        const [next] = await tx
          .select({ n: sql<number>`coalesce(max(${treatmentPlans.estimateNumber}), 0)::int + 1` })
          .from(treatmentPlans)
          .where(eq(treatmentPlans.branchId, branchId));
        const [plan] = await tx
          .insert(treatmentPlans)
          .values({ orgId: ctx.orgId, branchId, patientId: p.id, doctorId: doctor!.id, estimateNumber: next?.n ?? 1, title: title.ok ? title.value : '', createdBy: ctx.userId })
          .returning({ id: treatmentPlans.id });
        for (const v of values) await tx.insert(treatmentPlanItems).values({ orgId: ctx.orgId, planId: plan!.id, ...v! });
        await writeAudit(tx, ctx, { action: 'plan.create', entityType: 'treatment_plan', entityId: plan!.id, branchId, after: { items: values.length, doctorId: doctor!.id } });
        return { ok: true as const, id: plan!.id };
      });
    } catch (err) {
      // Two plans took the same estimate number at once: take the next.
      if (isUniqueViolation(err, 'treatment_plans_branch_number_unique')) continue;
      throw err;
    }
  }
  throw new UserFacingError('Busy. Press again.');
}

async function lockPlan(tx: Tx, ctx: TenantContext, planId: string) {
  if (!isUuid(planId)) throw new ForbiddenError();
  const [plan] = await tx.select().from(treatmentPlans).where(and(eq(treatmentPlans.id, planId), eq(treatmentPlans.orgId, ctx.orgId))).for('update');
  if (!plan) throw new ForbiddenError();
  assertPlan(ctx, plan.branchId);
  return plan;
}

function assertEditable(status: string) {
  if (status === 'cancelled') throw new UserFacingError('This plan was cancelled. Start a new plan instead.');
  if (status === 'completed') throw new UserFacingError('This plan is completed. Reopen it first.');
}

/** Add lines to a draft or accepted plan. */
export async function addPlanItems(ctx: TenantContext, planId: string, items: PlanItemInput[]): Promise<SavePlanResult> {
  return getDb().transaction(async (tx) => {
    const plan = await lockPlan(tx, ctx, planId);
    assertEditable(plan.status);
    if (items.length === 0) return { ok: false as const, fieldErrors: { items: 'Add at least one treatment.' } as FieldErrors };
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(treatmentPlanItems).where(eq(treatmentPlanItems.planId, plan.id))) as [{ n: number }];
    if (n + items.length > 40) return { ok: false as const, fieldErrors: { items: 'A plan holds at most 40 lines.' } as FieldErrors };
    const { values, itemErrors } = await checkItems(ctx, plan.branchId, items, tx);
    if (Object.keys(itemErrors).length > 0) return { ok: false as const, fieldErrors: {} as FieldErrors, itemErrors };
    for (const v of values) await tx.insert(treatmentPlanItems).values({ orgId: ctx.orgId, planId: plan.id, ...v! });
    await writeAudit(tx, ctx, { action: 'plan.items_added', entityType: 'treatment_plan', entityId: plan.id, branchId: plan.branchId, after: { items: values } });
    return { ok: true as const, id: plan.id };
  });
}

async function lockItem(tx: Tx, ctx: TenantContext, itemId: string) {
  if (!isUuid(itemId)) throw new ForbiddenError();
  const [item] = await tx.select().from(treatmentPlanItems).where(and(eq(treatmentPlanItems.id, itemId), eq(treatmentPlanItems.orgId, ctx.orgId))).for('update');
  if (!item) throw new ForbiddenError();
  const plan = await lockPlan(tx, ctx, item.planId);
  return { item, plan };
}

/** Change a line that hasn't been done yet: tooth, quantity, agreed price (with a reason if it differs), sitting. */
export async function updatePlanItem(ctx: TenantContext, itemId: string, input: Omit<PlanItemInput, 'catalogueItemId'>): Promise<{ ok: true } | { ok: false; fieldErrors: FieldErrors }> {
  return getDb().transaction(async (tx) => {
    const { item, plan } = await lockItem(tx, ctx, itemId);
    assertEditable(plan.status);
    if (item.status !== 'planned') throw new UserFacingError('Only work that is still to do can be changed.');
    const c = (await priceList(ctx, plan.branchId, tx)).get(item.catalogueItemId);
    const r = checkPlanItem({ ...input, catalogueItemId: item.catalogueItemId }, (c?.pricePaise ?? item.unitPricePaise) as Paise);
    if (!r.ok) return r;
    const { catalogueItemId: _c, ...v } = r.value;
    await tx.update(treatmentPlanItems).set(v).where(and(eq(treatmentPlanItems.id, item.id), eq(treatmentPlanItems.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, {
      action: 'plan.item_changed',
      entityType: 'treatment_plan',
      entityId: plan.id,
      branchId: plan.branchId,
      before: { itemId: item.id, toothNumber: item.toothNumber, quantity: item.quantity, unitPricePaise: item.unitPricePaise, session: item.session },
      after: { itemId: item.id, ...v },
    });
    return { ok: true as const };
  });
}

/** Take a line off the plan (with a reason). Done work is corrected on the Unbilled page or by cancelling its bill. */
export async function dropPlanItem(ctx: TenantContext, itemId: string, reason: string): Promise<void> {
  const why = reason.trim().replace(/\s+/g, ' ');
  if (why.length < 3) throw new UserFacingError('Say why this is dropped (at least 3 characters).');
  if (why.length > 120) throw new UserFacingError('Keep the reason under 120 characters.');
  await getDb().transaction(async (tx) => {
    const { item, plan } = await lockItem(tx, ctx, itemId);
    assertEditable(plan.status);
    if (item.status !== 'planned') throw new UserFacingError('Only work that is still to do can be dropped.');
    await tx.update(treatmentPlanItems).set({ status: 'dropped', dropReason: why }).where(and(eq(treatmentPlanItems.id, item.id), eq(treatmentPlanItems.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, { action: 'plan.item_dropped', entityType: 'treatment_plan', entityId: plan.id, branchId: plan.branchId, after: { itemId: item.id, reason: why } });
  });
}

/** Accept (patient agreed), complete, reopen, or cancel (with a reason; done work stays). */
export async function setPlanStatus(ctx: TenantContext, planId: string, to: PlanStatus, reason = ''): Promise<void> {
  const why = reason.trim().replace(/\s+/g, ' ');
  if (to === 'cancelled' && why.length < 3) throw new UserFacingError('Say why the plan is cancelled (at least 3 characters).');
  await getDb().transaction(async (tx) => {
    const plan = await lockPlan(tx, ctx, planId);
    if (plan.status === to) return;
    if (!canMovePlan(plan.status as PlanStatus, to)) throw new UserFacingError(`A ${plan.status} plan can’t be marked ${to}.`);
    await tx
      .update(treatmentPlans)
      .set({ status: to, cancelReason: to === 'cancelled' ? why.slice(0, 120) : plan.cancelReason, acceptedAt: to === 'accepted' && !plan.acceptedAt ? new Date() : plan.acceptedAt })
      .where(and(eq(treatmentPlans.id, plan.id), eq(treatmentPlans.orgId, ctx.orgId)));
    if (to === 'cancelled') {
      await tx.update(treatmentPlanItems).set({ status: 'dropped', dropReason: 'Plan cancelled' }).where(and(eq(treatmentPlanItems.planId, plan.id), eq(treatmentPlanItems.status, 'planned')));
    }
    await writeAudit(tx, ctx, { action: `plan.${to}`, entityType: 'treatment_plan', entityId: plan.id, branchId: plan.branchId, before: { status: plan.status }, after: { status: to, reason: why || undefined } });
  });
}

/**
 * Mark plan lines done today, by a doctor at the plan's branch. Each becomes a
 * procedure at the agreed price ("Done, not billed" until billed). A draft
 * plan is accepted by doing work on it. The day must be open.
 */
export async function markItemsDone(ctx: TenantContext, planId: string, itemIds: string[], providerId?: string): Promise<{ done: number }> {
  if (itemIds.length === 0 || itemIds.length > 40 || !itemIds.every(isUuid)) throw new UserFacingError('Tick the work that was done.');
  return getDb().transaction(async (tx) => {
    const plan = await lockPlan(tx, ctx, planId);
    assertEditable(plan.status);
    if (ctx.activeBranchId !== plan.branchId) throw new UserFacingError('Switch to this plan’s branch to record work on it.');
    const date = businessDate();
    const branch = await getBranch(ctx, plan.branchId, tx);
    await ensureDayOpen(tx, { orgId: ctx.orgId, branchId: plan.branchId, branchName: branch.name, date, defaultFloatPaise: branch.defaultFloatPaise });
    const doctor = await providerAtBranch(tx, ctx, providerId ?? plan.doctorId, plan.branchId);
    if (!doctor) throw new UserFacingError('Pick a doctor who works at this branch.');
    const items = await tx
      .select()
      .from(treatmentPlanItems)
      .where(and(eq(treatmentPlanItems.planId, plan.id), inArray(treatmentPlanItems.id, itemIds)))
      .for('update');
    if (items.length !== new Set(itemIds).size || items.some((i) => i.status !== 'planned')) throw new UserFacingError('Some of that work is already done or dropped. Refresh the page.');
    await registerAtBranch(tx, ctx.orgId, { id: branch.id, code: branch.code }, plan.patientId);
    const [enc] = await tx.insert(encounters).values({ orgId: ctx.orgId, branchId: plan.branchId, patientId: plan.patientId, doctorId: doctor.id, occurredOn: date }).returning({ id: encounters.id });
    for (const i of items) {
      const [proc] = await tx
        .insert(proceduresPerformed)
        .values({ orgId: ctx.orgId, branchId: plan.branchId, encounterId: enc!.id, patientId: plan.patientId, doctorId: doctor.id, catalogueItemId: i.catalogueItemId, quantity: i.quantity, unitPricePaise: i.unitPricePaise, toothNumber: i.toothNumber })
        .returning({ id: proceduresPerformed.id });
      await tx.update(treatmentPlanItems).set({ status: 'done', procedureId: proc!.id, doneAt: new Date() }).where(eq(treatmentPlanItems.id, i.id));
    }
    if (plan.status === 'draft') await tx.update(treatmentPlans).set({ status: 'accepted', acceptedAt: new Date() }).where(eq(treatmentPlans.id, plan.id));
    await writeAudit(tx, ctx, { action: 'plan.items_done', entityType: 'treatment_plan', entityId: plan.id, branchId: plan.branchId, after: { itemIds: items.map((i) => i.id), encounterId: enc!.id, doctorId: doctor.id } });
    return { done: items.length };
  });
}

/** A plan line marked done whose procedure was later removed as "not done" goes back to planned. */
function stageOf(status: string, procDismissed: boolean, billed: boolean): ItemStage {
  if (status === 'dropped') return 'dropped';
  if (status === 'planned' || procDismissed) return 'planned';
  return billed ? 'billed' : 'done_unbilled';
}

/** Plans for a patient (newest first), or one plan by id, with stages and totals. */
export async function listPlans(ctx: TenantContext, filter: { patientId?: string; planId?: string }): Promise<PlanRow[]> {
  if ((filter.patientId && !isUuid(filter.patientId)) || (filter.planId && !isUuid(filter.planId))) return [];
  const db = getDb();
  const plans = await db
    .select({ p: treatmentPlans, branchName: branches.name, branchCode: branches.code, gstRegistered: branches.gstRegistered, gstin: branches.gstin, state: branches.state, patientName: patients.fullName, doctorName: providers.fullName })
    .from(treatmentPlans)
    .innerJoin(branches, eq(branches.id, treatmentPlans.branchId))
    .innerJoin(patients, eq(patients.id, treatmentPlans.patientId))
    .innerJoin(providers, eq(providers.id, treatmentPlans.doctorId))
    .where(
      and(
        eq(treatmentPlans.orgId, ctx.orgId),
        inArray(treatmentPlans.branchId, ctx.branchIds),
        filter.patientId ? eq(treatmentPlans.patientId, filter.patientId) : undefined,
        filter.planId ? eq(treatmentPlans.id, filter.planId) : undefined,
      ),
    )
    .orderBy(desc(treatmentPlans.createdAt))
    .limit(50);
  if (plans.length === 0) return [];
  const items = await db
    .select({
      i: treatmentPlanItems,
      name: catalogueItems.name,
      code: catalogueItems.code,
      listPrice: catalogueItems.defaultPricePaise,
      taxCategory: catalogueItems.taxCategory,
      hsnSacCode: catalogueItems.hsnSacCode,
      gstRateBp: catalogueItems.gstRateBp,
      dismissed: sql<boolean>`${proceduresPerformed.dismissedAt} is not null`,
      billed: sql<boolean>`${invoices.status} = 'issued'`,
    })
    .from(treatmentPlanItems)
    .innerJoin(catalogueItems, eq(catalogueItems.id, treatmentPlanItems.catalogueItemId))
    .leftJoin(proceduresPerformed, eq(proceduresPerformed.id, treatmentPlanItems.procedureId))
    .leftJoin(invoiceLines, eq(invoiceLines.id, proceduresPerformed.invoiceLineId))
    .leftJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(treatmentPlanItems.orgId, ctx.orgId), inArray(treatmentPlanItems.planId, plans.map((p) => p.p.id))))
    .orderBy(asc(treatmentPlanItems.session), asc(treatmentPlanItems.createdAt));
  return plans.map(({ p, ...b }) => {
    const mine: PlanItemRow[] = items
      .filter((r) => r.i.planId === p.id)
      .map((r) => ({
        id: r.i.id,
        catalogueItemId: r.i.catalogueItemId,
        name: r.name,
        code: r.code,
        toothNumber: r.i.toothNumber,
        quantity: r.i.quantity,
        unitPricePaise: r.i.unitPricePaise as Paise,
        listPricePaise: r.listPrice as Paise,
        priceReason: r.i.priceReason,
        session: r.i.session,
        stage: stageOf(r.i.status, !!r.dismissed, !!r.billed),
        doneAt: r.i.doneAt,
        dropReason: r.i.dropReason,
        taxCategory: r.taxCategory as TaxCategory,
        hsnSacCode: r.hsnSacCode,
        gstRateBp: r.gstRateBp,
      }));
    return {
      id: p.id,
      branchId: p.branchId,
      branchName: b.branchName,
      branchCode: b.branchCode,
      patientId: p.patientId,
      patientName: b.patientName,
      doctorId: p.doctorId,
      doctorName: b.doctorName,
      ref: estimateRef(b.branchCode, p.estimateNumber),
      title: p.title,
      status: p.status as PlanStatus,
      cancelReason: p.cancelReason,
      createdAt: p.createdAt,
      acceptedAt: p.acceptedAt,
      items: mine,
      totals: planTotals(
        mine.map((i) => ({ stage: i.stage, quantity: i.quantity, unitPricePaise: i.unitPricePaise, description: i.name, taxCategory: i.taxCategory, hsnSacCode: i.hsnSacCode, gstRateBp: i.gstRateBp })),
        { gstRegistered: b.gstRegistered, gstin: b.gstin, state: b.state },
      ),
    };
  });
}

export async function getPlan(ctx: TenantContext, planId: string): Promise<PlanRow | null> {
  return (await listPlans(ctx, { planId }))[0] ?? null;
}

/**
 * The patient's work card (LET-169): rupees still to do on open plans, work
 * done but not billed (plan or not), billed and paid. All derived.
 */
export async function patientWork(ctx: TenantContext, patientId: string) {
  if (!isUuid(patientId)) return null;
  const plans = (await listPlans(ctx, { patientId })).filter((p) => p.status !== 'cancelled');
  const db = getDb();
  const [unbilled] = await db
    .select({ n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${proceduresPerformed.unitPricePaise} * ${proceduresPerformed.quantity}), 0)::bigint` })
    .from(proceduresPerformed)
    .where(and(eq(proceduresPerformed.orgId, ctx.orgId), eq(proceduresPerformed.patientId, patientId), inArray(proceduresPerformed.branchId, ctx.branchIds), isNull(proceduresPerformed.invoiceLineId), isNull(proceduresPerformed.dismissedAt)));
  const [billed] = await db
    .select({ v: sql<number>`coalesce(sum(${invoices.totalPaise}), 0)::bigint` })
    .from(invoices)
    .where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.patientId, patientId), inArray(invoices.branchId, ctx.branchIds), eq(invoices.status, 'issued')));
  const [paid] = await db
    .select({ v: sql<number>`coalesce(sum(${receipts.amountPaise}), 0)::bigint` })
    .from(receipts)
    .where(and(eq(receipts.orgId, ctx.orgId), eq(receipts.patientId, patientId), inArray(receipts.branchId, ctx.branchIds), isNull(receipts.cancelledAt)));
  const pending = plans.flatMap((p) => p.items.filter((i) => i.stage === 'planned' && p.status !== 'completed').map((i) => ({ ...i, planId: p.id, planTitle: p.title })));
  return {
    todoPaise: pending.reduce((s, i) => s + i.unitPricePaise * i.quantity, 0) as Paise,
    pending,
    doneUnbilledCount: unbilled?.n ?? 0,
    doneUnbilledPaise: Number(unbilled?.v ?? 0) as Paise,
    openPlans: plans.filter((p) => p.status === 'draft' || p.status === 'accepted').length,
    billedPaise: Number(billed?.v ?? 0) as Paise,
    paidPaise: Number(paid?.v ?? 0) as Paise,
  };
}
