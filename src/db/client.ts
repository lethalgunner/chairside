import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DB = PostgresJsDatabase<typeof schema>;
/** An open transaction. Services accept a DB or a Tx. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

declare global {
  // eslint-disable-next-line no-var
  var __chairsideDb: { db: DB; sql: postgres.Sql } | undefined;
}

function connect(): { db: DB; sql: postgres.Sql } {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. See .env.example.');
  // prepare:false keeps us compatible with transaction-mode poolers (Supabase).
  const sql = postgres(url, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema }), sql };
}

/** One pool per process; survives Next.js hot reload in dev. */
export function getDb(): DB {
  globalThis.__chairsideDb ??= connect();
  return globalThis.__chairsideDb.db;
}

export async function closeDb(): Promise<void> {
  if (globalThis.__chairsideDb) {
    await globalThis.__chairsideDb.sql.end({ timeout: 5 });
    globalThis.__chairsideDb = undefined;
  }
}
