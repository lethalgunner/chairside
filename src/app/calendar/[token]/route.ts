import { NextResponse } from 'next/server';
import { buildIcs } from '@/domain/ics';
import { calendarFeed } from '@/services/appointments';

/**
 * A doctor's private calendar feed (Sprint 4, LET-170), subscribed from Google
 * or iPhone Calendar. No session: the unguessable token is the credential
 * (stored hashed, replaceable from Settings → Doctors). Never cached.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = token.replace(/\.ics$/, '');
  const feed = await calendarFeed(raw);
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' };
  if (!feed) return new NextResponse('Not found', { status: 404, headers });
  return new NextResponse(buildIcs(`${feed.name} · Chairside`, feed.events), {
    headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="chairside.ics"' },
  });
}
