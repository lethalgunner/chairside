/**
 * UPI scan-to-pay (Sprint 2, T31). Pure and unit-tested.
 *
 * The link follows the NPCI UPI linking specification: `upi://pay` with
 * pa (payee address, required), pn (payee name, required), am (amount, two
 * decimals), cu (INR) and tn (a short note). `tr` and `mc` are left out on
 * purpose: they mark a merchant transaction, and a small clinic's UPI ID is
 * often a personal one.
 *
 * The note carries the bill number only. Never a patient name or treatment:
 * it shows in the payer's and the payee's UPI history.
 */
import type { Paise } from './money';
import { toRupeeString } from './money';

/** name@handle: one @, letters, digits, dot, dash and underscore before it, letters after. */
const UPI_ID = /^[a-z0-9][a-z0-9._-]{1,254}@[a-z][a-z0-9]{1,63}$/;

/** Payee names go into a QR as plain ASCII; keep them to what every UPI app shows. */
const PAYEE = /^[A-Za-z0-9][A-Za-z0-9 .&'-]{1,49}$/;

export type UpiCheck = { ok: true; upiId: string | null; payee: string | null } | { ok: false; field: 'upiId' | 'upiPayee'; error: string };

/**
 * Validate the branch's UPI details as typed in Settings → Branches. Both
 * empty is fine (no QR is shown). A UPI ID needs the name it pays.
 */
export function checkUpi(upiIdRaw: string, payeeRaw: string): UpiCheck {
  const upiId = upiIdRaw.trim().toLowerCase();
  const payee = payeeRaw.trim().replace(/\s+/g, ' ');
  if (!upiId && !payee) return { ok: true, upiId: null, payee: null };
  if (!upiId) return { ok: false, field: 'upiId', error: 'Enter the UPI ID the payee name belongs to, or clear the name.' };
  if (!UPI_ID.test(upiId)) return { ok: false, field: 'upiId', error: 'A UPI ID looks like clinicname@okhdfcbank.' };
  if (!payee) return { ok: false, field: 'upiPayee', error: 'Enter the name patients will see when they pay, like the clinic’s name.' };
  if (!PAYEE.test(payee)) return { ok: false, field: 'upiPayee', error: 'Use 2 to 50 English letters, digits, spaces and . & \' -' };
  return { ok: true, upiId, payee };
}

/** RFC 3986 encoding for a query value, so a space is %20 (some UPI apps show a literal +). */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The `upi://pay` link for an exact amount. Null when there is nothing to pay. */
export function upiPayLink(p: { upiId: string; payee: string; amount: Paise; note: string }): string | null {
  if (p.amount <= 0) return null;
  // The UPI ID goes in unencoded: some UPI apps don't decode %40 in `pa`. It is
  // only safe because the ID is re-checked here to hold no URL-special characters.
  if (!UPI_ID.test(p.upiId)) return null;
  const note = p.note.replace(/[^A-Za-z0-9/ -]/g, '').slice(0, 50);
  return `upi://pay?pa=${p.upiId}&pn=${enc(p.payee)}&am=${toRupeeString(p.amount)}&cu=INR&tn=${enc(note)}`;
}
