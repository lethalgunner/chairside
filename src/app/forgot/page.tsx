import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { emailConfigured } from '@/lib/email';
import ForgotForm from './ForgotForm';

export const dynamic = 'force-dynamic';

/** Self-service reset (Sprint 7). Only reachable when email is set up; otherwise the owner makes the link. */
export default async function ForgotPage() {
  if (await getContext()) redirect('/');
  if (!emailConfigured()) redirect('/login');
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span className="brand-name">Chairside</span>
        </div>
        <h1>Forgot password</h1>
        <p className="muted">Enter the email you sign in with. We&apos;ll send a link to choose a new password.</p>
        <ForgotForm />
        <p className="small"><Link className="link" href="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}
