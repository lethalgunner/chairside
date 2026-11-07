import { describe, expect, it } from 'vitest';
import { checkHours, checkProvider, hoursLabel, minutesOf, type ProviderInput } from './providers';

const base: ProviderInput = { fullName: '  Dr.  Meera   Rao ', qualification: 'BDS, MDS', registrationNumber: 'A-12345', registrationCouncil: 'Maharashtra State Dental Council', specialty: 'Endodontics', engagementType: 'associate', colour: '#1D4ED8', slotMinutes: 15 };

describe('doctor profile rules (LET-166)', () => {
  it('tidies names and keeps optional fields optional', () => {
    const r = checkProvider(base);
    expect(r.ok && r.value).toMatchObject({ fullName: 'Dr. Meera Rao', colour: '#1d4ed8', engagementType: 'associate' });
    const bare = checkProvider({ ...base, qualification: ' ', registrationNumber: '', registrationCouncil: '', specialty: '', colour: '' });
    expect(bare.ok && bare.value).toMatchObject({ qualification: null, registrationNumber: null, colour: null });
  });
  it('refuses bad values per field', () => {
    const r = checkProvider({ ...base, fullName: 'X', registrationNumber: 'A<script>', engagementType: 'boss', colour: '#123456', slotMinutes: 12 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(['colour', 'engagementType', 'fullName', 'registrationNumber', 'slotMinutes']);
  });
});

describe('working hours', () => {
  it('parses times', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('24:00')).toBeNull();
    expect(minutesOf('9:30')).toBeNull();
  });
  it('needs a day and at least an hour', () => {
    expect(checkHours({ days: [1, 2, 3], startTime: '10:00', endTime: '19:00' }).ok).toBe(true);
    const r = checkHours({ days: [], startTime: '18:30', endTime: '19:00' });
    expect(!r.ok && Object.keys(r.fieldErrors).sort()).toEqual(['days', 'endTime']);
    expect(checkHours({ days: [8], startTime: '10:00', endTime: '19:00' }).ok).toBe(false);
  });
  it('labels a week', () => {
    expect(hoursLabel({ days: [1, 2, 3, 4, 5, 6], startTime: '10:00', endTime: '19:00' })).toBe('Mon–Sat, 10:00–19:00');
    expect(hoursLabel({ days: [2, 4], startTime: '17:00', endTime: '20:00' })).toBe('Tue, Thu, 17:00–20:00');
  });
});
