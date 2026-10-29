/**
 * CSV for "Export my data" (Sprint 3, T40). Pure and unit-tested.
 * RFC 4180 quoting, CRLF line ends and a UTF-8 BOM so Excel shows ₹ and
 * Hindi names correctly. A cell that Excel would run as a formula (starting
 * with = + - @, a tab or a carriage return) gets a leading apostrophe.
 */
import { toRupeeString, type Paise } from './money';

export type Cell = string | number | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Money for a spreadsheet: rupees with 2 decimals, from paise, never a float. */
export const rupeesCell = (p: number | null | undefined): string => (p === null || p === undefined ? '' : toRupeeString(p as Paise));
