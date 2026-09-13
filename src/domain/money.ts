/**
 * Money.
 *
 * Every rupee amount in Chairside is an integer number of paise. There are no
 * floating-point amounts anywhere in this system, and there is no decimal
 * library. `0.1 + 0.2 !== 0.3` is not a curiosity here — it is a clinic's day
 * book failing to reconcile, which is the one thing this product exists to
 * prevent.
 *
 * Rules this module enforces:
 *   - You cannot construct money from a float. Use `paise()` or
 *     `fromRupeeString()`. `fromRupeeString('0.1')` is exact; `0.1` is not.
 *   - Rates are basis points (1200 = 12%), never fractions, for the same reason.
 *   - Splitting money never creates or destroys paise. `allocate()` is
 *     guaranteed to sum exactly back to its input.
 *   - Multiplication uses BigInt internally, so large amounts cannot silently
 *     exceed Number.MAX_SAFE_INTEGER mid-calculation.
 */

/** An integer number of paise. 100 paise = ₹1. */
export type Paise = number & { readonly __brand: 'Paise' };

/** Basis points. 1 bp = 0.01%. So 1200 bp = 12%, 1800 bp = 18%. */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

export const ZERO = 0 as Paise;

/** Largest amount we will accept, ₹1,000 crore in paise. A guard against nonsense input. */
const MAX_PAISE = 1_000_00_00_00_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Construct from an integer number of paise. Rejects floats outright. */
export function paise(n: number): Paise {
  if (!Number.isInteger(n)) {
    throw new MoneyError(
      `Money must be a whole number of paise, got ${n}. ` +
        `If this came from a decimal rupee value, use fromRupeeString('${n}') instead.`,
    );
  }
  if (Math.abs(n) > MAX_PAISE) {
    throw new MoneyError(`Amount ${n} paise exceeds the maximum this system will handle.`);
  }
  return n as Paise;
}

/** Construct from a whole number of rupees. */
export function rupees(n: number): Paise {
  if (!Number.isInteger(n)) {
    throw new MoneyError(
      `rupees() takes whole rupees, got ${n}. Use fromRupeeString('${n}') for paise precision.`,
    );
  }
  return paise(n * 100);
}

/**
 * Parse a rupee string such as '1234.56', '1234', '-99.05' or '1,234.56'.
 * This is the only safe way to get a decimal rupee amount into the system —
 * user input, imported CSVs and price lists all come through here.
 */
export function fromRupeeString(s: string): Paise {
  const cleaned = s.trim().replace(/[₹\s,]/g, '');
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) {
    throw new MoneyError(
      `'${s}' is not a valid rupee amount. Expected digits with at most two decimal places.`,
    );
  }
  const [, sign, whole, frac = '0'] = m;
  const fracPaise = Number(frac.padEnd(2, '0'));
  const total = Number(whole) * 100 + fracPaise;
  return paise(sign === '-' ? -total : total);
}

export function basisPoints(n: number): BasisPoints {
  if (!Number.isInteger(n) || n < 0) {
    throw new MoneyError(`Basis points must be a non-negative integer, got ${n}.`);
  }
  return n as BasisPoints;
}

