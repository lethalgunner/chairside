import { describe, expect, it } from 'vitest';
import { checkAllergies, checkMedicine, checkPrescription, frequencyWords, rxRef } from './rx';

const line = { medicineId: '', name: 'Amoxicillin', strength: '500 mg', form: 'capsule', dose: '1 capsule', frequency: '1-0-1', days: '5', instructions: 'after food' };

describe('medicines and prescriptions (LET-172/173)', () => {
  it('checks a medicine', () => {
    const r = checkMedicine({ name: ' Amoxicillin ', strength: '500 mg', form: 'capsule', dose: '1 capsule', frequency: '1-0-1', days: '5', instructions: 'After food' });
    expect(r.ok && r.value).toMatchObject({ name: 'Amoxicillin', days: 5, form: 'capsule' });
    const bad = checkMedicine({ name: 'A', strength: 'x'.repeat(31), form: 'potion', dose: '', frequency: '', days: '0', instructions: '' });
    expect(!bad.ok && Object.keys(bad.fieldErrors).sort()).toEqual(['days', 'form', 'name', 'strength']);
  });
  it('checks a prescription line by line', () => {
    expect(checkPrescription({ complaint: 'Pain in 36, deep caries', advice: 'Warm saline rinses', lines: [line] }).ok).toBe(true);
    const r = checkPrescription({ complaint: '', advice: '', lines: [{ ...line, frequency: '', instructions: '' }, { ...line, name: '', days: '400' }] });
    expect(!r.ok && Object.keys(r.fieldErrors).sort()).toEqual(['lines.0.frequency', 'lines.1.days', 'lines.1.name']);
    expect(checkPrescription({ complaint: '', advice: '', lines: [] }).ok).toBe(false);
    // SOS with no days is fine.
    expect(checkPrescription({ complaint: '', advice: '', lines: [{ ...line, frequency: 'SOS', days: '' }] }).ok).toBe(true);
  });
  it('words for frequency, allergies and the reference', () => {
    expect(frequencyWords('1-0-1')).toBe('1-0-1 (morning and night)');
    expect(frequencyWords('1-1-1')).toBe('1-1-1 (morning, afternoon and night)');
    expect(frequencyWords('0-0-1')).toBe('0-0-1 (night)');
    expect(frequencyWords('SOS')).toBe('SOS');
    expect(checkAllergies('  Penicillin  ').ok && checkAllergies('  Penicillin  ')).toMatchObject({ value: 'Penicillin' });
    expect(rxRef('PUN', 12)).toBe('RX/PUN/0012');
  });
});
