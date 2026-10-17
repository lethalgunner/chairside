/**
 * Wipe and re-migrate the test database once per `npm run test:db` run.
 * Refuses to run against anything that doesn't look like a test database.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to wipe ${new URL(url).pathname}: the database name must contain "test".`);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  await sql.end();
  process.env.DATABASE_URL = url;
}
