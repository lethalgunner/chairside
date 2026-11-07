import { describe, expect, it } from 'vitest';
import { checkLogo, checkPrintHeader } from './print';

const png = `data:image/png;base64,${btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3))}`;
const fakePng = `data:image/png;base64,${btoa('<svg onload=alert(1)>')}`;

describe('printed header (LET-174)', () => {
  it('accepts real PNG/JPEG under 200 KB only', () => {
    expect(checkLogo(png).ok).toBe(true);
    expect(checkLogo(fakePng)).toMatchObject({ ok: false });
    expect(checkLogo('data:image/svg+xml;base64,PHN2Zz4=')).toMatchObject({ ok: false });
    expect(checkLogo(`data:image/png;base64,${btoa('\x89PNG' + 'x'.repeat(210 * 1024))}`)).toMatchObject({ ok: false, error: 'Keep the logo under 200 KB.' });
    expect(checkLogo('javascript:alert(1)')).toMatchObject({ ok: false });
  });
  it('tidies the header and refuses bad fields', () => {
    const r = checkPrintHeader({ printName: ' Vij  Dental ', printAddress: ' 12 MG Road \n\n Pune 411001 ', printEmail: ' Clinic@Example.com ', printFooter: '', printLogo: png });
    expect(r.ok && r.value).toMatchObject({ printName: 'Vij Dental', printAddress: '12 MG Road\nPune 411001', printEmail: 'clinic@example.com', printFooter: null });
    const bad = checkPrintHeader({ printName: 'x'.repeat(81), printAddress: 'a\nb\nc\nd\ne', printEmail: 'nope', printFooter: 'y'.repeat(201), printLogo: fakePng });
    expect(!bad.ok && Object.keys(bad.fieldErrors).sort()).toEqual(['printAddress', 'printEmail', 'printFooter', 'printLogo', 'printName']);
    expect(checkPrintHeader({ printName: '', printAddress: '', printEmail: '', printFooter: '', printLogo: '' }).ok).toBe(true);
  });
});
