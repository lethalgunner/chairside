'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { ForbiddenError } from '@/services/context';
import { addPlanItems, createPlan, dropPlanItem, markItemsDone, setPlanStatus, updatePlanItem, type SavePlanResult } from '@/services/plans';
import { run, signedOut, type ActionResult } from './run';

/** Treatment plans (Sprint 4, LET-168). Thin: parse, then the service checks plan.manage, branch, prices and audit. */

const id = z.string().uuid();
const item = z.object({
  catalogueItemId: z.string().max(40),
  toothNumber: z.string().max(40),
  quantity: z.number().int(),
  price: z.string().max(30),
  priceReason: z.string().max(200),
  session: z.number().int(),
});
const items = z.array(item).max(40);

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ForbiddenError();
  return r.data;
}
const refresh = () => revalidatePath('/', 'layout');

export async function createPlanAction(input: { patientId: string; providerId: string; title: string; items: z.input<typeof items> }): Promise<ActionResult<SavePlanResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('plan.create');
  const res = await run('plan.create', () =>
    createPlan(ctx, { patientId: parse(id, input.patientId), providerId: parse(z.string().max(40), input.providerId), title: parse(z.string().max(200), input.title), items: parse(items, input.items) }),
  );
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function addPlanItemsAction(planId: string, input: z.input<typeof items>): Promise<ActionResult<SavePlanResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('plan.items_added');
  const res = await run('plan.items_added', () => addPlanItems(ctx, parse(id, planId), parse(items, input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function updatePlanItemAction(itemId: string, input: Omit<z.input<typeof item>, 'catalogueItemId'>): Promise<ActionResult<{ ok: true } | { ok: false; fieldErrors: Record<string, string> }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('plan.item_changed');
  const res = await run('plan.item_changed', () => updatePlanItem(ctx, parse(id, itemId), parse(item.omit({ catalogueItemId: true }), input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function dropPlanItemAction(itemId: string, reason: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('plan.item_dropped');
  const res = await run('plan.item_dropped', async () => {
    await dropPlanItem(ctx, parse(id, itemId), parse(z.string().max(200), reason));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function setPlanStatusAction(planId: string, to: string, reason = ''): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('plan.status');
  const res = await run('plan.status', async () => {
    await setPlanStatus(ctx, parse(id, planId), parse(z.enum(['accepted', 'completed', 'cancelled']), to), parse(z.string().max(200), reason));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function markItemsDoneAction(planId: string, itemIds: string[], providerId: string): Promise<ActionResult<{ done: number }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('plan.items_done');
  const res = await run('plan.items_done', () => markItemsDone(ctx, parse(id, planId), parse(z.array(id).max(40), itemIds), parse(id, providerId)));
  if (res.ok) refresh();
  return res;
}
