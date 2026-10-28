import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { daySummaryText, duesReminderText, firstName, remindedLabel, waLink, waNumber } from './whatsapp';

describe('wa.me links (T32, T33)', () => {
  it('prefixes 91 to a 10-digit mobile and encodes the text', () => {
    expect(waNumber('9822041155')).toBe('919822041155');
    expect(waLink('Hi there & ₹', '9822041155')).toBe('https://wa.me/919822041155?text=Hi%20there%20%26%20%E2%82%B9');
  });

  it('leaves the number out when there is none or it is not a mobile, so the sender picks', () => {
    expect(waLink('x')).toBe('https://wa.me/?text=x');
    expect(waLink('x', '0201234567')).toBe('https://wa.me/?text=x');
    expect(waNumber('12345')).toBeNull();
  });
});

describe('firstName', () => {
  it('skips titles and initials', () => {
    expect(firstName('Asha Testpatient')).toBe('Asha');
    expect(firstName('Dr. R. K. Sharma')).toBe('Sharma');
    expect(firstName('Mrs Meena Rao')).toBe('Meena');
    expect(firstName('  Ravi  ')).toBe('Ravi');
    expect(firstName('A. B.')).toBe('A. B.');
  });
});

describe('duesReminderText (T32)', () => {
  const base = { patientName: 'Asha Testpatient', branchName: 'Demo Pune', amount: paise(369_000), upiId: 'demodental@okhdfcbank', branchPhone: '020 1234 5678' };

  it('is polite, names the amount and how to pay, and nothing clinical', () => {
    const t = duesReminderText(base);
    expect(t).toBe(
      'Namaste Asha,\nThis is a gentle reminder from Demo Pune. ₹3,690.00 is pending on your account.\nYou can pay by UPI to demodental@okhdfcbank, or at the clinic on your next visit.\nQuestions? Call us on 020 1234 5678. Thank you!',
    );
    expect(t).not.toMatch(/Testpatient|root|crown|tooth|Dr\./i);
  });

  it('works without a UPI ID or phone', () => {
    const t = duesReminderText({ ...base, upiId: null, branchPhone: null });
    expect(t).toContain('You can pay at the clinic on your next visit.');
    expect(t.endsWith('Thank you!')).toBe(true);
  });
});

describe('daySummaryText (T33)', () => {
  it('sums the day for the owner with totals only', () => {
    const t = daySummaryText({
      branchName: 'Demo Pune',
      dayLabel: 'Wed 28 Oct',
      billCount: 3,
      billedPaise: paise(1_069_000),
      collected: [
        { mode: 'UPI', amountPaise: paise(500_000) },
        { mode: 'Cash', amountPaise: paise(200_000) },
      ],
      collectedPaise: paise(700_000),
      cashOutPaise: paise(10_000),
      variancePaise: paise(-5_000),
      closedBy: 'Test Desk (Pune)',
      legacyVerdict: 'Chairside matches the old system',
      unbilledCount: 1,
    });
    expect(t).toBe(
      [
        '*Demo Pune · Wed 28 Oct* (Chairside day close)',
        'Bills: 3 · ₹10,690.00',
        'Collected: ₹7,000.00',
        '  UPI: ₹5,000.00',
        '  Cash: ₹2,000.00',
        'Cash paid out: ₹100.00',
        'Drawer: short by ₹50.00',
        'Done, not billed: 1',
        'Old software: Chairside matches the old system',
        'Closed by Test',
      ].join('\n'),
    );
  });

  it('says exact, over, or not counted', () => {
    const base = { branchName: 'B', dayLabel: 'D', billCount: 0, billedPaise: paise(0), collected: [], collectedPaise: paise(0), cashOutPaise: paise(0), closedBy: 'X Y', legacyVerdict: null, unbilledCount: 0 };
    expect(daySummaryText({ ...base, variancePaise: paise(0) })).toContain('Drawer: exact');
    expect(daySummaryText({ ...base, variancePaise: paise(2_000) })).toContain('Drawer: over by ₹20.00');
    expect(daySummaryText({ ...base, variancePaise: null })).toContain('Drawer: not counted');
  });
});

describe('remindedLabel (T32)', () => {
  const now = new Date('2026-10-29T10:00:00+05:30');
  it('counts IST days, so late last night is yesterday', () => {
    expect(remindedLabel(new Date('2026-10-29T00:30:00+05:30'), now)).toBe('Reminded today');
    expect(remindedLabel(new Date('2026-10-28T23:30:00+05:30'), now)).toBe('Reminded yesterday');
    expect(remindedLabel(new Date('2026-10-25T12:00:00+05:30'), now)).toBe('Reminded 4 days ago');
  });
});
