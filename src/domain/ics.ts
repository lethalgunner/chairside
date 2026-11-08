/**
 * A minimal iCalendar (RFC 5545) feed for the per-doctor calendar link
 * (Sprint 4, LET-170). Pure. CRLF line ends, escaped text, lines folded at
 * 75 octets. Events carry times and a branch, never a patient's name.
 */

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line to 75 octets per line (continuations start with a space), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(calendarName: string, events: IcsEvent[], now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chairside//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * A Google Calendar "add event" link (calendar.google.com/calendar/render,
 * action=TEMPLATE). Opens a pre-filled event the person saves themselves:
 * nothing is sent by Chairside, nothing stored at Google by us. Used in the
 * patient's WhatsApp confirmation (LET-167 follow-up, 9 Nov).
 */
export function googleCalendarLink(e: { title: string; start: Date; end: Date; location?: string; details?: string }): string {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${stamp(e.start)}/${stamp(e.end)}` });
  if (e.location) p.set('location', e.location);
  if (e.details) p.set('details', e.details);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
