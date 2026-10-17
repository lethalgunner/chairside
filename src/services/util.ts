import type { Paise } from '@/domain/money';

/**
 * Postgres returns int8 aggregates (sum, count) as strings. Convert them to
 * Paise, refusing anything that is not a safe integer rather than rounding.
 */
export function toPaise(value: unknown): Paise {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error(`Not a safe integer amount: ${String(value)}`);
  return n as Paise;
}

export function toInt(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error(`Not a safe integer: ${String(value)}`);
  return n;
}

/** Postgres unique_violation. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint_name ?? e?.cause?.constraint_name;
  return code === '23505' && (!constraint || name === constraint);
}

/** Pilot 0 documents carry the 'T' test series unless explicitly turned off (ADR-012). */
export function testSeriesEnabled(): boolean {
  return process.env.CHAIRSIDE_TEST_SERIES !== '0';
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
