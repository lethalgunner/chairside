/**
 * Invite-only accounts (ADR-012). Creates or updates a login and its role grants.
 *
 *   npm run user:add -- --org "Dr. Vij Dental Clinic & Implant Center" \
 *     --name "Front desk Pune" --email desk.pune@example.com \
 *     --role front_desk --branch PUN
 *
 * Roles: owner, branch_manager, front_desk, doctor, associate_doctor, assistant,
 * accountant, auditor. Omit --branch for an org-wide grant (owner must be org-wide).
 * The password is read from CHAIRSIDE_NEW_PASSWORD, or generated and printed once.
 * Use --link-doctor "Dr. Anshul Vij" to give an existing doctor record a login.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client';
import { branches, memberships, organisations, users } from '../src/db/schema';
import type { Role } from '../src/domain/permissions';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/auth/password';

const ROLES: Role[] = ['owner', 'branch_manager', 'front_desk', 'doctor', 'associate_doctor', 'assistant', 'accountant', 'auditor'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}

async function main() {
  const orgName = arg('org');
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name');
  const linkDoctor = arg('link-doctor');
  const roles = args('role') as Role[];
  const branchCode = arg('branch');
  if (!orgName || !email || (!name && !linkDoctor) || roles.length === 0) {
    throw new Error('Required: --org, --email, --name (or --link-doctor), and at least one --role');
  }
  for (const r of roles) if (!ROLES.includes(r)) throw new Error(`Unknown role ${r}`);
  if (roles.includes('owner') && branchCode) throw new Error('Owner grants are org-wide; drop --branch');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That does not look like an email address');

  const db = getDb();
  const [org] = await db.select().from(organisations).where(eq(organisations.name, orgName)).limit(1);
  if (!org) throw new Error(`No org named "${orgName}". Run the seed first.`);
  let branchId: string | null = null;
  if (branchCode) {
    const [b] = await db.select().from(branches).where(and(eq(branches.orgId, org.id), eq(branches.code, branchCode))).limit(1);
    if (!b) throw new Error(`No branch ${branchCode}`);
    branchId = b.id;
  }

  let password = process.env.CHAIRSIDE_NEW_PASSWORD;
  const generated = !password;
  if (!password) password = randomBytes(12).toString('base64url');
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const passwordHash = await hashPassword(password);

  let [user] = linkDoctor
    ? await db.select().from(users).where(and(eq(users.orgId, org.id), eq(users.fullName, linkDoctor))).limit(1)
    : await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user && user.orgId !== org.id) throw new Error('That email belongs to another organisation');
  if (user) {
    await db.update(users).set({ email, passwordHash, active: true, ...(name ? { fullName: name } : {}) }).where(eq(users.id, user.id));
  } else {
    if (linkDoctor) throw new Error(`No doctor named "${linkDoctor}"`);
    [user] = await db.insert(users).values({ orgId: org.id, fullName: name!, email, passwordHash }).returning();
  }

  for (const role of roles) {
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, user!.id), eq(memberships.role, role), branchId ? eq(memberships.branchId, branchId) : isNull(memberships.branchId)))
      .limit(1);
    if (!m) await db.insert(memberships).values({ orgId: org.id, userId: user!.id, branchId, role });
  }

  console.log(`Login ready for ${email} (${roles.join(', ')}${branchCode ? ` at ${branchCode}` : ', all branches'}).`);
  if (generated) console.log(`Temporary password (shown once, share privately): ${password}`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
