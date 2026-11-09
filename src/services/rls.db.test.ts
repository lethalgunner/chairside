import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDb, getDb } from '@/db/client';
import { sql as dsql } from 'drizzle-orm';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { issueBill } from './invoices';
import { registerPatient } from './patients';

/**
 * Tenant isolation in the database (Sprint 7, step 1; CTO S1). Every table with
 * org_id is read under the app role with one clinic's id set, and must show
 * none of the other clinic's rows; writes for the other clinic are refused;
 * no tenant set means no rows. Runs as a login in role chairside_app, the role
 * the app will use in step 2. A table added later without a policy fails here.
 */

const ROLE = 'chairside_rls_test';
const PASSWORD = 'rls-test-only';
let a: Fixture;
let b: Fixture;
let app: postgres.Sql;
let tables: string[];

beforeAll(async () => {
  a = await createFixture();
  b = await createFixture();
  // Some rows in most tables for both clinics.
  for (const f of [a, b]) {
    const r = await registerPatient(f.ctx('desk'), { fullName: 'Rls Patient', phone: `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`, sex: 'F', age: 40, acknowledgedDuplicate: true });
    if (!r.ok) throw new Error('registration failed');
    await issueBill(f.ctx('desk'), { patientId: r.patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
  }
  const db = getDb();
  await db.execute(dsql.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' IN ROLE chairside_app; END IF; END $$`));
  const url = new URL(process.env.DATABASE_URL_TEST!);
  url.username = ROLE;
  url.password = PASSWORD;
  app = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const rows = await db.execute<{ table_name: string }>(dsql`select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE' where c.table_schema = 'public' and c.column_name = 'org_id' order by 1`);
  tables = (rows as unknown as { table_name: string }[]).map((r) => r.table_name);
});
afterAll(async () => {
  await app?.end();
  await closeDb();
});

const asTenant = <T>(orgId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  app.begin(async (tx) => {
    if (orgId) await tx`select set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  }) as Promise<T>;

describe('row-level security under the app role', () => {
  it('covers every table that has org_id, plus organisations', async () => {
    expect(tables.length).toBeGreaterThan(30);
    const pol = await getDb().execute<{ tablename: string }>(dsql`select tablename from pg_policies where schemaname = 'public' and policyname = 'tenant_isolation'`);
    const covered = new Set((pol as unknown as { tablename: string }[]).map((p) => p.tablename));
    expect(tables.filter((t) => !covered.has(t))).toEqual([]);
    expect(covered.has('organisations')).toBe(true);
  });

  it("one clinic sees none of the other clinic's rows, in any table", async () => {
    const leaks: string[] = [];
    for (const t of tables) {
      const [{ n }] = await asTenant(a.orgId, (tx) => tx.unsafe(`select count(*)::int as n from public."${t}" where org_id = $1`, [b.orgId])) as unknown as [{ n: number }];
      if (n !== 0) leaks.push(`${t}: ${n}`);
    }
    expect(leaks).toEqual([]);
    // And it does see its own.
    const [{ n }] = await asTenant(a.orgId, (tx) => tx`select count(*)::int as n from patients`) as unknown as [{ n: number }];
    expect(n).toBeGreaterThan(0);
    const orgs = await asTenant(a.orgId, (tx) => tx`select id from organisations`);
    expect(orgs.map((o) => o.id)).toEqual([a.orgId]);
  });

  it('no tenant set means no rows (fails closed)', async () => {
    const [{ n }] = await asTenant(null, (tx) => tx`select count(*)::int as n from invoices`) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });

  it("writing a row for another clinic is refused", async () => {
    await expect(
      asTenant(a.orgId, async (tx) => {
        const [p] = await tx`select id from patients limit 1`;
        return tx`insert into recalls (org_id, branch_id, patient_id, due_on, kind) values (${b.orgId}, ${b.pune.id}, ${p!.id}, current_date, 'checkup')`;
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('auth lookups work before the tenant is known, and only in that mode', async () => {
    const users = await app.begin(async (tx) => {
      await tx`select set_config('app.auth_lookup', 'on', true)`;
      return tx`select count(*)::int as n from users`;
    });
    expect((users[0] as { n: number }).n).toBeGreaterThan(0);
    const none = await asTenant(null, (tx) => tx`select count(*)::int as n from users`);
    expect((none[0] as { n: number }).n).toBe(0);
  });
});
