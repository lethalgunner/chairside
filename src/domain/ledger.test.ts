import { describe, it, expect } from 'vitest';
import {
  patientBalance,
  statement,
  allocateReceipt,
  outstandingOf,
  ageReceivables,
  reconcileDay,
  countFromDenominations,
  LedgerError,
  type LedgerEntry,
  type OutstandingInvoice,
} from './ledger';
import { rupees, fromRupeeString, negate, add, ZERO, paise } from './money';

const inv = (
  id: string,
  issuedOn: string,
  total: number,
  allocated = 0,
): OutstandingInvoice => ({
  invoiceId: id,
  issuedOn,
  totalPaise: rupees(total),
  allocatedPaise: rupees(allocated),
});

describe('patient balance', () => {
  it('sums to what the patient owes, with credits negative', () => {
    const entries: LedgerEntry[] = [
      { entryType: 'invoice', amountPaise: rupees(19735), occurredOn: '2026-09-01' },
      { entryType: 'receipt', amountPaise: negate(rupees(10000)), occurredOn: '2026-09-01' },
      { entryType: 'receipt', amountPaise: negate(rupees(5000)), occurredOn: '2026-09-08' },
    ];
    expect(patientBalance(entries)).toBe(rupees(4735));
  });

  it('goes negative when a patient is in credit, which ortho and implants cause constantly', () => {
    const entries: LedgerEntry[] = [
      { entryType: 'advance', amountPaise: negate(rupees(40000)), occurredOn: '2026-09-01' },
      { entryType: 'invoice', amountPaise: rupees(12000), occurredOn: '2026-09-15' },
    ];
    expect(patientBalance(entries)).toBe(rupees(-28000));
  });

  it('is zero for a patient with no history', () => {
    expect(patientBalance([])).toBe(ZERO);
  });

  it('builds a running balance in date order', () => {
    const rows = statement([
      { entryType: 'receipt', amountPaise: negate(rupees(5000)), occurredOn: '2026-09-08' },
      { entryType: 'invoice', amountPaise: rupees(19735), occurredOn: '2026-09-01' },
      { entryType: 'receipt', amountPaise: negate(rupees(10000)), occurredOn: '2026-09-01' },
    ]);
    expect(rows.map((r) => r.runningBalancePaise)).toEqual([
      rupees(19735),
      rupees(9735),
      rupees(4735),
    ]);
  });
});

describe('receipt allocation', () => {
  const invoices = [
    inv('a', '2026-06-01', 3000),
    inv('b', '2026-07-15', 7000),
    inv('c', '2026-08-20', 5000),
  ];

  it('clears the oldest invoices first', () => {
    const result = allocateReceipt(rupees(8000), invoices);
    expect(result.allocations).toEqual([
      { invoiceId: 'a', amountPaise: rupees(3000) },
      { invoiceId: 'b', amountPaise: rupees(5000) },
    ]);
    expect(result.unallocatedPaise).toBe(ZERO);
  });

  it('spreads proportionally when asked', () => {
    const result = allocateReceipt(rupees(7500), invoices, 'proportional');
    expect(add(...result.allocations.map((a) => a.amountPaise))).toBe(rupees(7500));
    // ₹7,500 across ₹3,000 / ₹7,000 / ₹5,000 of debt
    expect(result.allocations.map((a) => a.amountPaise)).toEqual([
      rupees(1500),
      rupees(3500),
      rupees(2500),
    ]);
  });

  it('turns the excess into an advance rather than losing it', () => {
    const result = allocateReceipt(rupees(20000), invoices);
    expect(add(...result.allocations.map((a) => a.amountPaise))).toBe(rupees(15000));
    expect(result.unallocatedPaise).toBe(rupees(5000));
  });

  it('treats a payment with nothing outstanding as entirely an advance', () => {
    const result = allocateReceipt(rupees(40000), []);
    expect(result.allocations).toEqual([]);
    expect(result.unallocatedPaise).toBe(rupees(40000));
  });

  it('ignores invoices already settled', () => {
    const result = allocateReceipt(rupees(2000), [inv('a', '2026-06-01', 3000, 3000), inv('b', '2026-07-01', 5000)]);
    expect(result.allocations).toEqual([{ invoiceId: 'b', amountPaise: rupees(2000) }]);
  });

  it('handles a part payment against a part-paid invoice', () => {
    const result = allocateReceipt(rupees(1000), [inv('a', '2026-06-01', 3000, 2500)]);
    expect(result.allocations).toEqual([{ invoiceId: 'a', amountPaise: rupees(500) }]);
    expect(result.unallocatedPaise).toBe(rupees(500));
  });

  it('never allocates more than is owed, at any amount', () => {
    for (let amount = 100; amount <= 20000; amount += 337) {
      const r = allocateReceipt(rupees(amount), invoices);
      const allocated = add(...r.allocations.map((a) => a.amountPaise));
      expect(add(allocated, r.unallocatedPaise)).toBe(rupees(amount));
      expect(allocated).toBeLessThanOrEqual(rupees(15000));
    }
  });

  it('refuses a zero or negative receipt', () => {
    expect(() => allocateReceipt(ZERO, invoices)).toThrow(LedgerError);
    expect(() => allocateReceipt(rupees(-100), invoices)).toThrow(LedgerError);
  });
});

