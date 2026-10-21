/**
 * The patient ledger, receipt allocation, and the day-book close.
 *
 * Two principles run through this file:
 *
 *   1. A balance is always DERIVED from entries, never cached. If you find
 *      yourself storing a running total on the patient row, stop — a number
 *      nobody can reconstruct from its parts is a number nobody will trust,
 *      and the first time it disagrees with the entries you lose the customer.
 *
 *   2. Sign convention, applied everywhere without exception:
 *        positive  = the patient owes us more (invoice, drawdown, refund)
 *        negative  = the patient owes us less (receipt, advance, credit note,
 *                    write-off)
 *      So the balance is simply the sum. A negative balance means the patient
 *      is in credit, which happens constantly in dentistry because implants and
 *      orthodontics are collected up front.
 */

import {
  type Paise,
  ZERO,
  add,
  subtract,
  min,
  allocate,
  isPositive,
  paise,
} from './money';

export type LedgerEntryType =
  | 'invoice'
  | 'receipt'
  | 'advance'
  | 'advance_drawdown'
  | 'credit_note'
  | 'refund'
  | 'write_off'
  | 'receipt_cancel';

export interface LedgerEntry {
  entryType: LedgerEntryType;
  amountPaise: Paise;
  occurredOn: string; // ISO date, YYYY-MM-DD
  invoiceId?: string;
  receiptId?: string;
  narration?: string;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/** What the patient owes. Negative means they are in credit. */
export function patientBalance(entries: LedgerEntry[]): Paise {
  return add(...entries.map((e) => e.amountPaise));
}

export interface LedgerRow extends LedgerEntry {
  runningBalancePaise: Paise;
}

/**
 * The statement a patient actually sees — entries in date order with a running
 * balance, which is the form that lets someone check it themselves.
 */
export function statement(entries: LedgerEntry[]): LedgerRow[] {
  const sorted = [...entries].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  let running = ZERO;
  return sorted.map((e) => {
    running = add(running, e.amountPaise);
    return { ...e, runningBalancePaise: running };
  });
}

// ---------------------------------------------------------------------------
// Receipt allocation
// ---------------------------------------------------------------------------

export interface OutstandingInvoice {
  invoiceId: string;
  issuedOn: string;
  totalPaise: Paise;
  /** Already settled against this invoice. */
  allocatedPaise: Paise;
}

export function outstandingOf(inv: OutstandingInvoice): Paise {
  return subtract(inv.totalPaise, inv.allocatedPaise);
}

export type AllocationStrategy = 'oldest-first' | 'proportional';

export interface AllocationResult {
  allocations: { invoiceId: string; amountPaise: Paise }[];
  /**
   * What is left over after every outstanding invoice is settled. This becomes
   * an advance — unearned revenue held against future treatment, which is the
   * normal shape of an implant or orthodontic case.
   */
  unallocatedPaise: Paise;
}

/**
 * Spread a payment across what the patient owes.
 *
 * 'oldest-first' is the default and the right one for a clinic: it clears the
 * ageing invoices first, which is what the receivables report is measuring.
 * 'proportional' exists for the rarer case where a patient explicitly pays
 * "a bit off everything".
 */
export function allocateReceipt(
  amountPaise: Paise,
  invoices: OutstandingInvoice[],
  strategy: AllocationStrategy = 'oldest-first',
): AllocationResult {
  if (!isPositive(amountPaise)) {
    throw new LedgerError(`A receipt must be a positive amount, got ${amountPaise} paise.`);
  }

  const open = invoices
    .map((inv) => ({ inv, due: outstandingOf(inv) }))
    .filter((x) => isPositive(x.due));

  if (open.length === 0) {
    return { allocations: [], unallocatedPaise: amountPaise };
  }

  const totalDue = add(...open.map((x) => x.due));
  const allocations: { invoiceId: string; amountPaise: Paise }[] = [];

  if (strategy === 'proportional') {
    const toSpread = min(amountPaise, totalDue);
    const shares = allocate(
      toSpread,
      open.map((x) => x.due),
    );
    open.forEach((x, i) => {
      const share = shares[i] ?? ZERO;
      if (isPositive(share)) allocations.push({ invoiceId: x.inv.invoiceId, amountPaise: share });
    });
    return { allocations, unallocatedPaise: subtract(amountPaise, toSpread) };
  }

  // oldest-first
  const ordered = [...open].sort(
    (a, b) =>
      a.inv.issuedOn.localeCompare(b.inv.issuedOn) || a.inv.invoiceId.localeCompare(b.inv.invoiceId),
  );
  let remaining = amountPaise;
  for (const { inv, due } of ordered) {
    if (!isPositive(remaining)) break;
    const applied = min(remaining, due);
    allocations.push({ invoiceId: inv.invoiceId, amountPaise: applied });
    remaining = subtract(remaining, applied);
  }
  return { allocations, unallocatedPaise: remaining };
}

// ---------------------------------------------------------------------------
// Receivables ageing
// ---------------------------------------------------------------------------

export interface AgeingBuckets {
  current: Paise; // 0-30 days
  days31to60: Paise;
  days61to90: Paise;
  over90: Paise;
  total: Paise;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new LedgerError(`Invalid date in ageing calculation: '${fromIso}' to '${toIso}'.`);
  }
  return Math.floor((to - from) / 86_400_000);
}

