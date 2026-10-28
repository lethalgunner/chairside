import { redirect } from 'next/navigation';
import { getContext } from '@/lib/auth';
import { EXPIRED_REASON, safeNext, SIGNED_OUT_MESSAGE } from '@/lib/nav/safe-next';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }> }) {
  const params = await searchParams;
  // Validated here and again in the form before it navigates (T29, open-redirect rule).
  const next = safeNext(params.next);
  if (await getContext()) redirect(next);
  const expired = params.reason === EXPIRED_REASON;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span className="brand-name">Chairside</span>
        </div>
        <h1>Sign in</h1>
        {expired ? (
          <div className="callout warn" role="status">
            {SIGNED_OUT_MESSAGE}
          </div>
        ) : null}
        <p className="muted">Accounts are created by your clinic administrator.</p>
        <LoginForm next={next} />
        <p className="pilot-note">Pilot test. Your clinic’s existing software remains the official record.</p>
      </div>
    </div>
  );
}
