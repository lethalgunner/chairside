/**
 * Paste the price list from Excel (Sprint 1, T25). Pure: the server parses and
 * classifies every paste itself, for the preview and again inside the save
 * transaction, so nothing the browser says about a row is trusted.
 *
 * Columns, in order: Code, Name, Category, Price (₹), GST treatment, HSN/SAC,
 * GST %. A header row is optional. Tab-separated (what Excel and Google Sheets
 * put on the clipboard) or comma-separated, with "quoted" fields either way.
 * Every row then goes through checkCatalogueItem, the same validator as the
 * item form, so a pasted item can never be something the form would refuse.
 *
 * UNVERIFIED (Q6): the GST words below only pick a treatment; the rates are
 * whatever the clinic pastes, within GST_RATES_BP, until a CA confirms them.
 */
import { checkCatalogueItem, GST_RATES_BP, TAX_CATEGORIES, type CatalogueItemInput, type CatalogueItemValues } from './catalogue';
import type { Paise } from './money';
import type { FieldErrors } from './staff';
import { CATEGORY_DEFAULTS, type TaxCategory } from './tax';

/** CTO limits for one paste. */
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 200 * 1024;

export const IMPORT_COLUMNS = ['Code', 'Name', 'Category', 'Price (₹)', 'GST treatment', 'HSN/SAC', 'GST %'] as const;

/** Field key → column name, for messages like "Price (₹): Enter the price…". */
export const IMPORT_FIELD_LABELS: Record<string, string> = {
  row: 'Row',
  code: 'Code',
  name: 'Name',
  category: 'Category',
  price: 'Price (₹)',
  taxCategory: 'GST treatment',
  hsnSacCode: 'HSN/SAC',
  gstRateBp: 'GST %',
};

const TREATMENT_HELP = 'Use exempt, prosthetic, retail, cosmetic or other.';

/** Simple words staff use for each treatment. Whole-cell matches only, so "non-exempt" is never read as exempt. */
const TREATMENT_WORDS: Record<string, TaxCategory> = {
  exempt: 'exempt_healthcare',
  healthcare: 'exempt_healthcare',
  'exempt healthcare': 'exempt_healthcare',
  prosthetic: 'goods_prosthetic',
  implant: 'goods_prosthetic',
  crown: 'goods_prosthetic',
  retail: 'goods_retail',
  product: 'goods_retail',
  cosmetic: 'cosmetic_service',
  other: 'other_taxable',
  // The names the price list itself shows under each item (CategoryLabel in
  // src/components/ui.tsx), so a list copied out of Chairside pastes back in (QA 28 Oct).
  'healthcare service': 'exempt_healthcare',
  'prosthetic / implant': 'goods_prosthetic',
  'prosthetic/implant': 'goods_prosthetic',
  'retail product': 'goods_retail',
  'cosmetic service': 'cosmetic_service',
  'other taxable': 'other_taxable',
};

