import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';

export const dynamic = 'force-dynamic';

/** Uptime check: app is up and can reach the database. Reveals nothing else. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
