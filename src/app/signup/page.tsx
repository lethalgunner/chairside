import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { STATES } from '@/domain/branch';
import { signupEnabled } from '@/domain/signup';
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

/** Clinic sign-up (Sprint 7). Off unless SIGNUP_ENABLED=1. */
export default async function SignupPage() {
  if (await getContext()) redirect('/');
  return (
    <div className="login-wrap">
      <div className="login-card wide">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span className="brand-name">Chairside</span>
        </div>
        <h1>Set up your clinic</h1>
        {signupEnabled() ? (
          <>
            <p className="muted">About a minute. You can add more branches, doctors and staff after.</p>
            <SignupForm states={[...STATES]} />
          </>
        ) : (
          <p className="callout">Sign-up isn&apos;t open yet. If your clinic already uses Chairside, ask the owner to invite you.</p>
        )}
        <p className="small">Already have an account? <Link className="link" href="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
