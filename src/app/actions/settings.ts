'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { updateBranchDetails, type SaveBranchResult } from '@/services/branches';
import { createCatalogueItem, setCatalogueItemActive, updateCatalogueItem, type SaveItemResult } from '@/services/catalogue';
import { previewCatalogueImport, saveCatalogueImport, type ImportPreview, type ImportSaveResult } from '@/services/catalogue-import';
import { inviteStaff, reissueInvite, setStaffActive, type InviteStaffResult } from '@/services/staff';
import { UserFacingError } from '@/services/context';
import { run, signedOut, type ActionResult } from './run';

/**
 * Owner settings (Pilot 0 slice 2). Thin: shape-check the input, resolve the
 * caller, and hand over to the service, which checks the capability and the
 * business rules. Invite tokens go back to the owner's browser once and are
 * never logged (run() logs only the action name and timing).
 */

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserFacingError('Something in the form is missing. Refresh the page and try again.');
  return r.data;
}

const inviteInput = z.object({
  fullName: z.string().max(200),
  email: z.string().max(300),
  role: z.string().max(40),
  branchId: z.string().uuid().nullable(),
  linkUserId: z.string().uuid().nullable(),
});

export async function inviteStaffAction(input: z.input<typeof inviteInput>): Promise<ActionResult<InviteStaffResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('staff.invite');
  const res = await run('staff.invite', () => inviteStaff(ctx, parse(inviteInput, input)));
  if (res.ok && res.data.ok) revalidatePath('/settings/team');
  return res;
}

const idInput = z.string().uuid();

export async function reissueInviteAction(userId: string): Promise<ActionResult<{ token: string; expiresAt: Date; fullName: string }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('staff.reinvite');
  const res = await run('staff.reinvite', () => reissueInvite(ctx, parse(idInput, userId)));
  if (res.ok) revalidatePath('/settings/team');
  return res;
}

export async function setStaffActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut(active ? 'staff.reactivate' : 'staff.deactivate');
  const res = await run(active ? 'staff.reactivate' : 'staff.deactivate', async () => {
    await setStaffActive(ctx, parse(idInput, userId), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) revalidatePath('/settings/team');
  return res;
}

const itemInput = z.object({
  code: z.string().max(40),
  name: z.string().max(200),
  category: z.string().max(100),
  price: z.string().max(30),
  taxCategory: z.string().max(40),
  hsnSacCode: z.string().max(20),
  gstRateBp: z.number().int(),
});

/** Create when id is null, otherwise edit. */
export async function saveCatalogueItemAction(id: string | null, input: z.input<typeof itemInput>): Promise<ActionResult<SaveItemResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut(id ? 'catalogue.update' : 'catalogue.create');
  const res = await run(id ? 'catalogue.update' : 'catalogue.create', () => {
    const data = parse(itemInput, input);
    return id ? updateCatalogueItem(ctx, parse(idInput, id), data) : createCatalogueItem(ctx, data);
  });
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

export async function setCatalogueItemActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut(active ? 'catalogue.reactivate' : 'catalogue.deactivate');
  const res = await run(active ? 'catalogue.reactivate' : 'catalogue.deactivate', async () => {
    await setCatalogueItemActive(ctx, parse(idInput, id), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

// Paste from Excel (T25). The 200 KB and 500-row limits are checked by the
// parser with a clear message; this cap only stops absurd bodies early.
const pasteInput = z.string().max(1_000_000);
const planInput = z.object({ newCodes: z.array(z.string().max(40)).max(1000), updateCodes: z.array(z.string().max(40)).max(1000) });

export async function previewCatalogueImportAction(text: string): Promise<ActionResult<ImportPreview>> {
  const ctx = await requireContext();
  return run('catalogue.import.check', () => previewCatalogueImport(ctx, parse(pasteInput, text)));
}

export async function saveCatalogueImportAction(text: string, confirmed: z.input<typeof planInput>): Promise<ActionResult<ImportSaveResult>> {
  const ctx = await requireContext();
  const res = await run('catalogue.import.save', () => saveCatalogueImport(ctx, parse(pasteInput, text), parse(planInput, confirmed)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

const branchInput = z.object({
  name: z.string().max(200),
  addressLine: z.string().max(400),
  city: z.string().max(120),
  state: z.string().max(80),
  phone: z.string().max(40),
  gstRegistered: z.boolean(),
  gstin: z.string().max(40),
  dayCloseTolerance: z.string().max(30),
  defaultFloat: z.string().max(30),
});

export async function saveBranchAction(branchId: string, input: z.input<typeof branchInput>): Promise<ActionResult<SaveBranchResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('branch.update');
  const res = await run('branch.update', () => updateBranchDetails(ctx, parse(idInput, branchId), parse(branchInput, input)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}
