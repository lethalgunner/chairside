import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { catalogueItems } from '@/db/schema';
import {
  classifyImport,
  countImport,
  importPlan,
  importSummary,
  parseCatalogueImport,
  samePlan,
  type ExistingItem,
  type ImportCounts,
  type ImportPlan,
  type PreviewRow,
} from '@/domain/catalogue-import';
import { writeAudit } from './audit';
import { canAnywhere, ForbiddenError, type TenantContext } from './context';
import { isUniqueViolation } from './util';

/**
 * Paste the price list from Excel (Sprint 1, T25). The browser only ever sends
 * the pasted text: the preview and the save both parse it here, and the save
 * parses it again inside its own transaction, so a doctored preview can't
 * change what is written. Owner only (catalogue.manage), like single saves.
 */

export type ImportPreview =
  | { ok: true; rows: PreviewRow[]; counts: ImportCounts; summary: string; plan: ImportPlan }
  | { ok: false; error: string };

export type ImportSaveResult =
  | { ok: true; created: number; updated: number }
  | { ok: false; error: string; preview?: ImportPreview };

export const IMPORT_CHANGED = 'The price list changed after you pressed Check. Press Check again and look over the rows before saving.';
export const IMPORT_HAS_ERRORS = 'Some rows have errors, so nothing was saved. Fix them, paste again and press Check.';

function assertCatalogueManager(ctx: TenantContext): void {
  if (!canAnywhere(ctx, 'catalogue.manage')) throw new ForbiddenError();
}

async function existingByCode(db: DB | Tx, ctx: TenantContext, codes: string[], lock: boolean): Promise<Map<string, typeof catalogueItems.$inferSelect>> {
  if (codes.length === 0) return new Map();
  const q = db
    .select()
    .from(catalogueItems)
    .where(and(eq(catalogueItems.orgId, ctx.orgId), inArray(catalogueItems.code, codes)));
  const found = lock ? await q.for('update') : await q;
  return new Map(found.map((i) => [i.code, i]));
}

async function buildPreview(db: DB | Tx, ctx: TenantContext, text: string, lock: boolean) {
  const parsed = parseCatalogueImport(text);
  if (!parsed.ok) return { preview: { ok: false as const, error: parsed.error }, existing: new Map() };
  const codes = parsed.rows.flatMap((r) => (r.value ? [r.value.code] : []));
  const existing = await existingByCode(db, ctx, codes, lock);
  const rows = classifyImport(parsed.rows, existing as ReadonlyMap<string, ExistingItem>);
  const counts = countImport(rows);
  const preview: ImportPreview = { ok: true, rows, counts, summary: importSummary(counts), plan: importPlan(rows) };
  return { preview, existing };
}

/** What a paste would do, row by row. Writes nothing. */
export async function previewCatalogueImport(ctx: TenantContext, text: string): Promise<ImportPreview> {
  assertCatalogueManager(ctx);
  return (await buildPreview(getDb(), ctx, text, false)).preview;
}

/**
 * Save a paste, all or nothing, in one transaction. `confirmed` is the plan the
 * owner saw in the preview: if the server's own parse disagrees (a code was
 * added or edited in between, or the text changed), nothing is written.
 * Each item is audited exactly as a single save is.
 */
export async function saveCatalogueImport(ctx: TenantContext, text: string, confirmed: ImportPlan): Promise<ImportSaveResult> {
  assertCatalogueManager(ctx);
  try {
    return await getDb().transaction(async (tx) => {
      const { preview, existing } = await buildPreview(tx, ctx, text, true);
      if (!preview.ok) return { ok: false as const, error: preview.error };
      if (preview.counts.error > 0) return { ok: false as const, error: IMPORT_HAS_ERRORS, preview };
      if (!samePlan(preview.plan, confirmed)) return { ok: false as const, error: IMPORT_CHANGED, preview };

      const fresh = preview.rows.filter((r) => r.status === 'new').map((r) => r.value!);
      if (fresh.length > 0) {
        const inserted = await tx
          .insert(catalogueItems)
          .values(fresh.map((v) => ({ orgId: ctx.orgId, ...v })))
          .returning({ id: catalogueItems.id, code: catalogueItems.code });
        const idOf = new Map(inserted.map((r) => [r.code, r.id]));
        for (const v of fresh) await writeAudit(tx, ctx, { action: 'catalogue.create', entityType: 'catalogue_item', entityId: idOf.get(v.code)!, after: v });
      }

      const changes = preview.rows.filter((r) => r.status === 'update').map((r) => r.value!);
      for (const v of changes) {
        const item = existing.get(v.code)!;
        await tx.update(catalogueItems).set(v).where(and(eq(catalogueItems.id, item.id), eq(catalogueItems.orgId, ctx.orgId)));
        const { id: _id, orgId: _org, ...before } = item;
        await writeAudit(tx, ctx, { action: 'catalogue.update', entityType: 'catalogue_item', entityId: item.id, before, after: v });
      }
      return { ok: true as const, created: fresh.length, updated: changes.length };
    });
  } catch (err) {
    // Someone added one of these codes between our read and our insert.
    if (isUniqueViolation(err, 'catalogue_org_code_unique')) return { ok: false, error: IMPORT_CHANGED };
    throw err;
  }
}
