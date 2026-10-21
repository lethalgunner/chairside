'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireContext } from '@/lib/auth';
import { inviteStaff, reissueInvite, setStaffActive, type InviteStaffResult } from '@/services/staff';
import { UserFacingError } from '@/services/context';
import { run, type ActionResult } from './run';

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
  const ctx = await requireContext();
  const res = await run('staff.invite', () => inviteStaff(ctx, parse(inviteInput, input)));
  if (res.ok && res.data.ok) revalidatePath('/settings/team');
  return res;
}

const userIdInput = z.string().uuid();

export async function reissueInviteAction(userId: string): Promise<ActionResult<{ token: string; expiresAt: Date; fullName: string }>> {
  const ctx = await requireContext();
  const res = await run('staff.reinvite', () => reissueInvite(ctx, parse(userIdInput, userId)));
  if (res.ok) revalidatePath('/settings/team');
  return res;
}

export async function setStaffActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  const res = await run(active ? 'staff.reactivate' : 'staff.deactivate', async () => {
    await setStaffActive(ctx, parse(userIdInput, userId), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) revalidatePath('/settings/team');
  return res;
}
