'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { ForbiddenError } from '@/services/context';
import { recordMovement, saveStockItem, setStockItemActive, type SaveStockResult } from '@/services/stock';
import { run, signedOut, type ActionResult } from './run';

/** Stock-lite (Sprint 6, LET-176). Thin wrappers; the service checks stock.manage and the branch. */

const id = z.string().uuid();
const s = (n: number) => z.string().max(n);
function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ForbiddenError();
  return r.data;
}

const item = z.object({ kind: s(20), name: s(200), unit: s(20), reorderLevel: s(10), medicineId: s(40), catalogueItemId: s(40) });

export async function saveStockItemAction(itemId: string | null, input: z.input<typeof item>): Promise<ActionResult<SaveStockResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('stock.item_save');
  const res = await run('stock.item_save', () => saveStockItem(ctx, itemId === null ? null : parse(id, itemId), parse(item, input)));
  if (res.ok && res.data.ok) revalidatePath('/stock');
  return res;
}

const movement = z.object({ kind: s(20), quantity: s(10), direction: z.enum(['in', 'out']), expiresOn: s(10), unitCost: s(20), reason: s(200) });

export async function recordMovementAction(itemId: string, input: z.input<typeof movement>): Promise<ActionResult<{ ok: true; onHand: number } | { ok: false; fieldErrors: Record<string, string> }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('stock.movement');
  const res = await run('stock.movement', () => recordMovement(ctx, parse(id, itemId), parse(movement, input)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

export async function setStockItemActiveAction(itemId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('stock.item_active');
  const res = await run('stock.item_active', async () => {
    await setStockItemActive(ctx, parse(id, itemId), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) revalidatePath('/stock');
  return res;
}
