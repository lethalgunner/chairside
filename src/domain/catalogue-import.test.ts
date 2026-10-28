import { describe, expect, it } from 'vitest';
import {
  checkPasteSize,
  classifyImport,
  countImport,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  importPlan,
  importSummary,
  looksLikeHeader,
  parseCatalogueImport,
  readGstPercent,
  readTreatment,
  samePlan,
  splitRecords,
  type ExistingItem,
  type ImportRow,
} from './catalogue-import';

const tsv = (...rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');
const HEADER = ['Code', 'Name', 'Category', 'Price (₹)', 'GST treatment', 'HSN/SAC', 'GST %'];
const RCT = ['RCT', 'Root canal treatment', 'Endodontics', '4,500', 'exempt', '9993', '0'];
const CRN = ['CRN', 'Zirconia crown', 'Prosthodontics', '₹6,000', 'prosthetic', '9021', '12%'];

function rows(text: string): ImportRow[] {
  const p = parseCatalogueImport(text);
  if (!p.ok) throw new Error(p.error);
  return p.rows;
}
function only(text: string): ImportRow {
  const r = rows(text);
  expect(r).toHaveLength(1);
  return r[0]!;
}

describe('splitting what Excel puts on the clipboard (T25)', () => {
  it('reads tab-separated rows, with or without a trailing newline or Windows line ends', () => {
    expect(splitRecords('a\tb\r\nc\td\r\n', '\t').map((r) => r.cells)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(splitRecords('a\tb\nc\td', '\t').map((r) => r.cells)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('reads commas with quoted fields holding commas, doubled quotes and line breaks', () => {
    const r = splitRecords('CRN,"Crown, zirconia","He said ""wow""",1500\nX,"two\nlines",c,1', ',');
    expect(r.map((x) => x.cells)).toEqual([
      ['CRN', 'Crown, zirconia', 'He said "wow"', '1500'],
      ['X', 'two\nlines', 'c', '1'],
    ]);
    expect(r.map((x) => x.line)).toEqual([1, 2]);
  });

  it('numbers rows by the line they start on, after a quoted line break', () => {
    expect(splitRecords('"a\nb"\tc\nd\te', '\t').map((r) => r.line)).toEqual([1, 3]);
  });

  it('reads Excel’s quoted tab cells', () => {
    expect(splitRecords('"A\tB"\tC', '\t')[0]!.cells).toEqual(['A\tB', 'C']);
  });
});

describe('header detection', () => {
  it('spots the header row whatever its spelling', () => {
    expect(looksLikeHeader(HEADER)).toBe(true);
    expect(looksLikeHeader(['item code', 'item name', 'cat', 'MRP'])).toBe(true);
    expect(looksLikeHeader(RCT)).toBe(false);
    expect(looksLikeHeader(['TBR', 'Toothbrush', 'Retail', '120', 'retail', '3306', '18'])).toBe(false);
  });

  it('parses the same rows with or without a header', () => {
    const withHeader = parseCatalogueImport(tsv(HEADER, RCT, CRN));
    const without = parseCatalogueImport(tsv(RCT, CRN));
    expect(withHeader).toMatchObject({ ok: true, header: true });
    expect(without).toMatchObject({ ok: true, header: false });
    if (withHeader.ok && without.ok) expect(withHeader.rows.map((r) => r.value)).toEqual(without.rows.map((r) => r.value));
  });
});

describe('parsing rows', () => {
  it('turns a clean paste into validated items in integer paise', () => {
    const [rct, crn] = rows(tsv(HEADER, RCT, CRN));
    expect(rct).toMatchObject({ line: 2, errors: {}, value: { code: 'RCT', name: 'Root canal treatment', defaultPricePaise: 450_000, taxCategory: 'exempt_healthcare', gstRateBp: 0, isGoods: false } });
    expect(crn).toMatchObject({ line: 3, errors: {}, value: { code: 'CRN', defaultPricePaise: 600_000, taxCategory: 'goods_prosthetic', hsnSacCode: '9021', gstRateBp: 1200, isGoods: true } });
  });

  it('reads comma-separated text the same way', () => {
    const r = only('ngd,"Night guard, soft",Prosthodontics,"2,500",implant,9021,5');
    expect(r.value).toMatchObject({ code: 'NGD', name: 'Night guard, soft', defaultPricePaise: 250_000, taxCategory: 'goods_prosthetic', gstRateBp: 500 });
  });

  it('ignores blank lines and rows of empty cells, keeping line numbers true', () => {
    const r = rows(`\n${tsv(RCT)}\n\n\t\t\t\t\t\t\n${tsv(CRN)}\n\n`);
    expect(r.map((x) => [x.line, x.value?.code])).toEqual([[2, 'RCT'], [5, 'CRN']]);
  });

  it('accepts every price shape the shared rupee parser does', () => {
    const shapes: [string, number][] = [['500', 50_000], ['1,500', 150_000], ['1500.50', 150_050], ['₹500', 50_000], ['₹ 1,500.00', 150_000], ['Rs 500', 50_000], ['Rs. 500', 50_000], ['INR 500', 50_000], ['500/-', 50_000], ['0', 0]];
    for (const [price, paise] of shapes) {
      expect(only(tsv(['X1', 'Item', '', price, 'exempt', '9993', '0'])).value?.defaultPricePaise, price).toBe(paise);
    }
  });

  it('reads GST treatment from the form’s labels, the stored values and simple words', () => {
    const cases: [string, string][] = [
      ['Exempt healthcare service', 'exempt_healthcare'],
      ['exempt_healthcare', 'exempt_healthcare'],
      ['Exempt', 'exempt_healthcare'],
      ['healthcare', 'exempt_healthcare'],
      ['Dental prosthetic or implant component', 'goods_prosthetic'],
      ['Implant', 'goods_prosthetic'],
      ['crown', 'goods_prosthetic'],
      ['Oral care product sold at reception', 'goods_retail'],
      ['retail', 'goods_retail'],
      ['PRODUCT', 'goods_retail'],
      ['Cosmetic procedure (outside the healthcare exemption)', 'cosmetic_service'],
      ['cosmetic', 'cosmetic_service'],
      ['Other', 'other_taxable'],
      ['other taxable supply', 'other_taxable'],
    ];
    for (const [cell, want] of cases) expect(readTreatment(cell), cell).toBe(want);
    for (const cell of ['', 'non-exempt', 'luxury', 'taxable']) expect(readTreatment(cell), cell).toBeNull();
  });

  it('reads GST % with or without the sign', () => {
    expect(['0', '5', '12%', '18 %', '28', '18.0'].map(readGstPercent)).toEqual([0, 500, 1200, 1800, 2800, 1800]);
    for (const s of ['', '0.18', '12.5', 'eighteen', '-5']) expect(readGstPercent(s), s).toBeNull();
  });

  it('lets an exempt item leave GST % empty, and keeps it at 0 % as the form does', () => {
    expect(only(tsv(['EX', 'Extraction', '', '800', 'exempt', '9993', ''])).value).toMatchObject({ gstRateBp: 0 });
    expect(only(tsv(['EX', 'Extraction', '', '800', 'exempt', '9993', '18'])).value).toMatchObject({ gstRateBp: 0 });
  });

  it('pads short rows and drops Excel’s empty trailing cells', () => {
    expect(only(tsv([...RCT, '', '', ''])).errors).toEqual({});
    expect(only('RCT,Root canal,Endo,4500,exempt,9993').errors).toEqual({});
  });
});

describe('error messages per column', () => {
  it('explains each bad cell in plain words', () => {
    const r = only(tsv(['has space', 'X', 'C'.repeat(41), 'abc', 'luxury', '99', '7']));
    expect(r.value).toBeNull();
    expect(r.errors).toEqual({
      code: 'Use 1 to 12 letters, digits or dashes, like RCT or CRN-ZR.',
      name: 'Enter a name (2 to 80 characters).',
      category: 'Keep the category under 40 characters.',
      price: 'Enter the price in rupees, like 500, 1,500 or 1500.50.',
      taxCategory: '“luxury” isn’t a GST treatment. Use exempt, prosthetic, retail, cosmetic or other.',
      hsnSacCode: 'HSN/SAC is 4, 6 or 8 digits, like 9993.',
      gstRateBp: 'Use 0, 5, 12, 18, 28, 40 (with or without %).',
    });
  });

  it('refuses a negative price and a missing treatment or rate', () => {
    expect(only(tsv(['A1', 'Item', '', '-500', 'retail', '3306', '18'])).errors.price).toBe('The price can’t be negative.');
    expect(only(tsv(['A1', 'Item', '', '500', '', '3306', '18'])).errors.taxCategory).toBe('Missing. Use exempt, prosthetic, retail, cosmetic or other.');
    expect(only(tsv(['A1', 'Item', '', '500', 'retail', '3306', ''])).errors.gstRateBp).toMatch(/^Use 0, 5, 12, 18, 28/);
  });

  it('flags a row with too many columns or none', () => {
    expect(only(tsv([...RCT, 'extra'])).errors).toEqual({ row: 'This row has 8 columns. Use 7: Code, Name, Category, Price (₹), GST treatment, HSN/SAC, GST %.' });
    expect(only('RCT;Root canal;4500').errors).toEqual({ row: 'This row has no columns. Copy the cells straight from Excel, or separate them with commas.' });
  });

  it('flags a code pasted twice, on the second row only', () => {
    const r = rows(tsv(RCT, ['rct', 'Root canal again', '', '5000', 'exempt', '9993', '0']));
    expect(r[0]!.errors).toEqual({});
    expect(r[1]).toMatchObject({ value: null, errors: { code: 'Code RCT is already on line 1 of this paste. Each code once.' } });
  });
});

describe('limits (CTO: 500 rows, 200 KB)', () => {
  const row = (i: number) => `C${i}\tItem ${i}\t\t100\texempt\t9993\t0`;

  it('takes exactly 500 rows and refuses 501, with a header not counted', () => {
    const five = Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => row(i)).join('\n');
    expect(parseCatalogueImport(`${HEADER.join('\t')}\n${five}`)).toMatchObject({ ok: true });
    expect(parseCatalogueImport(`${five}\n${row(501)}`)).toEqual({ ok: false, error: 'This paste has 501 rows. Paste at most 500 at a time, then paste the rest.' });
  });

  it('refuses more than 200 KB, counted in bytes as sent', () => {
    expect(checkPasteSize('a'.repeat(IMPORT_MAX_BYTES))).toBeNull();
    expect(checkPasteSize('a'.repeat(IMPORT_MAX_BYTES + 1))).toBe('This paste is too large (201 KB). Paste at most 200 KB, about 500 rows, at a time.');
    // ₹ is 3 bytes: under the limit in characters, over it in bytes.
    expect(checkPasteSize('₹'.repeat(70_000))).toMatch(/too large \(206 KB\)/);
    expect(parseCatalogueImport('x'.repeat(IMPORT_MAX_BYTES + 10))).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) });
  });

  it('asks for rows when the paste is empty or only a header', () => {
    expect(parseCatalogueImport(' \n\t\n')).toEqual({ ok: false, error: 'Paste some rows from Excel first.' });
    expect(parseCatalogueImport(HEADER.join('\t'))).toEqual({ ok: false, error: 'Only a header row was pasted. Copy the item rows too.' });
  });
});

describe('classifying against the current price list', () => {
  const existing = new Map<string, ExistingItem>([
    ['RCT', { code: 'RCT', name: 'Root canal treatment', category: 'Endodontics', defaultPricePaise: 400_000, taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 }],
    ['CRN', { code: 'CRN', name: 'Crown', category: 'Prosthodontics', defaultPricePaise: 600_000, taxCategory: 'goods_prosthetic', hsnSacCode: '9021', gstRateBp: 500 }],
  ]);

  it('marks new, will update (with the old price and other changes) and error', () => {
    const preview = classifyImport(rows(tsv(RCT, CRN, ['NEW', 'Night guard', '', '2500', 'implant', '9021', '5'], ['BAD', 'x', '', '1', 'exempt', '9993', '0'])), existing);
    expect(preview.map((r) => r.status)).toEqual(['update', 'update', 'new', 'error']);
    expect(preview[0]).toMatchObject({ oldPricePaise: 400_000, alsoChanges: [] });
    expect(preview[1]).toMatchObject({ oldPricePaise: 600_000, alsoChanges: ['Name', 'GST %'] });
    expect(preview[2]).toMatchObject({ oldPricePaise: null });
    const counts = countImport(preview);
    expect(counts).toEqual({ new: 1, update: 2, error: 1 });
    expect(importSummary(counts)).toBe('1 new, 2 updates, 1 error');
    expect(importSummary({ new: 12, update: 1, error: 2 })).toBe('12 new, 1 update, 2 errors');
    expect(importPlan(preview)).toEqual({ newCodes: ['NEW'], updateCodes: ['CRN', 'RCT'] });
  });

  it('compares plans by their codes, in any order', () => {
    expect(samePlan({ newCodes: ['B', 'A'], updateCodes: [] }, { newCodes: ['A', 'B'], updateCodes: [] })).toBe(true);
    expect(samePlan({ newCodes: ['A'], updateCodes: [] }, { newCodes: [], updateCodes: ['A'] })).toBe(false);
  });
});
