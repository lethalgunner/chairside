/**
 * Apply generated migrations from ./drizzle. Run on every deploy:
 *   DATABASE_URL=... npm run db:migrate
 * Never use `drizzle-kit push` against a shared database.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  // On Vercel, only production builds migrate; previews must never touch the live database.
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
    console.log(`Skipping migrations on Vercel environment "${process.env.VERCEL_ENV ?? 'unknown'}".`);
    return;
  }
  // Migrations need a session (not transaction-pooled) connection: Supabase's session pooler or direct URL.
  const url = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_MIGRATE (or DATABASE_URL) is not set');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  await sql.end();
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
