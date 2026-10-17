import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="state-block">
      <h1>Not found</h1>
      <p className="muted">That record doesn’t exist, or it belongs to a branch you can’t see.</p>
      <Link className="primary-link" href="/patients">
        Find a patient
      </Link>
    </div>
  );
}
