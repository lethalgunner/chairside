'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { saveClinicSettings, type SaveClinicResult } from '@/services/clinic';
import { saveDiscountCaps } from '@/services/discounts';
import { createBranch, savePrintHeader, updateBranchDetails, type CreateBranchResult, type SaveBranchResult } from '@/services/branches';
import { addItemFromBill, createCatalogueItem, setCatalogueItemActive, updateCatalogueItem, type BillItemResult, type SaveItemResult } from '@/services/catalogue';
import { addMeAsDoctor, issueCalendarToken, revokeCalendarToken, saveProvider, setProviderActive, setProviderHours, type SaveProviderResult } from '@/services/providers';
import { previewCatalogueImport, saveCatalogueImport, type ImportPreview, type ImportSaveResult } from '@/services/catalogue-import';
import { addRole, inviteStaff, passwordResetLink, reissueInvite, removeRole, setStaffActive, type InviteStaffResult } from '@/services/staff';
import { requireActiveBranch, UserFacingError } from '@/services/context';
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

export async function passwordResetLinkAction(userId: string): Promise<ActionResult<{ token: string; expiresAt: Date; fullName: string }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('staff.reset_link');
  const res = await run('staff.reset_link', () => passwordResetLink(ctx, parse(idInput, userId)));
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
const schedulingInput = z.object({ minutes: z.string().max(10), recallDays: z.string().max(10), recallKind: z.string().max(20) });

export async function saveCatalogueItemAction(id: string | null, input: z.input<typeof itemInput>, scheduling?: z.input<typeof schedulingInput>): Promise<ActionResult<SaveItemResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut(id ? 'catalogue.update' : 'catalogue.create');
  const res = await run(id ? 'catalogue.update' : 'catalogue.create', () => {
    const data = parse(itemInput, input);
    const sched = scheduling === undefined ? undefined : parse(schedulingInput, scheduling);
    return id ? updateCatalogueItem(ctx, parse(idInput, id), data, sched) : createCatalogueItem(ctx, data, sched);
  });
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

const billItemInput = itemInput.pick({ name: true, price: true, taxCategory: true, hsnSacCode: true, gstRateBp: true });

/** "+ New item" on the bill: adds to the price list and returns the item priced for the active branch. */
export async function addBillItemAction(input: z.input<typeof billItemInput>): Promise<ActionResult<BillItemResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('catalogue.create_from_bill');
  const res = await run('catalogue.create_from_bill', () => addItemFromBill(ctx, requireActiveBranch(ctx), parse(billItemInput, input)));
  if (res.ok && res.data.ok) revalidatePath('/settings/catalogue');
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
  const ctx = await getContext();
  if (!ctx) return signedOut('catalogue.import.check');
  return run('catalogue.import.check', () => previewCatalogueImport(ctx, parse(pasteInput, text)));
}

export async function saveCatalogueImportAction(text: string, confirmed: z.input<typeof planInput>): Promise<ActionResult<ImportSaveResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('catalogue.import.save');
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
  upiId: z.string().max(300).optional(),
  upiPayee: z.string().max(120).optional(),
});

