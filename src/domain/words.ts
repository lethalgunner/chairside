/**
 * Amount in words, Indian style (Sprint 2, T34): "Rupees Ten Thousand Six
 * Hundred Ninety only". Indian invoices conventionally carry this line, and
 * it uses lakh and crore, not million. Built from integer paise only.
 */
import { MoneyError, type Paise } from './money';

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 in words; '' for 0. */
function upTo99(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = n % 10;
  return o ? `${t} ${ONES[o]}` : t;
}

/** 0–999 in words; '' for 0. */
function upTo999(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', upTo99(rest)].filter(Boolean).join(' ');
}

/** A whole number in Indian words: crore, lakh, thousand, hundred. '' for 0. */
export function indianWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new MoneyError(`indianWords takes a whole number ≥ 0, got ${n}.`);
  if (n === 0) return '';
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1_000);
  const rest = n % 1_000;
  const parts: string[] = [];
  // Above 99 crore the crore count is itself said in Indian words ("One Hundred Crore").
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${upTo99(lakh)} Lakh`);
  if (thousand) parts.push(`${upTo99(thousand)} Thousand`);
  if (rest) parts.push(upTo999(rest));
  return parts.join(' ');
}

/**
 * "Rupees One Lakh Twenty Thousand only", "Rupees Ten and Fifty Paise only",
 * "Rupees Zero only". Negative amounts are refused: a bill total never is.
 */
export function amountInWords(amount: Paise): string {
  if (amount < 0) throw new MoneyError('amountInWords takes an amount of ₹0 or more.');
  const whole = Math.floor(amount / 100);
  const p = amount % 100;
  const rupeePart = whole ? indianWords(whole) : p ? '' : 'Zero';
  if (!p) return `Rupees ${rupeePart} only`;
  if (!whole) return `${upTo99(p)} Paise only`;
  return `Rupees ${rupeePart} and ${upTo99(p)} Paise only`;
}
