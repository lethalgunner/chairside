import { redirect } from 'next/navigation';
import { getContext } from '@/lib/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getContext()) redirect('/');
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span className="brand-name">Chairside</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Accounts are created by your clinic administrator.</p>
        <LoginForm />
        <p className="pilot-note">Pilot test. Your clinic’s existing software remains the official record.</p>
      </div>
    </div>
  );
}
