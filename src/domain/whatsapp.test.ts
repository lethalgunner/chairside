import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { appointmentConfirmHref, appointmentText, daySummaryText, duesReminderText, firstName, remindedLabel, waLink, waNumber } from './whatsapp';

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

  it('adds appointments per doctor and tomorrow (LET-171), and stays quiet when there are none', () => {
    const base = { branchName: 'B', dayLabel: 'D', billCount: 0, billedPaise: paise(0), collected: [], collectedPaise: paise(0), cashOutPaise: paise(0), closedBy: 'X Y', legacyVerdict: null, unbilledCount: 0, variancePaise: null };
    const t = daySummaryText({ ...base, appointments: { booked: 9, seen: 7, noShow: 1, tomorrow: 6, byDoctor: [{ name: 'Dr. A', booked: 5, seen: 4, noShow: 1 }, { name: 'Dr. B', booked: 4, seen: 3, noShow: 0 }] } });
    expect(t).toContain('Appointments: 9 booked · 7 seen · 1 no-show\n  Dr. A: 4/5 seen, 1 no-show\n  Dr. B: 3/4 seen\nTomorrow: 6 booked\nClosed by X');
    expect(daySummaryText({ ...base, appointments: { booked: 0, seen: 0, noShow: 0, tomorrow: 0, byDoctor: [] } })).not.toContain('Appointments');
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

describe('appointment confirmation', () => {
  const base = { patientName: 'Mr. Rahul Malhotra', clinicName: 'Vij Dental Care Pune', day: 'Mon 9 Nov', time: '11:00', address: 'FC Road, Pune', branchPhone: '020 1234 5678', calendarLink: 'https://calendar.google.com/x' };
  it('says when and where, with the calendar link', () => {
    const t = appointmentText(base);
    expect(t).toContain('Namaste Rahul,');
    expect(t).toContain('on Mon 9 Nov at 11:00');
    expect(t).toContain('Address: FC Road, Pune');
    expect(t).toContain('Add it to your calendar: https://calendar.google.com/x');
    expect(t).toContain('call us on 020 1234 5678');
  });
  it('never names the doctor or the reason', () => {
    const t = appointmentText(base);
    expect(t).not.toMatch(/Dr\.?\s/);
    expect(t).not.toMatch(/RCT|root canal|crown/i);
  });
  it('works without an address or phone', () => {
    const t = appointmentText({ ...base, address: null, branchPhone: null });
    expect(t).not.toContain('Address');
    expect(t).toContain('reply to this message');
  });
});

describe('appointment confirmation link', () => {
  it('opens a chat with the patient, in IST, with a calendar link', () => {
    const href = appointmentConfirmHref({ patientName: 'Rahul Malhotra', patientPhone: '9876543210', startsAt: new Date('2026-11-09T05:30:00Z'), endsAt: new Date('2026-11-09T05:45:00Z') }, { name: 'Vij Dental Care Pune', addressLines: ['FC Road', 'Pune'], phone: null });
    expect(href.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    const text = decodeURIComponent(href.split('text=')[1]!);
    expect(text).toContain('on Mon 9 Nov at 11:00');
    expect(text).toContain('Address: FC Road, Pune');
    expect(text).toContain('calendar.google.com');
  });
});
