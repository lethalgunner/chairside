import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { checkUpi, upiPayLink } from './upi';

describe('checkUpi (T31)', () => {
  it('accepts a normal UPI ID and payee, lower-casing the ID', () => {
    expect(checkUpi(' DemoDental@OKHDFCBANK ', ' Demo  Dental Pune ')).toEqual({ ok: true, upiId: 'demodental@okhdfcbank', payee: 'Demo Dental Pune' });
    expect(checkUpi('dr.vij-clinic_1@ybl', "Dr Vij's Clinic & Co.")).toMatchObject({ ok: true });
  });

  it('allows both empty, meaning no QR', () => {
    expect(checkUpi('', '  ')).toEqual({ ok: true, upiId: null, payee: null });
  });

  it('refuses malformed IDs', () => {
    for (const bad of ['demodental', 'a@b', 'two@@bank', 'demo dental@ybl', 'demo@1bank', '@ybl', 'demo@ybl.com', 'upi://pay?pa=x@ybl']) {
      expect(checkUpi(bad, 'Demo Dental')).toMatchObject({ ok: false, field: 'upiId' });
    }
  });

  it('needs a payee with an ID, and an ID with a payee', () => {
    expect(checkUpi('demo@ybl', '')).toMatchObject({ ok: false, field: 'upiPayee' });
    expect(checkUpi('', 'Demo Dental')).toMatchObject({ ok: false, field: 'upiId' });
  });

  it('keeps the payee to plain characters that go safely into a QR', () => {
    expect(checkUpi('demo@ybl', 'डेमो डेंटल')).toMatchObject({ ok: false, field: 'upiPayee' });
    expect(checkUpi('demo@ybl', 'Demo&pa=thief@ybl')).toMatchObject({ ok: false, field: 'upiPayee' });
  });
});

describe('upiPayLink (T31)', () => {
  it('builds the NPCI link with the exact amount and the bill number', () => {
    expect(upiPayLink({ upiId: 'demodental@okhdfcbank', payee: 'Demo Dental Pune', amount: paise(369_000), note: 'DPNT/26-27/00001' })).toBe(
      'upi://pay?pa=demodental@okhdfcbank&pn=Demo%20Dental%20Pune&am=3690.00&cu=INR&tn=DPNT%2F26-27%2F00001',
    );
  });

  it('keeps paise', () => {
    expect(upiPayLink({ upiId: 'a1@ybl', payee: 'Clinic', amount: paise(5), note: 'X' })).toContain('am=0.05&');
  });

  it('encodes apostrophes and ampersands in the payee so they cannot add parameters', () => {
    const link = upiPayLink({ upiId: 'a1@ybl', payee: "Dr Vij's & Co", amount: paise(100), note: 'X' })!;
    expect(link).toContain('pn=Dr%20Vij%27s%20%26%20Co&');
    expect(link.match(/&/g)).toHaveLength(4);
  });

  it('strips anything but a bill number from the note', () => {
    expect(upiPayLink({ upiId: 'a1@ybl', payee: 'Clinic', amount: paise(100), note: 'Asha & root canal?' })).toContain('tn=Asha%20%20root%20canal');
  });

  it('gives no link for a UPI ID that could smuggle in parameters', () => {
    expect(upiPayLink({ upiId: 'a1@ybl&am=1', payee: 'Clinic', amount: paise(100), note: 'X' })).toBeNull();
    expect(upiPayLink({ upiId: 'A1@YBL', payee: 'Clinic', amount: paise(100), note: 'X' })).toBeNull();
  });

  it('gives no link when nothing is due', () => {
    expect(upiPayLink({ upiId: 'a1@ybl', payee: 'Clinic', amount: paise(0), note: 'X' })).toBeNull();
    expect(upiPayLink({ upiId: 'a1@ybl', payee: 'Clinic', amount: paise(-100), note: 'X' })).toBeNull();
  });
});
