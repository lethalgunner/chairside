'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="state-block">
      <h1>This page didn’t load</h1>
      <p className="muted">Nothing you were entering has been saved twice. Try again; if it keeps happening, tell KS what you were doing.</p>
      <div className="actions">
        <button className="primary" onClick={() => reset()}>
          Try again
        </button>
        <Link className="secondary" href="/">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
