'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { acceptInvite, requireContext, setActiveBranch, signIn, signOut } from '@/lib/auth';

export async function signInAction(_prev: { error?: string } | null, form: FormData): Promise<{ error?: string }> {
  const res = await signIn(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
  if (!res.ok) return { error: res.error };
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}

export async function switchBranchAction(branchId: string): Promise<void> {
  const ctx = await requireContext();
  if (branchId !== 'all' && !ctx.branchIds.includes(branchId)) return;
  if (branchId === 'all' && ctx.branchIds.length < 2) return;
  await setActiveBranch(branchId);
  revalidatePath('/', 'layout');
}

export async function acceptInviteAction(_prev: { error?: string } | null, form: FormData): Promise<{ error?: string }> {
  const res = await acceptInvite(String(form.get('token') ?? ''), String(form.get('password') ?? ''), String(form.get('confirm') ?? ''));
  if (!res.ok) return { error: res.error };
  redirect('/');
}
