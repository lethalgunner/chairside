import 'server-only';
import qrcode from 'qrcode-generator';

/**
 * A QR code as one SVG path, drawn on the server (Sprint 2, T31). No hosted
 * QR service: it would see every amount and UPI ID. `qrcode-generator` has no
 * dependencies. Input is ASCII only (the UPI link is percent-encoded).
 */
export function qrPath(text: string): { size: number; d: string } {
  if (!/^[\x20-\x7e]+$/.test(text)) throw new Error('QR text must be printable ASCII');
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return { size: n, d };
}