/** Convenience: percent(18) === 1800 basis points. Whole and half percents only. */
export function percent(p: number): BasisPoints {
  const bp = p * 100;
  if (!Number.isInteger(bp)) {
    throw new MoneyError(`percent(${p}) is not expressible in basis points.`);
  }
  return basisPoints(bp);
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function add(...amounts: Paise[]): Paise {
  return paise(amounts.reduce((acc, a) => acc + a, 0));
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

export function negate(a: Paise): Paise {
  return paise(-a);
}

export function abs(a: Paise): Paise {
  return paise(Math.abs(a));
}

/** Multiply by a whole quantity — three units of the same item, for instance. */
export function multiply(a: Paise, qty: number): Paise {
  if (!Number.isInteger(qty)) {
    throw new MoneyError(`Quantity must be a whole number, got ${qty}. Use applyRate for fractions.`);
  }
  return paise(Number(BigInt(a) * BigInt(qty)));
}

export type Rounding = 'half-up' | 'floor' | 'ceil';

/**
 * Apply a basis-point rate to an amount — GST on a line, or a doctor's
 * percentage share of a collection.
 *
 * 'half-up' rounds a half paisa away from zero, which is what Indian tax
 * practice expects and what a human checking the arithmetic will do.
 */
export function applyRate(
  amount: Paise,
  rate: BasisPoints,
  rounding: Rounding = 'half-up',
): Paise {
  const numerator = BigInt(amount) * BigInt(rate);
  const denominator = 10_000n;
  return paise(divideRounded(numerator, denominator, rounding));
}

function divideRounded(numerator: bigint, denominator: bigint, rounding: Rounding): number {
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const quotient = n / denominator;
  const remainder = n % denominator;

  let result: bigint;
  if (remainder === 0n) {
    result = quotient;
  } else if (rounding === 'floor') {
    result = negative ? quotient + 1n : quotient;
  } else if (rounding === 'ceil') {
    result = negative ? quotient : quotient + 1n;
  } else {
    result = remainder * 2n >= denominator ? quotient + 1n : quotient;
  }

  const signed = negative ? -result : result;
  return Number(signed);
}

/**
 * Round to the nearest whole rupee. Used for the rounding-off line that Indian
 * invoices conventionally carry so the payable total is a round figure.
 */
export function roundToRupee(amount: Paise): Paise {
  const negative = amount < 0;
  const a = Math.abs(amount);
  const rounded = Math.floor(a / 100) * 100 + (a % 100 >= 50 ? 100 : 0);
  return paise(negative ? -rounded : rounded);
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/**
 * Split an amount across weights without creating or losing a single paisa.
 *
 * Uses the largest-remainder method: everyone gets their floor share, then the
 * leftover paise go one at a time to whoever was rounded down hardest. This is
 * how a ₹1,000 receipt is spread across three invoices, and how proportionate
 * input-tax-credit apportionment works.
 *
 * Guarantee: `add(...allocate(x, w)) === x` for any x and any weights.
 */
export function allocate(amount: Paise, weights: number[]): Paise[] {
  if (weights.length === 0) {
    throw new MoneyError('Cannot allocate across zero weights.');
  }
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new MoneyError('Allocation weights must be non-negative finite numbers.');
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    // Nothing to weight by — put everything in the first slot rather than
    // silently dropping it, and let the caller notice.
    return weights.map((_, i) => (i === 0 ? amount : ZERO));
  }

  const negative = amount < 0;
  const magnitude = BigInt(Math.abs(amount));

  // Scale weights to integers so the arithmetic stays exact.
  const scale = 1_000_000;
  const intWeights = weights.map((w) => BigInt(Math.round(w * scale)));
  const intTotal = intWeights.reduce((a, b) => a + b, 0n);

  const shares: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0n;

  intWeights.forEach((w, i) => {
    const exact = magnitude * w;
    const share = exact / intTotal;
    shares.push(share);
    remainders.push({ index: i, remainder: exact % intTotal });
    distributed += share;
  });

  let leftover = magnitude - distributed;
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  let cursor = 0;
  while (leftover > 0n) {
    const target = remainders[cursor % remainders.length];
    if (target) shares[target.index] = (shares[target.index] ?? 0n) + 1n;
    leftover -= 1n;
    cursor += 1;
  }

  return shares.map((s) => paise(Number(negative ? -s : s)));
}

/** Split evenly into n parts, with the odd paise going to the earliest parts. */
export function splitEvenly(amount: Paise, n: number): Paise[] {
  if (!Number.isInteger(n) || n <= 0) {
    throw new MoneyError(`Cannot split into ${n} parts.`);
  }
  return allocate(amount, new Array(n).fill(1));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export const isZero = (a: Paise): boolean => a === 0;
export const isPositive = (a: Paise): boolean => a > 0;
export const isNegative = (a: Paise): boolean => a < 0;
export const equals = (a: Paise, b: Paise): boolean => a === b;
export const greaterThan = (a: Paise, b: Paise): boolean => a > b;
export const lessThan = (a: Paise, b: Paise): boolean => a < b;
export const min = (a: Paise, b: Paise): Paise => (a <= b ? a : b);
export const max = (a: Paise, b: Paise): Paise => (a >= b ? a : b);

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Plain decimal string, no symbol or grouping: 123456 -> '1234.56'. For exports and APIs. */
export function toRupeeString(amount: Paise): string {
  const negative = amount < 0;
  const a = Math.abs(amount);
  const whole = Math.floor(a / 100);
  const frac = (a % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/**
 * Indian digit grouping — ₹12,34,567.89, not ₹1,234,567.89.
 * Getting this wrong is a small thing that makes software feel foreign to the
 * person reading their own day book.
 */
export function formatINR(amount: Paise, opts: { symbol?: boolean; paise?: boolean } = {}): string {
  const { symbol = true, paise: showPaise = true } = opts;
  const negative = amount < 0;
  const a = Math.abs(amount);
  const whole = Math.floor(a / 100);
  const frac = (a % 100).toString().padStart(2, '0');

  const s = whole.toString();
  let grouped: string;
  if (s.length <= 3) {
    grouped = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }

  const body = showPaise ? `${grouped}.${frac}` : grouped;
  return `${negative ? '-' : ''}${symbol ? '₹' : ''}${body}`;
}
