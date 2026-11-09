'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { acceptInvite, getContext, setActiveBranch, signIn, signOut, signUpAndSignIn } from '@/lib/auth';
import { checkSignup, signupEnabled, type SignupInput } from '@/domain/signup';
import { signedOut, type SignedOut } from './run';
import { appBaseUrl } from '@/lib/nav/base-url';
import { emailConfigured, sendEmail } from '@/lib/email';
import { requestPasswordReset } from '@/services/password-reset';

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

/** "Forgot password?" (Sprint 7). Always the same answer, whether or not the address exists. */
export async function forgotPasswordAction(_prev: { done?: boolean; error?: string } | null, form: FormData): Promise<{ done?: boolean; error?: string }> {
  if (!emailConfigured()) return { error: 'Password emails aren’t set up. Ask your clinic owner for a reset link.' };
  try {
    await requestPasswordReset(String(form.get('email') ?? ''), await appBaseUrl(), sendEmail);
  } catch {
    console.error('[action] auth.forgot: unexpected error');
  }
  return { done: true };
}

/** Clinic sign-up (Sprint 7). Refused unless SIGNUP_ENABLED=1. */
export async function signUpAction(input: SignupInput): Promise<{ ok: true } | { ok: false; fieldErrors?: Record<string, string>; error?: string }> {
  if (!signupEnabled()) return { ok: false, error: 'Sign-up isn’t open yet.' };
  const raw = input as Partial<SignupInput>;
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : '');
  const checked = checkSignup({
    clinicName: str(raw.clinicName), fullName: str(raw.fullName), email: str(raw.email), password: str(raw.password), confirm: str(raw.confirm),
    branchCode: str(raw.branchCode), branchName: str(raw.branchName), city: str(raw.city), state: str(raw.state),
    gstRegistered: raw.gstRegistered === true, gstin: str(raw.gstin), isDentist: raw.isDentist === true,
  });
  if (!checked.ok) return { ok: false, fieldErrors: checked.fieldErrors };
  try {
    return await signUpAndSignIn(checked.value);
  } catch {
    console.error('[action] auth.signup: unexpected error');
    return { ok: false, error: 'Something went wrong. Nothing was saved. Try again in a minute.' };
  }
}
