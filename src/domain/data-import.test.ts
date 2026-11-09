import { describe, expect, it } from 'vitest';
import { doctorKey, headerMap, parseAppointments, parsePatients, readDate, readTime, PATIENT_COLUMNS } from './data-import';

const today = '2026-11-10';

describe('readDate and readTime', () => {
  it('day-first Indian dates and ISO; impossible dates refused', () => {
    expect(readDate('21/11/2026')).toBe('2026-11-21');
    expect(readDate('1-2-27')).toBe('2027-02-01');
    expect(readDate('2026-11-21')).toBe('2026-11-21');
    expect(readDate('2026-11-21 10:00')).toBe('2026-11-21');
    expect(readDate('31/02/2026')).toBeNull();
    expect(readDate('Nov 21')).toBeNull();
  });
  it('24-hour and am/pm times', () => {
    expect(readTime('11:00')).toBe('11:00');
    expect(readTime('9:30')).toBe('09:30');
    expect(readTime('4 pm')).toBe('16:00');
    expect(readTime('04:30 PM')).toBe('16:30');
    expect(readTime('12:15 a.m.')).toBe('00:15');
    expect(readTime('12 pm')).toBe('12:00');
    expect(readTime('11')).toBeNull();
    expect(readTime('25:00')).toBeNull();
  });
  it('doctor names match without Dr / punctuation / case', () => {
    expect(doctorKey('Dr. Anil  Mehta')).toBe('anil mehta');
    expect(doctorKey('anil mehta')).toBe('anil mehta');
  });
});

describe('parsePatients', () => {
  it('finds columns by their header names in any order (a typical export)', () => {
    expect(headerMap(['Patient Name', 'Gender', 'Contact No.', 'Age'], PATIENT_COLUMNS)).toEqual(new Map([['name', 0], ['sex', 1], ['mobile', 2], ['age', 3]]));
    const r = parsePatients('Patient Name,Gender,Contact No.,DOB\nAsha Rao,Female,+91 98765 43210,21/03/1985\n', today);
    expect(r).toEqual({ ok: true, header: true, rows: [{ line: 2, error: null, value: { fullName: 'Asha Rao', phone: '9876543210', sex: 'F', age: null, dateOfBirth: '1985-03-21' } }] });
  });
  it('without a header the order is Name, Mobile, Sex, Age; tabs from Excel work; blank rows ignored', () => {
    const r = parsePatients('Ravi Kumar\t9812345678\tM\t40\n\n', today);
    expect(r.ok && r.rows.map((x) => x.value)).toEqual([{ fullName: 'Ravi Kumar', phone: '9812345678', sex: 'M', age: 40, dateOfBirth: null }]);
  });
  it('each bad row says what is wrong, in staff words', () => {
    const r = parsePatients('Name,Mobile,Sex,Age\nX,12345,Q,200\n', today);
    expect(r.ok && r.rows[0]!.error).toBe('Name is missing; mobile isn’t a 10-digit Indian number; sex should be M, F or O (or blank); age should be 0 to 120.');
  });
  it('empty paste and too many rows are refused up front', () => {
    expect(parsePatients('  ', today)).toEqual({ ok: false, error: 'Paste the rows first.' });
    const many = Array.from({ length: 1002 }, (_, i) => `P${i} Name,98${String(10000000 + i)}`).join('\n');
    expect(parsePatients(many, today).ok).toBe(false);
  });
});

describe('parseAppointments', () => {
  it('reads mobile, name, date, time, doctor and optional minutes', () => {
    const r = parseAppointments('Mobile,Patient,Date,Time,Doctor,Duration\n9876543210,Asha Rao,21/11/2026,4:30 pm,Dr. Mehta,30\n');
    expect(r.ok && r.rows[0]!.value).toEqual({ phone: '9876543210', name: 'Asha Rao', date: '2026-11-21', time: '16:30', doctor: 'Dr. Mehta', minutes: 30 });
  });
  it('bad rows explain themselves', () => {
    const r = parseAppointments('Mobile,Patient,Date,Time,Doctor,Minutes\n98765,Asha,32/11/2026,noon,,7\n');
    expect(r.ok && r.rows[0]!.error).toBe('Mobile isn’t a 10-digit Indian number; date should look like 21/11/2026; time should look like 11:00 or 4:30 pm; doctor is missing; minutes should be 5 to 240, in 5s.');
  });
});
