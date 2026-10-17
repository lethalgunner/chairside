import Link from 'next/link';
import { describeInvite } from '@/lib/auth/invite';
import SetupForm from './SetupForm';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const invite = await describeInvite(token);
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span className="brand-name">Chairside</span>
        </div>
        {invite ? (
          <>
            <h1>Welcome, {invite.fullName}</h1>
            <p className="muted">Choose a password for {invite.email}. Only you will know it.</p>
            <SetupForm token={token} />
          </>
        ) : (
          <>
            <h1>Link not valid</h1>
            <p className="muted">This link has expired or was already used. Ask your clinic administrator for a new one.</p>
            <Link className="primary-link" href="/login">Go to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
