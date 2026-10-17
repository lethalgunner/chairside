/**
 * Indian mobile numbers arrive pasted in many shapes: '+91 98220 41155',
 * '098220 41155', '91-9822041155'. Normalise to the 10-digit national number,
 * or return null when it cannot be an Indian mobile.
 */
export function normaliseIndianMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[6-9]/.test(digits)) return null;
  return digits;
}

/** '9822041155' → '98220 41155' for display. */
export function formatIndianMobile(tenDigits: string): string {
  return tenDigits.length === 10 ? `${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}` : tenDigits;
}
