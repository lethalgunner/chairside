/**
 * The vertical slice, as one scenario.
 *
 * Register a patient, do an RCT and fit a crown, sell a brush, raise ONE
 * invoice carrying both exempt and taxable lines, take a part payment in cash
 * and the rest on UPI, and close the day with the drawer reconciling.
 *
 * If this test passes, the hard half of Phase 0 works. Everything after it is
 * more of the same shape.
 */

import { describe, it, expect } from 'vitest';
import { computeInvoice, lineFromCategory, summariseByHsn, itcEligibleBp } from './tax';
import {
  allocateReceipt,
  patientBalance,
  statement,
  reconcileDay,
  countFromDenominations,
  outstandingOf,
  ageReceivables,
  type LedgerEntry,
  type OutstandingInvoice,
} from './ledger';
import { rupees, fromRupeeString, negate, add, formatINR, ZERO } from './money';

const KOTHRUD = {
  gstRegistered: true,
  gstin: '27AAAAA0000A1Z5',
  placeOfSupplyState: 'Maharashtra',
};
const STATE = 'Maharashtra';

describe('vertical slice: chair to ledger to day close', () => {
  it('ties end to end', () => {
    // --- 1. The visit produces three procedures -------------------------
    const invoice = computeInvoice(
      [
        lineFromCategory('Root canal treatment, tooth 26', rupees(6000), 'exempt_healthcare'),
        lineFromCategory('Zirconia crown, tooth 26', rupees(12000), 'goods_prosthetic'),
        lineFromCategory('Interdental brush pack', fromRupeeString('250.00'), 'goods_retail'),
      ],
      KOTHRUD,
      STATE,
    );

    // The exempt treatment and the taxable goods are separated at line level.
    expect(invoice.exemptPaise).toBe(rupees(6000));
    expect(invoice.taxablePaise).toBe(rupees(12250));
    expect(add(invoice.cgstPaise, invoice.sgstPaise)).toBe(fromRupeeString('1485.00'));
    expect(invoice.totalPaise).toBe(rupees(19735));

    // Invoice arithmetic closes on itself.
    const lineSum = add(...invoice.lines.map((l) => l.lineTotalPaise));
    expect(add(lineSum, invoice.roundingPaise)).toBe(invoice.totalPaise);

    // --- 2. Part payment, cash ------------------------------------------
    const open: OutstandingInvoice[] = [
      {
        invoiceId: 'INV-1',
        issuedOn: '2026-09-13',
        totalPaise: invoice.totalPaise,
        allocatedPaise: ZERO,
      },
    ];

    const cashPayment = allocateReceipt(rupees(10000), open);
    expect(cashPayment.allocations).toEqual([{ invoiceId: 'INV-1', amountPaise: rupees(10000) }]);
    expect(cashPayment.unallocatedPaise).toBe(ZERO);

    open[0]!.allocatedPaise = rupees(10000);
    expect(outstandingOf(open[0]!)).toBe(rupees(9735));

    // --- 3. The balance, paid by UPI ------------------------------------
    const upiPayment = allocateReceipt(rupees(9735), open);
    expect(upiPayment.allocations).toEqual([{ invoiceId: 'INV-1', amountPaise: rupees(9735) }]);
    expect(upiPayment.unallocatedPaise).toBe(ZERO);

    open[0]!.allocatedPaise = rupees(19735);
    expect(outstandingOf(open[0]!)).toBe(ZERO);

    // --- 4. The patient ledger settles to zero --------------------------
    const entries: LedgerEntry[] = [
      {
        entryType: 'invoice',
        amountPaise: invoice.totalPaise,
        occurredOn: '2026-09-13',
        invoiceId: 'INV-1',
      },
      {
        entryType: 'receipt',
        amountPaise: negate(rupees(10000)),
        occurredOn: '2026-09-13',
        receiptId: 'RCP-1',
      },
      {
        entryType: 'receipt',
        amountPaise: negate(rupees(9735)),
        occurredOn: '2026-09-13',
        receiptId: 'RCP-2',
      },
    ];
    expect(patientBalance(entries)).toBe(ZERO);
    expect(statement(entries).at(-1)?.runningBalancePaise).toBe(ZERO);

    // Nothing is ageing, because nothing is owed.
    expect(ageReceivables(open, '2026-09-13').total).toBe(ZERO);

    // --- 5. The day closes and the drawer reconciles --------------------
    const day = reconcileDay({
      receipts: [
        { mode: 'cash', amountPaise: rupees(10000) },
        { mode: 'upi', amountPaise: rupees(9735) },
      ],
      openingFloatPaise: rupees(2000),
      cashExpensesPaise: fromRupeeString('350.00'),
      // 500x22 + 100x6 + 50x1 = 11000 + 600 + 50
      countedCashPaise: countFromDenominations({ '500': 22, '100': 6, '50': 1 }),
    });

    expect(day.totalCollectedPaise).toBe(rupees(19735));
    expect(day.expectedCashPaise).toBe(fromRupeeString('11650.00'));
    expect(day.countedCashPaise).toBe(rupees(11650));
    expect(day.variancePaise).toBe(ZERO);
    expect(day.requiresExplanation).toBe(false);

    // --- 6. The accountant gets a clean split ---------------------------
    const hsn = summariseByHsn([invoice]);
    expect(hsn.map((r) => r.hsnSacCode)).toEqual(['3306', '9021', '9993']);
    expect(hsn.find((r) => r.hsnSacCode === '9993')?.valuePaise).toBe(rupees(6000));

    // Only a fraction of input tax is recoverable, because most of what this
    // practice sells is exempt. Worth showing an owner.
    expect(itcEligibleBp(invoice.taxablePaise, invoice.exemptPaise)).toBe(6712);
  });

  it('handles the other common shape: money collected before treatment', () => {
    // An implant case quoted at ₹55,000 with ₹40,000 taken up front.
    const advance = allocateReceipt(rupees(40000), []);
    expect(advance.unallocatedPaise).toBe(rupees(40000));

    const entries: LedgerEntry[] = [
      {
        entryType: 'advance',
        amountPaise: negate(rupees(40000)),
        occurredOn: '2026-09-01',
        narration: 'Implant case, advance',
      },
    ];
    // The patient is in credit until treatment is delivered.
    expect(patientBalance(entries)).toBe(rupees(-40000));

    // Stage one delivered and billed at ₹30,000.
    const stageOne = computeInvoice(
      [lineFromCategory('Implant fixture, 46', rupees(30000), 'goods_prosthetic')],
      KOTHRUD,
      STATE,
    );
    expect(stageOne.totalPaise).toBe(rupees(33600)); // with 12% GST

    entries.push({
      entryType: 'invoice',
      amountPaise: stageOne.totalPaise,
      occurredOn: '2026-10-05',
    });
    // Still ₹6,400 in credit against the rest of the case.
    expect(patientBalance(entries)).toBe(rupees(-6400));
    expect(formatINR(patientBalance(entries))).toBe('-₹6,400.00');
  });

  it('produces a flat total at an unregistered branch', () => {
    // The same treatment at a branch under the registration threshold.
    const invoice = computeInvoice(
      [
        lineFromCategory('Root canal treatment, tooth 26', rupees(6000), 'exempt_healthcare'),
        lineFromCategory('Zirconia crown, tooth 26', rupees(12000), 'goods_prosthetic'),
      ],
      { gstRegistered: false, placeOfSupplyState: 'Maharashtra' },
      STATE,
    );
    expect(invoice.totalPaise).toBe(rupees(18000));
    expect(add(invoice.cgstPaise, invoice.sgstPaise)).toBe(ZERO);
    // Against ₹19,440 at a registered branch — a real price advantage, and one
    // that disappears the moment taxable turnover crosses the threshold.
  });
});
