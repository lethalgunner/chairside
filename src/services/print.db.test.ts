import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { createFixture, type Fixture } from '@/test/fixtures';
import { getPrintHeader, savePrintHeader } from './branches';
import { ForbiddenError } from './context';

let f: Fixture;
let other: Fixture;
const png = `data:image/png;base64,${btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9))}`;

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('bill header (LET-174)', () => {
  it('falls back to the branch, then prints what the owner saved; GSTIN only when registered', async () => {
    const before = await getPrintHeader(f.ctx('desk'), f.pune.id);
    expect(before).toMatchObject({ name: 'Pune', gstin: '27AAAAA0000A1Z5', logo: null });
    expect((await getPrintHeader(f.ctx('kanpurDesk'), f.kanpur.id)).gstin).toBeNull();
    const r = await savePrintHeader(f.ctx('owner'), f.pune.id, { printName: 'Vij Dental Care', printAddress: '12 MG Road\nPune 411001', printEmail: 'hello@vij.example', printFooter: 'Mon–Sat 10–7', printLogo: png });
    expect(r).toEqual({ ok: true });
    expect(await getPrintHeader(f.ctx('desk'), f.pune.id)).toMatchObject({ name: 'Vij Dental Care', addressLines: ['12 MG Road', 'Pune 411001'], email: 'hello@vij.example', footer: 'Mon–Sat 10–7', logo: png });
    const audit = await getDb().select().from(auditLog).where(eq(auditLog.action, 'branch.print_header'));
    const mine = audit.filter((a) => a.entityId === f.pune.id);
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine[0])).not.toContain('base64');
  });

  it('refuses a fake image, and anyone but the owner, and other orgs', async () => {
    const bad = await savePrintHeader(f.ctx('owner'), f.pune.id, { printName: '', printAddress: '', printEmail: '', printFooter: '', printLogo: `data:image/png;base64,${btoa('<svg/>')}` });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { printLogo: expect.any(String) } });
    const ok = { printName: 'x', printAddress: '', printEmail: '', printFooter: '', printLogo: '' };
    for (const who of ['desk', 'manager', 'accountant'] as const) await expect(savePrintHeader(f.ctx(who), f.pune.id, ok)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(savePrintHeader(other.ctx('owner'), f.pune.id, ok)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPrintHeader(other.ctx('owner'), f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