/**
 * Ageing is the report that turns "we should chase some balances" into a
 * worklist. Collection probability falls off a cliff past 90 days, so the
 * buckets exist to make that cliff visible before someone reaches it.
 */
export function ageReceivables(invoices: OutstandingInvoice[], asOf: string): AgeingBuckets {
  const buckets: AgeingBuckets = {
    current: ZERO,
    days31to60: ZERO,
    days61to90: ZERO,
    over90: ZERO,
    total: ZERO,
  };

  for (const inv of invoices) {
    const due = outstandingOf(inv);
    if (!isPositive(due)) continue;
    const age = daysBetween(inv.issuedOn, asOf);
    if (age <= 30) buckets.current = add(buckets.current, due);
    else if (age <= 60) buckets.days31to60 = add(buckets.days31to60, due);
    else if (age <= 90) buckets.days61to90 = add(buckets.days61to90, due);
    else buckets.over90 = add(buckets.over90, due);
  }

  buckets.total = add(buckets.current, buckets.days31to60, buckets.days61to90, buckets.over90);
  return buckets;
}

// ---------------------------------------------------------------------------
// Day-book close
// ---------------------------------------------------------------------------

export type PaymentMode = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'financing';

export interface DayReceipt {
  mode: PaymentMode;
  amountPaise: Paise;
}

export interface DayReconciliation {
  byMode: Record<PaymentMode, Paise>;
  totalCollectedPaise: Paise;
  /** Opening float + cash received - cash paid out. What should be in the drawer. */
  expectedCashPaise: Paise;
  countedCashPaise: Paise;
  /** Counted minus expected. Negative means cash is missing. */
  variancePaise: Paise;
  /** True when the variance exceeds the branch's tolerance and needs an explanation. */
  requiresExplanation: boolean;
}

const EMPTY_BY_MODE = (): Record<PaymentMode, Paise> => ({
  cash: ZERO,
  upi: ZERO,
  card: ZERO,
  bank_transfer: ZERO,
  cheque: ZERO,
  financing: ZERO,
});

/**
 * The end-of-day reconciliation.
 *
 * Most practices have never had a day that simply closes. The point of this
 * function is not the arithmetic — it is that a variance has to be named by a
 * human before the day can be locked.
 */
export function reconcileDay(params: {
  receipts: DayReceipt[];
  openingFloatPaise?: Paise;
  cashExpensesPaise?: Paise;
  countedCashPaise: Paise;
  /** Variance above this, in either direction, must be explained. Default ₹100. */
  tolerancePaise?: Paise;
}): DayReconciliation {
  const {
    receipts,
    openingFloatPaise = ZERO,
    cashExpensesPaise = ZERO,
    countedCashPaise,
    tolerancePaise = paise(10_000),
  } = params;

  const byMode = EMPTY_BY_MODE();
  for (const r of receipts) {
    byMode[r.mode] = add(byMode[r.mode], r.amountPaise);
  }

  const totalCollected = add(...Object.values(byMode));
  const expectedCash = subtract(add(openingFloatPaise, byMode.cash), cashExpensesPaise);
  const variance = subtract(countedCashPaise, expectedCash);

  return {
    byMode,
    totalCollectedPaise: totalCollected,
    expectedCashPaise: expectedCash,
    countedCashPaise,
    variancePaise: variance,
    requiresExplanation: Math.abs(variance) > tolerancePaise,
  };
}

/** Indian currency denominations, for the physical count at close. */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export function countFromDenominations(counts: Partial<Record<string, number>>): Paise {
  let total = 0;
  for (const d of DENOMINATIONS) {
    const n = counts[String(d)] ?? 0;
    if (!Number.isInteger(n) || n < 0) {
      throw new LedgerError(`Denomination count for ₹${d} must be a non-negative whole number.`);
    }
    total += d * 100 * n;
  }
  return paise(total);
}
