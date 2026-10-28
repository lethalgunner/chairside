'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { acceptInvite, getContext, setActiveBranch, signIn, signOut } from '@/lib/auth';
import { signedOut, type SignedOut } from './run';

/** Returns ok instead of redirecting, so the client can navigate with the T18 fallback. */
export async function signInAction(_prev: { error?: string; ok?: boolean } | null, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const res = await signIn(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}

export async function switchBranchAction(branchId: string): Promise<SignedOut | undefined> {
  const ctx = await getContext();
  if (!ctx) return signedOut('branch.switch');
  if (branchId !== 'all' && !ctx.branchIds.includes(branchId)) return;
  if (branchId === 'all' && ctx.branchIds.length < 2) return;
  await setActiveBranch(branchId);
  revalidatePath('/', 'layout');
}

// Stays a server-side redirect: the action burns the token, so the refresh that
// follows would otherwise re-render /setup as "Link not valid" before the client moves.
export async function acceptInviteAction(_prev: { error?: string } | null, form: FormData): Promise<{ error?: string }> {
  const res = await acceptInvite(String(form.get('token') ?? ''), String(form.get('password') ?? ''), String(form.get('confirm') ?? ''));
  if (!res.ok) return { error: res.error };
  redirect('/');
}