describe('receivables ageing', () => {
  it('sorts outstanding balances into the buckets that drive the worklist', () => {
    const buckets = ageReceivables(
      [
        inv('fresh', '2026-09-01', 5000),
        inv('month', '2026-08-01', 3000),
        inv('twomonth', '2026-07-05', 2000),
        inv('stale', '2026-04-01', 9000),
        inv('paid', '2026-01-01', 4000, 4000),
      ],
      '2026-09-13',
    );

    expect(buckets.current).toBe(rupees(5000));
    expect(buckets.days31to60).toBe(rupees(3000));
    expect(buckets.days61to90).toBe(rupees(2000));
    expect(buckets.over90).toBe(rupees(9000));
    expect(buckets.total).toBe(rupees(19000));
  });

  it('rejects a malformed date rather than silently mis-ageing', () => {
    expect(() => ageReceivables([inv('a', 'not-a-date', 100)], '2026-09-13')).toThrow(LedgerError);
  });
});

describe('day-book close', () => {
  it('works out what should be in the drawer', () => {
    const result = reconcileDay({
      receipts: [
        { mode: 'cash', amountPaise: rupees(4500) },
        { mode: 'cash', amountPaise: rupees(1200) },
        { mode: 'upi', amountPaise: rupees(19735) },
        { mode: 'card', amountPaise: rupees(8000) },
      ],
      openingFloatPaise: rupees(2000),
      cashExpensesPaise: rupees(700),
      countedCashPaise: rupees(7000),
    });

    expect(result.byMode.cash).toBe(rupees(5700));
    expect(result.byMode.upi).toBe(rupees(19735));
    expect(result.totalCollectedPaise).toBe(rupees(33435));
    // 2000 float + 5700 cash in - 700 paid out
    expect(result.expectedCashPaise).toBe(rupees(7000));
    expect(result.variancePaise).toBe(ZERO);
    expect(result.requiresExplanation).toBe(false);
  });

  it('flags a shortfall that someone has to explain before the day locks', () => {
    const result = reconcileDay({
      receipts: [{ mode: 'cash', amountPaise: rupees(5000) }],
      countedCashPaise: rupees(4500),
    });
    expect(result.variancePaise).toBe(rupees(-500));
    expect(result.requiresExplanation).toBe(true);
  });

  it('lets a trivial variance through without ceremony', () => {
    const result = reconcileDay({
      receipts: [{ mode: 'cash', amountPaise: rupees(5000) }],
      countedCashPaise: fromRupeeString('4950.00'),
    });
    expect(result.variancePaise).toBe(rupees(-50));
    expect(result.requiresExplanation).toBe(false);
  });

  it('counts a physical drawer from denominations', () => {
    // 8x500 + 3x200 + 5x100 + 2x50 + 1x20 + 3x10 = 4000+600+500+100+20+30
    const counted = countFromDenominations({ '500': 8, '200': 3, '100': 5, '50': 2, '20': 1, '10': 3 });
    expect(counted).toBe(rupees(5250));
  });

  it('rejects a nonsense denomination count', () => {
    expect(() => countFromDenominations({ '500': -1 })).toThrow(LedgerError);
    expect(() => countFromDenominations({ '100': 1.5 })).toThrow(LedgerError);
  });

  it('counts an empty drawer as zero', () => {
    expect(countFromDenominations({})).toBe(paise(0));
  });
});
