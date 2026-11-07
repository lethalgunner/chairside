/**
 * The printed header on bills, estimates and prescriptions (Sprint 5,
 * LET-174). Pure rules; the owner edits it in Settings → Bill header.
 */
import type { Checked, FieldErrors } from './staff';

export const LOGO_MAX_BYTES = 200 * 1024;

export interface PrintHeaderInput {
  printName: string;
  printAddress: string;
  printEmail: string;
  printFooter: string;
  /** A data URL from the browser, '' for none. */
  printLogo: string;
}

export interface PrintHeaderValues {
  printName: string | null;
  printAddress: string | null;
  printEmail: string | null;
  printFooter: string | null;
  printLogo: string | null;
}

/** Bytes of a base64 data URL if it is a real PNG or JPEG of allowed size; else an error message. */
export function checkLogo(dataUrl: string): { ok: true; bytes: number } | { ok: false; error: string } {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return { ok: false, error: 'Use a PNG or JPG image.' };
  let bin: string;
  try {
    bin = atob(m[2]!);
  } catch {
    return { ok: false, error: 'That image could not be read. Try another file.' };
  }
  if (bin.length > LOGO_MAX_BYTES) return { ok: false, error: 'Keep the logo under 200 KB.' };
  const b = (i: number) => bin.charCodeAt(i);
  const isPng = b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47;
  const isJpeg = b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if ((m[1] === 'png' && !isPng) || (m[1] === 'jpeg' && !isJpeg)) return { ok: false, error: 'That file isn’t really a PNG or JPG.' };
  return { ok: true, bytes: bin.length };
}

export function checkPrintHeader(input: PrintHeaderInput): Checked<PrintHeaderValues> {
  const fieldErrors: FieldErrors = {};
  const one = (s: string) => s.trim().replace(/\s+/g, ' ');
  const printName = one(input.printName);
  if (printName.length > 80) fieldErrors.printName = 'Keep the clinic name under 80 characters.';
  const lines = input.printAddress.split(/\r?\n/).map(one).filter(Boolean);
  if (lines.length > 4 || lines.some((l) => l.length > 90)) fieldErrors.printAddress = 'Up to 4 lines of up to 90 characters.';
  const printEmail = one(input.printEmail).toLowerCase();
  if (printEmail && (printEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(printEmail))) fieldErrors.printEmail = 'Enter an email like clinic@example.com.';
  const printFooter = one(input.printFooter);
  if (printFooter.length > 200) fieldErrors.printFooter = 'Keep the footer under 200 characters.';
  let printLogo: string | null = null;
  if (input.printLogo) {
    const l = checkLogo(input.printLogo);
    if (!l.ok) fieldErrors.printLogo = l.error;
    else printLogo = input.printLogo;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { printName: printName || null, printAddress: lines.length ? lines.join('\n') : null, printEmail: printEmail || null, printFooter: printFooter || null, printLogo } };
}