function squash(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

/** The tax category a cell names (enum value, the form's label, or a simple word), else null. */
export function readTreatment(raw: string): TaxCategory | null {
  const s = squash(raw);
  if (!s) return null;
  for (const c of TAX_CATEGORIES) if (squash(c) === s || squash(CATEGORY_DEFAULTS[c].label) === s) return c;
  return TREATMENT_WORDS[s] ?? null;
}

/** "18", "18%", "18 %", "18.0" → 1800 bp. Null for anything else (the validator then explains). */
export function readGstPercent(raw: string): number | null {
  const m = /^(\d{1,3})(?:\.0+)?\s*%?$/.exec(raw.trim());
  return m ? Number(m[1]) * 100 : null;
}

/** Bytes as the server receives them (UTF-8), not JavaScript string length. */
export function pasteBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The size check, shared by the browser (before sending) and the server. */
export function checkPasteSize(text: string): string | null {
  const bytes = pasteBytes(text);
  if (bytes > IMPORT_MAX_BYTES) {
    return `This paste is too large (${Math.ceil(bytes / 1024)} KB). Paste at most ${IMPORT_MAX_BYTES / 1024} KB, about ${IMPORT_MAX_ROWS} rows, at a time.`;
  }
  return null;
}

interface PastedRecord {
  line: number;
  cells: string[];
}

/**
 * Split text into records. Quotes work as Excel writes them: a field that
 * starts with " runs to the next lone ", "" is a literal quote, and a quoted
 * field may hold the delimiter or a line break.
 */
export function splitRecords(text: string, delimiter: '\t' | ','): PastedRecord[] {
  const out: PastedRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let line = 1;
  let startLine = 1;
  let i = 0;
  let atFieldStart = true;
  const s = text.replace(/\r\n?/g, '\n');
  const endRecord = () => {
    cells.push(cell);
    out.push({ line: startLine, cells });
    cells = [];
    cell = '';
    atFieldStart = true;
    startLine = line;
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (atFieldStart && ch === '"') {
      // Quoted field.
      i += 1;
      for (;;) {
        if (i >= s.length) break;
        const q = s[i]!;
        if (q === '"') {
          if (s[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (q === '\n') line += 1;
        cell += q;
        i += 1;
      }
      atFieldStart = false;
      continue;
    }
    atFieldStart = false;
    if (ch === delimiter) {
      cells.push(cell);
      cell = '';
      atFieldStart = true;
    } else if (ch === '\n') {
      line += 1;
      endRecord();
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (cell !== '' || cells.length > 0) endRecord();
  return out;
}

const HEADER_WORDS = new Set([
  'code', 'itemcode', 'name', 'itemname', 'item', 'treatment', 'description', 'category', 'price', 'pricers', 'priceinr', 'rate', 'mrp',
  'gsttreatment', 'taxcategory', 'tax', 'hsnsac', 'hsn', 'sac', 'hsnsaccode', 'hsncode', 'saccode', 'gst', 'gstrate', 'gstpercent',
]);

/** A header row names at least two of the columns. A data row never does (codes are 1 to 12 letters, prices are numbers). */
export function looksLikeHeader(cells: string[]): boolean {
  const hits = cells.filter((c) => HEADER_WORDS.has(c.toLowerCase().replace(/[^a-z]/g, ''))).length;
  return hits >= 2;
}

export interface ImportRow {
  /** Line in the pasted text where the row starts, so staff can find it in Excel. */
  line: number;
  /** The seven cells as pasted, trimmed. */
  cells: string[];
  /** The validated item, or null when the row has errors. */
  value: CatalogueItemValues | null;
  /** Column key → plain message; `row` for whole-row problems. */
  errors: FieldErrors;
}

export type ParsedPaste = { ok: true; header: boolean; rows: ImportRow[] } | { ok: false; error: string };

/** Turn a paste into checked rows. Whole-paste problems (empty, too big, too many rows) come back as one message. */
export function parseCatalogueImport(text: string): ParsedPaste {
  const tooBig = checkPasteSize(text);
  if (tooBig) return { ok: false, error: tooBig };
  if (!text.trim()) return { ok: false, error: 'Paste some rows from Excel first.' };

  // Excel and Sheets copy tab-separated; anything without a tab is read as comma-separated.
  const delimiter = text.includes('\t') ? '\t' : ',';
  const records = splitRecords(text, delimiter)
    .map((r) => ({ line: r.line, cells: r.cells.map((c) => c.trim()) }))
    .filter((r) => r.cells.some((c) => c !== ''));
  const header = records.length > 0 && looksLikeHeader(records[0]!.cells);
  const data = header ? records.slice(1) : records;
  if (data.length === 0) return { ok: false, error: 'Only a header row was pasted. Copy the item rows too.' };
  if (data.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `This paste has ${data.length} rows. Paste at most ${IMPORT_MAX_ROWS} at a time, then paste the rest.` };
  }

  const seen = new Map<string, number>();
  const rows = data.map((r) => {
    const row = checkRow(r);
    const code = row.value?.code;
    if (code) {
      const first = seen.get(code);
      if (first !== undefined) {
        row.errors.code = `Code ${code} is already on line ${first} of this paste. Each code once.`;
        row.value = null;
      } else seen.set(code, r.line);
    }
    return row;
  });
  return { ok: true, header, rows };
}

function checkRow(r: PastedRecord): ImportRow {
  // Excel pads a selection with empty cells; ignore empty ones past the seventh.
  const cells = [...r.cells];
  while (cells.length > IMPORT_COLUMNS.length && cells[cells.length - 1] === '') cells.pop();
  const shown = [...cells.slice(0, IMPORT_COLUMNS.length)];
  while (shown.length < IMPORT_COLUMNS.length) shown.push('');

  if (cells.length === 1) {
    return { line: r.line, cells: shown, value: null, errors: { row: 'This row has no columns. Copy the cells straight from Excel, or separate them with commas.' } };
  }
  if (cells.length > IMPORT_COLUMNS.length) {
    return { line: r.line, cells: shown, value: null, errors: { row: `This row has ${cells.length} columns. Use 7: ${IMPORT_COLUMNS.join(', ')}.` } };
  }

  const [code, name, category, price, treatment, hsn, rate] = shown as [string, string, string, string, string, string, string];
  const taxCategory = readTreatment(treatment);
  const exempt = taxCategory === 'exempt_healthcare';
  const input: CatalogueItemInput = {
    code,
    name,
    category,
    price,
    taxCategory: taxCategory ?? '',
    hsnSacCode: hsn,
    // An empty rate is fine for exempt items (always 0 %); otherwise -1 makes the validator explain.
    gstRateBp: readGstPercent(rate) ?? (exempt && rate === '' ? 0 : -1),
  };
  const checked = checkCatalogueItem(input);
  const errors: FieldErrors = checked.ok ? {} : { ...checked.fieldErrors };
  if (errors.taxCategory) errors.taxCategory = treatment ? `“${treatment}” isn’t a GST treatment. ${TREATMENT_HELP}` : `Missing. ${TREATMENT_HELP}`;
  if (errors.gstRateBp) errors.gstRateBp = `Use ${GST_RATES_BP.map((b) => b / 100).join(', ')} (with or without %).`;
  return { line: r.line, cells: shown, value: checked.ok ? checked.value : null, errors };
}

// ---------------------------------------------------------------------------
// Classification against what the org already has.
// ---------------------------------------------------------------------------

export interface ExistingItem {
  code: string;
  name: string;
  category: string | null;
  defaultPricePaise: number;
  taxCategory: string;
  hsnSacCode: string;
  gstRateBp: number;
}

export type ImportStatus = 'new' | 'update' | 'error';

export interface PreviewRow extends ImportRow {
  status: ImportStatus;
  /** Updates only: the price today, so the preview can show old → new. */
  oldPricePaise: Paise | null;
  /** Updates only: other columns this row changes, by column name. */
  alsoChanges: string[];
}

export interface ImportCounts {
  new: number;
  update: number;
  error: number;
}

/** Mark each row New, Will update (its code exists in this org) or Error. */
export function classifyImport(rows: ImportRow[], existing: ReadonlyMap<string, ExistingItem>): PreviewRow[] {
  return rows.map((r) => {
    if (!r.value) return { ...r, status: 'error', oldPricePaise: null, alsoChanges: [] };
    const old = existing.get(r.value.code);
    if (!old) return { ...r, status: 'new', oldPricePaise: null, alsoChanges: [] };
    const v = r.value;
    const alsoChanges = [
      v.name !== old.name ? 'Name' : null,
      (v.category ?? null) !== (old.category ?? null) ? 'Category' : null,
      v.taxCategory !== old.taxCategory ? 'GST treatment' : null,
      v.hsnSacCode !== old.hsnSacCode ? 'HSN/SAC' : null,
      v.gstRateBp !== old.gstRateBp ? 'GST %' : null,
    ].filter((x): x is string => x !== null);
    return { ...r, status: 'update', oldPricePaise: old.defaultPricePaise as Paise, alsoChanges };
  });
}

export function countImport(rows: PreviewRow[]): ImportCounts {
  const c: ImportCounts = { new: 0, update: 0, error: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

/** "12 new, 3 updates, 2 errors". */
export function importSummary(c: ImportCounts): string {
  return `${c.new} new, ${c.update} ${c.update === 1 ? 'update' : 'updates'}, ${c.error} ${c.error === 1 ? 'error' : 'errors'}`;
}

/** What the owner confirmed: the codes the preview showed as new and as updates. Sorted, so two plans compare by value. */
export interface ImportPlan {
  newCodes: string[];
  updateCodes: string[];
}

export function importPlan(rows: PreviewRow[]): ImportPlan {
  const pick = (s: ImportStatus) => rows.filter((r) => r.status === s && r.value).map((r) => r.value!.code).sort();
  return { newCodes: pick('new'), updateCodes: pick('update') };
}

export function samePlan(a: ImportPlan, b: ImportPlan): boolean {
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  return eq([...a.newCodes].sort(), [...b.newCodes].sort()) && eq([...a.updateCodes].sort(), [...b.updateCodes].sort());
}
