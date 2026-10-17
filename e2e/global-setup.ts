import { execSync } from 'node:child_process';
import postgres from 'postgres';

/** Fresh e2e database with the demo org and two synthetic logins. Refuses non-e2e databases. */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL_E2E ?? 'postgresql://postgres@localhost:5432/chairside_e2e';
  const u = new URL(url);
  if (!/e2e/i.test(u.pathname)) throw new Error(`Refusing to reset ${u.pathname}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  const name = u.pathname.slice(1);
  await sql.unsafe(`drop database if exists "${name}" with (force)`);
  await sql.unsafe(`create database "${name}"`);
  await sql.end();
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx tsx scripts/migrate.ts', { env, stdio: 'inherit' });
  execSync('npx tsx scripts/seed.ts seed/demo.json', { env, stdio: 'ignore' });
  execSync('npx tsx scripts/add-user.ts --org "Demo Dental Group" --email owner@demo.local --link-doctor "Dr. Demo Owner" --role owner', {
    env: { ...env, CHAIRSIDE_NEW_PASSWORD: 'demo-owner-pass' },
    stdio: 'ignore',
  });
  execSync('npx tsx scripts/add-user.ts --org "Demo Dental Group" --email desk@demo.local --name "Priya (front desk)" --role front_desk --branch DPN', {
    env: { ...env, CHAIRSIDE_NEW_PASSWORD: 'demo-desk-pass' },
    stdio: 'ignore',
  });
}
