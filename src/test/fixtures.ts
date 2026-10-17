/**
 * Synthetic org for database tests. Every call creates a fresh org with unique
 * branch codes and emails, so test files never collide.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '@/db/client';
import { branches, catalogueItems, memberships, organisations, users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import type { Grant, Role } from '@/domain/permissions';
import type { TenantContext } from '@/services/context';

let counter = 0;
function code(): string {
  counter += 1;
  const n = (Date.now() + counter) % 46656; // 36^3
  return n.toString(36).toUpperCase().padStart(3, '0');
}

export interface Fixture {
  orgId: string;
  pune: { id: string; code: string };
  kanpur: { id: string; code: string };
  items: { rct: string; crown: string; brush: string; whitening: string };
  doctorId: string;
  ownerId: string;
  password: string;
  emails: { owner: string; desk: string; manager: string; accountant: string };
  ctx: (who: 'owner' | 'desk' | 'manager' | 'accountant' | 'kanpurDesk', active?: string | 'all') => TenantContext;
}

export async function createFixture(): Promise<Fixture> {
  const db = getDb();
  const [org] = await db.insert(organisations).values({ name: `Test Dental ${randomUUID().slice(0, 6)}` }).returning();
  const orgId = org!.id;
  const puneCode = code();
  let kanpurCode = code();
  if (kanpurCode === puneCode) kanpurCode = code();
  const [pune] = await db
    .insert(branches)
    .values({ orgId, name: 'Pune', code: puneCode, city: 'Pune', state: 'Maharashtra', gstRegistered: true, gstin: '27AAAAA0000A1Z5' })
    .returning();
  const [kanpur] = await db
    .insert(branches)
    .values({ orgId, name: 'Kanpur', code: kanpurCode, city: 'Kanpur', state: 'Uttar Pradesh', gstRegistered: false })
    .returning();

  const password = 'correct horse battery';
  const hash = await hashPassword(password);
  const tag = randomUUID().slice(0, 8);
  const emails = {
    owner: `owner-${tag}@test.local`,
    desk: `desk-${tag}@test.local`,
    manager: `manager-${tag}@test.local`,
    accountant: `ca-${tag}@test.local`,
  };
  const mk = async (fullName: string, email: string | null, withPassword: boolean) =>
    (await db.insert(users).values({ orgId, fullName, email, passwordHash: withPassword ? hash : null }).returning())[0]!.id;

  const ownerId = await mk('Dr Owner', emails.owner, true);
  const deskId = await mk('Desk Pune', emails.desk, true);
  const managerId = await mk('Manager Pune', emails.manager, true);
  const accountantId = await mk('CA', emails.accountant, true);
  const kanpurDeskId = await mk('Desk Kanpur', null, false);
  const doctorId = await mk('Dr Associate', null, false);

  const grants: Record<string, Grant[]> = {
    [ownerId]: [{ role: 'owner', branchId: null }, { role: 'doctor', branchId: null }],
    [deskId]: [{ role: 'front_desk', branchId: pune!.id }],
    [managerId]: [{ role: 'branch_manager', branchId: pune!.id }],
    [accountantId]: [{ role: 'accountant', branchId: null }],
    [kanpurDeskId]: [{ role: 'front_desk', branchId: kanpur!.id }],
    [doctorId]: [{ role: 'associate_doctor', branchId: pune!.id }],
  };
  for (const [userId, gs] of Object.entries(grants)) {
    for (const g of gs) await db.insert(memberships).values({ orgId, userId, branchId: g.branchId, role: g.role as Role });
  }

  const item = async (c: string, name: string, price: number, taxCategory: 'exempt_healthcare' | 'goods_prosthetic' | 'goods_retail' | 'cosmetic_service', hsn: string, rate: number) =>
    (await db.insert(catalogueItems).values({ orgId, code: c, name, defaultPricePaise: price, taxCategory, hsnSacCode: hsn, gstRateBp: rate, isGoods: taxCategory.startsWith('goods') }).returning())[0]!.id;
  const items = {
    rct: await item('RCT', 'Root canal treatment', 450_000, 'exempt_healthcare', '9993', 0),
    crown: await item('CRN', 'Zirconia crown', 600_000, 'goods_prosthetic', '9021', 1200),
    brush: await item('TBR', 'Toothbrush', 12_000, 'goods_retail', '3306', 1800),
    whitening: await item('WHT', 'Teeth whitening', 900_000, 'cosmetic_service', '9997', 1800),
  };

  const ids = { owner: ownerId, desk: deskId, manager: managerId, accountant: accountantId, kanpurDesk: kanpurDeskId };
  const branchIds = [kanpur!.id, pune!.id];
  return {
    orgId,
    pune: { id: pune!.id, code: puneCode },
    kanpur: { id: kanpur!.id, code: kanpurCode },
    items,
    doctorId,
    ownerId,
    password,
    emails,
    ctx: (who, active) => {
      const userId = ids[who];
      const g = grants[userId]!;
      const visible = g.some((x) => x.branchId === null) ? branchIds : branchIds.filter((b) => g.some((x) => x.branchId === b));
      return {
        orgId,
        userId,
        userName: who,
        grants: g,
        branchIds: visible,
        activeBranchId: active ?? (visible.length === 1 ? visible[0]! : pune!.id),
      };
    },
  };
}

export function key(): string {
  return randomUUID();
}
