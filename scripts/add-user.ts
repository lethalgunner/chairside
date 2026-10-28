/**
 * Invite-only accounts (ADR-012). Creates or updates a login and its role grants.
 * The owner can now do the same from /settings/team; this stays for the first
 * owner and for local development.
 *
 *   npm run user:add -- --org "Dr. Vij Dental Clinic & Implant Center" \
 *     --name "Front desk Pune" --email desk.pune@example.com \
 *     --role front_desk --branch PUN
 *
 * Roles: owner, branch_manager, front_desk, doctor, associate_doctor, assistant,
 * accountant, auditor. Omit --branch for an org-wide grant (owner must be org-wide).
 * Two ways to give access:
 *  - Invite (default when APP_URL is set, or with --invite): prints a one-time
 *    link, valid 72 hours, where the person chooses their own password.
 *  - Password (local development): read from CHAIRSIDE_NEW_PASSWORD, or
 *    generated and printed once.
 * Use --link-doctor "Dr. Anshul Vij" to give an existing doctor record a login.
 * The rules (email lower-cased, other orgs' emails refused, grants) live in
 * src/domain/staff.ts and src/services/staff.ts, shared with the app.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client';
import { branches, organisations, users } from '../src/db/schema';
import { checkStaffGrant, normaliseEmail, type StaffGrant } from '../src/domain/staff';
import { createInvite } from '../src/lib/auth/invite';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/auth/password';
import { upsertStaffGrant } from '../src/services/staff';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}

async function main() {
  const orgName = arg('org');
  const email = normaliseEmail(arg('email') ?? '');
  const name = arg('name');
  const linkDoctor = arg('link-doctor');
  const roles = args('role');
  const branchCode = arg('branch');
  if (!orgName || !email || (!name && !linkDoctor) || roles.length === 0) {
    throw new Error('Required: --org, --email, --name (or --link-doctor), and at least one --role');
  }

  const db = getDb();
  const [org] = await db.select().from(organisations).where(eq(organisations.name, orgName)).limit(1);
  if (!org) throw new Error(`No org named "${orgName}". Run the seed first.`);
  let branchId: string | null = null;
  if (branchCode) {
    const [b] = await db.select().from(branches).where(and(eq(branches.orgId, org.id), eq(branches.code, branchCode))).limit(1);
    if (!b) throw new Error(`No branch ${branchCode}`);
    branchId = b.id;
  }
  let linkUserId: string | null = null;
  if (linkDoctor) {
    const [d] = await db.select({ id: users.id }).from(users).where(and(eq(users.orgId, org.id), eq(users.fullName, linkDoctor))).limit(1);
    if (!d) throw new Error(`No doctor named "${linkDoctor}"`);
    linkUserId = d.id;
  }

  const grants: StaffGrant[] = roles.map((role) => {
    const checked = checkStaffGrant({ fullName: name ?? '', email, role, branchId, linkUserId }, { orgWideAllowed: true });
    if (!checked.ok) throw new Error(Object.values(checked.fieldErrors).join(' '));
    return checked.value;
  });

  const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
  const inviteMode = process.argv.includes('--invite') || (!!appUrl && !process.env.CHAIRSIDE_NEW_PASSWORD);
  if (inviteMode && !appUrl) throw new Error('Invites need APP_URL, e.g. APP_URL=https://chairside.example.com');

  let password: string | undefined;
  let passwordHash: string | undefined;
  let generated = false;
  if (!inviteMode) {
    password = process.env.CHAIRSIDE_NEW_PASSWORD;
    generated = !password;
    if (!password) password = randomBytes(12).toString('base64url');
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    passwordHash = await hashPassword(password);
  }

  const userId = await db.transaction(async (tx) => {
    let id = '';
    for (const g of grants) id = (await upsertStaffGrant(tx, org.id, null, g, { passwordHash, renameExisting: true })).userId;
    return id;
  });

  const scope = `${roles.join(', ')}${branchCode ? ` at ${branchCode}` : ', all branches'}`;
  if (inviteMode) {
    const { token, expiresAt } = await createInvite(db, { orgId: org.id, userId });
    const link = `${appUrl}/setup?token=${token}`;
    console.log(`Invite for ${email} (${scope}). Send privately; it works once, until ${expiresAt.toISOString()}:`);
    console.log(link);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Invite for ${email}\n\n${scope}. Works once, for 72 hours.\n\n\`${link}\`\n`);
    }
  } else {
    console.log(`Login ready for ${email} (${scope}).`);
    if (generated) console.log(`Temporary password (shown once, share privately): ${password}`);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
