import { describe, expect, it } from 'vitest';
import { csvCell, rupeesCell, toCsv } from './csv';

describe('CSV export (T40)', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Rao, Meena')).toBe('"Rao, Meena"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('defuses spreadsheet formulas in text cells', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+91 98220')).toBe("'+91 98220");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell(-5)).toBe('-5'); // numbers are numbers
  });

  it('writes money from paise with two decimals', () => {
    expect(rupeesCell(1_069_000)).toBe('10690.00');
    expect(rupeesCell(5)).toBe('0.05');
    expect(rupeesCell(null)).toBe('');
  });

  it('starts with a BOM and ends rows with CRLF', () => {
    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('﻿A,B\r\nx,1\r\n');
  });
});
