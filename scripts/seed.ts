/**
 * Load an org, its branches, doctors and price list from a JSON file.
 *   npm run seed -- seed/pilot0.json
 * Idempotent: matches on org name, branch code, catalogue code and doctor name,
 * updating in place. Never deletes. Staff logins are created separately with
 * `npm run user:add` so no password ever sits in a file.
 */
import { readFileSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { closeDb, getDb } from '../src/db/client';
import { branches, catalogueItems, memberships, organisations, users } from '../src/db/schema';
import { isValidBranchCode } from '../src/domain/numbering';

const file = z.object({
  org: z.object({ name: z.string().min(2) }),
  branches: z
    .array(
      z.object({
        code: z.string().refine(isValidBranchCode, 'branch code must be 3 uppercase letters/digits'),
        name: z.string(),
        addressLine: z.string().optional(),
        city: z.string().optional(),
        state: z.string(),
        phone: z.string().optional(),
        gstRegistered: z.boolean(),
        gstin: z.string().nullable(),
        dayCloseTolerancePaise: z.number().int().nonnegative().default(10_000),
        defaultFloatPaise: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
  doctors: z.array(z.object({ fullName: z.string(), branches: z.array(z.string()).nullable() })),
  catalogue: z.array(
    z.object({
      code: z.string().min(1),
      name: z.string().min(2),
      category: z.string().optional(),
      pricePaise: z.number().int().nonnegative(),
      taxCategory: z.enum(['exempt_healthcare', 'goods_prosthetic', 'goods_retail', 'cosmetic_service', 'other_taxable']),
      hsnSacCode: z.string().min(4),
      gstRateBp: z.number().int().min(0).max(2800),
    }),
  ),
});

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: npm run seed -- seed/pilot0.json');
  const data = file.parse(JSON.parse(readFileSync(path, 'utf8')));
  for (const b of data.branches) {
    if (b.gstRegistered && !b.gstin) throw new Error(`${b.name} is marked GST-registered but has no GSTIN`);
  }
  const db = getDb();

  let [org] = await db.select().from(organisations).where(eq(organisations.name, data.org.name)).limit(1);
  if (!org) [org] = await db.insert(organisations).values({ name: data.org.name }).returning();
  const orgId = org!.id;

  const branchIds = new Map<string, string>();
  for (const b of data.branches) {
    const values = {
      orgId,
      code: b.code,
      name: b.name,
      addressLine: b.addressLine ?? null,
      city: b.city ?? null,
      state: b.state,
      phone: b.phone ?? null,
      gstRegistered: b.gstRegistered,
      gstin: b.gstin,
      dayCloseTolerancePaise: b.dayCloseTolerancePaise,
      defaultFloatPaise: b.defaultFloatPaise,
    };
    const [existing] = await db.select().from(branches).where(and(eq(branches.orgId, orgId), eq(branches.code, b.code))).limit(1);
    if (existing) {
      await db.update(branches).set(values).where(eq(branches.id, existing.id));
      branchIds.set(b.code, existing.id);
    } else {
      const [row] = await db.insert(branches).values(values).returning();
      branchIds.set(b.code, row!.id);
    }
  }

  for (const d of data.doctors) {
    let [u] = await db.select().from(users).where(and(eq(users.orgId, orgId), eq(users.fullName, d.fullName))).limit(1);
    if (!u) [u] = await db.insert(users).values({ orgId, fullName: d.fullName }).returning();
    const targets = d.branches === null ? [null] : d.branches.map((c) => {
      const id = branchIds.get(c);
      if (!id) throw new Error(`Doctor ${d.fullName} refers to unknown branch ${c}`);
      return id;
    });
    for (const branchId of targets) {
      const [m] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, u!.id), eq(memberships.role, 'doctor'), branchId ? eq(memberships.branchId, branchId) : isNull(memberships.branchId)))
        .limit(1);
      if (!m) await db.insert(memberships).values({ orgId, userId: u!.id, branchId, role: 'doctor' });
    }
  }

  for (const c of data.catalogue) {
    const values = {
      orgId,
      code: c.code,
      name: c.name,
      category: c.category ?? null,
      defaultPricePaise: c.pricePaise,
      taxCategory: c.taxCategory,
      hsnSacCode: c.hsnSacCode,
      gstRateBp: c.gstRateBp,
      isGoods: c.taxCategory.startsWith('goods'),
    };
    const [existing] = await db.select().from(catalogueItems).where(and(eq(catalogueItems.orgId, orgId), eq(catalogueItems.code, c.code))).limit(1);
    if (existing) await db.update(catalogueItems).set(values).where(eq(catalogueItems.id, existing.id));
    else await db.insert(catalogueItems).values(values);
  }

  console.log(`Seeded "${data.org.name}": ${data.branches.length} branches, ${data.doctors.length} doctors, ${data.catalogue.length} catalogue items.`);
  console.log(`Org id: ${orgId}. Create logins with: npm run user:add -- --org "${data.org.name}" ...`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err instanceof z.ZodError ? err.issues : err);
  await closeDb();
  process.exit(1);
});