export async function saveBranchAction(branchId: string, input: z.input<typeof branchInput>): Promise<ActionResult<SaveBranchResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('branch.update');
  const res = await run('branch.update', () => updateBranchDetails(ctx, parse(idInput, branchId), parse(branchInput, input)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

/** Add a branch (Sprint 7). The owner's view switches to it once created. */
export async function createBranchAction(input: z.input<typeof branchInput> & { code: string }): Promise<ActionResult<CreateBranchResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('branch.create');
  const res = await run('branch.create', () => createBranch(ctx, { ...parse(branchInput, input), code: parse(z.string().max(10), input.code) }));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

// ---------------------------------------------------------------------------
// Doctors (Sprint 4, LET-166)
// ---------------------------------------------------------------------------

const providerInput = z.object({
  fullName: z.string().max(200),
  qualification: z.string().max(200),
  registrationNumber: z.string().max(100),
  registrationCouncil: z.string().max(200),
  specialty: z.string().max(200),
  engagementType: z.string().max(40),
  colour: z.string().max(20),
  slotMinutes: z.number().int(),
});

export async function saveProviderAction(id: string | null, input: z.input<typeof providerInput>): Promise<ActionResult<SaveProviderResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut(id ? 'provider.update' : 'provider.create');
  const res = await run(id ? 'provider.update' : 'provider.create', () => saveProvider(ctx, id === null ? null : parse(idInput, id), parse(providerInput, input)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

const hoursInput = z.object({ days: z.array(z.number().int()).max(7), startTime: z.string().max(5), endTime: z.string().max(5) }).nullable();

export async function setProviderHoursAction(providerId: string, branchId: string, hours: z.input<typeof hoursInput>): Promise<ActionResult<{ ok: true } | { ok: false; fieldErrors: Record<string, string> }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('provider.hours');
  const res = await run('provider.hours', () => setProviderHours(ctx, parse(idInput, providerId), parse(idInput, branchId), parse(hoursInput, hours)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

export async function setProviderActiveAction(providerId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut(active ? 'provider.reactivate' : 'provider.deactivate');
  const res = await run(active ? 'provider.reactivate' : 'provider.deactivate', async () => {
    await setProviderActive(ctx, parse(idInput, providerId), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/** Returns the calendar link token once; only its hash is stored. */
export async function calendarLinkAction(providerId: string, revoke: boolean): Promise<ActionResult<{ token: string | null }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('provider.calendar_link');
  const res = await run('provider.calendar_link', async () => {
    const id = parse(idInput, providerId);
    if (parse(z.boolean(), revoke)) {
      await revokeCalendarToken(ctx, id);
      return { token: null };
    }
    return { token: await issueCalendarToken(ctx, id) };
  });
  if (res.ok) revalidatePath('/settings/doctors');
  return res;
}

// ---------------------------------------------------------------------------
// Printed header (Sprint 5, LET-174)
// ---------------------------------------------------------------------------

const printInput = z.object({
  printName: z.string().max(200),
  printAddress: z.string().max(600),
  printEmail: z.string().max(200),
  printFooter: z.string().max(400),
  // ≤200 KB as base64 is about 273 KB; the service checks the real size and type.
  printLogo: z.string().max(300_000),
});

export async function savePrintHeaderAction(branchId: string, input: z.input<typeof printInput>): Promise<ActionResult<SaveBranchResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('branch.print_header');
  const res = await run('branch.print_header', () => savePrintHeader(ctx, parse(idInput, branchId), parse(printInput, input)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

// ---------------------------------------------------------------------------
// Roles (Sprint 5, LET-175)
// ---------------------------------------------------------------------------

export async function addRoleAction(userId: string, role: string, branchId: string | null): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('staff.role_added');
  const res = await run('staff.role_added', async () => {
    await addRole(ctx, parse(idInput, userId), parse(z.string().max(30), role), branchId ? parse(idInput, branchId) : null);
    return undefined;
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

export async function removeRoleAction(membershipId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('staff.role_removed');
  const res = await run('staff.role_removed', async () => {
    await removeRole(ctx, parse(idInput, membershipId));
    return undefined;
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/** "I also see patients": the owner gets a doctor profile on their own login (QA 9 Nov). */
export async function addMeAsDoctorAction(): Promise<ActionResult<{ providerId: string }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('provider.self_add');
  const res = await run('provider.self_add', () => addMeAsDoctor(ctx));
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/** Clinic name and the parallel-run switch (Sprint 7). */
export async function saveClinicAction(input: { name: string; parallelRun: boolean }): Promise<ActionResult<SaveClinicResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('clinic.update');
  const res = await run('clinic.update', () => saveClinicSettings(ctx, parse(z.object({ name: z.string().max(200), parallelRun: z.boolean() }), input)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}

/** Discount limits per role (Sprint 8). Owner only; the service checks. */
export async function saveDiscountCapsAction(input: Record<string, string>): Promise<ActionResult<{ ok: true } | { ok: false; fieldErrors: Record<string, string> }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('clinic.discount_caps');
  const res = await run('clinic.discount_caps', () => saveDiscountCaps(ctx, parse(z.record(z.string().max(40), z.string().max(10)), input)));
  if (res.ok && res.data.ok) revalidatePath('/', 'layout');
  return res;
}
