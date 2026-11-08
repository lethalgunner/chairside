import { describe, expect, it } from 'vitest';
import { buildIcs, foldLine, googleCalendarLink, icsText } from './ics';

describe('calendar feed (LET-170)', () => {
  it('escapes text', () => {
    expect(icsText('Pune, Baner; 2\\3\nx')).toBe('Pune\\, Baner\; 2\\\\3\\nx');
  });
  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `LOCATION:${'₹'.repeat(40)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(foldLine('SHORT:x')).toBe('SHORT:x');
  });
  it('builds a feed with UTC times and CRLF line ends', () => {
    const ics = buildIcs('Dr X · Chairside', [{ uid: 'a1@chairside', start: new Date('2026-11-09T05:30:00Z'), end: new Date('2026-11-09T05:45:00Z'), summary: 'Appointment · 15 min', location: 'Demo Pune' }], new Date('2026-11-08T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261109T053000Z\r\n');
    expect(ics).toContain('DTEND:20261109T054500Z\r\n');
    expect(ics).toContain('X-WR-CALNAME:Dr X · Chairside');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });
});

describe('Google Calendar add link', () => {
  it('carries UTC times and the place, encoded', () => {
    const url = new URL(googleCalendarLink({ title: 'Dental appointment, Vij Dental Care Pune', start: new Date('2026-11-09T05:30:00Z'), end: new Date('2026-11-09T05:45:00Z'), location: 'FC Road, Pune' }));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261109T053000Z/20261109T054500Z');
    expect(url.searchParams.get('text')).toBe('Dental appointment, Vij Dental Care Pune');
    expect(url.searchParams.get('location')).toBe('FC Road, Pune');
  });
});
