import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { amountInWords, indianWords } from './words';

const w = (n: number) => amountInWords(paise(n));

describe('amountInWords (T34)', () => {
  it('reads the golden-path bill total', () => {
    expect(w(1_069_000)).toBe('Rupees Ten Thousand Six Hundred Ninety only');
  });

  it('uses lakh and crore, not million', () => {
    expect(w(1_20_000_00)).toBe('Rupees One Lakh Twenty Thousand only');
    expect(w(2_50_00_000_00)).toBe('Rupees Two Crore Fifty Lakh only');
    expect(w(12_34_56_789_00)).toBe('Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine only');
  });

  it('handles teens, tens and hundreds without stray words', () => {
    expect(w(11_00)).toBe('Rupees Eleven only');
    expect(w(40_00)).toBe('Rupees Forty only');
    expect(w(100_00)).toBe('Rupees One Hundred only');
    expect(w(1_001_00)).toBe('Rupees One Thousand One only');
    expect(w(1_00_000_00)).toBe('Rupees One Lakh only');
  });

  it('adds paise, and reads a paise-only amount', () => {
    expect(w(10_50)).toBe('Rupees Ten and Fifty Paise only');
    expect(w(1_00_000_05)).toBe('Rupees One Lakh and Five Paise only');
    expect(w(75)).toBe('Seventy Five Paise only');
  });

  it('reads zero', () => {
    expect(w(0)).toBe('Rupees Zero only');
  });

  it('refuses a negative amount', () => {
    expect(() => w(-100)).toThrow();
  });

  it('says a crore count above 99 in Indian words', () => {
    expect(indianWords(100_00_00_000)).toBe('One Hundred Crore');
  });
});
