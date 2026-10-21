'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reissueInviteAction, setStaffActiveAction } from '@/app/actions/settings';
import type { InviteStatus } from '@/domain/staff';
import InviteLink from './InviteLink';

export interface TeamRow {
  id: string;
  fullName: string;
  email: string | null;
  active: boolean;
  isSelf: boolean;
  access: string[];
  status: InviteStatus;
  inviteUntil: string | null;
}

function LoginPill({ row }: { row: TeamRow }) {
  if (row.status === 'set_up') return <span className="pill paid">Set up</span>;
  if (row.status === 'pending') return <span className="pill due">Invite pending, until {row.inviteUntil}</span>;
  if (row.status === 'expired') return <span className="pill credit">Link expired or not sent</span>;
  return <span className="muted small">No login</span>;
}

export default function TeamTable({ rows }: { rows: TeamRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ token: string; name: string } | null>(null);

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  return (
    <>
      {link ? <div className="body"><InviteLink token={link.token} name={link.name} onDone={() => setLink(null)} /></div> : null}
      {error ? <div className="body"><div className="callout warn" role="alert">{error}</div></div> : null}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Access</th>
              <th scope="col">Login</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? undefined : 'muted'}>
                <td>
                  <strong>{r.fullName}</strong>
                  {r.isSelf ? <span className="muted small"> (you)</span> : null}
                  {r.email ? <div className="muted small">{r.email}</div> : null}
                </td>
                <td className="small">{r.access.length ? r.access.join(', ') : '—'}</td>
                <td>{r.active ? <LoginPill row={r} /> : <span className="pill credit">Deactivated</span>}</td>
                <td className="row-actions">
                  {r.active && (r.status === 'pending' || r.status === 'expired') ? (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={pending}
                      aria-label={`New link for ${r.fullName}`}
                      onClick={() =>
                        start(async () => {
                          setError(null);
                          const res = await reissueInviteAction(r.id);
                          if (!res.ok) return setError(res.error);
                          setLink({ token: res.data.token, name: res.data.fullName });
                          router.refresh();
                        })
                      }
                    >
                      New link
                    </button>
                  ) : null}
                  {r.isSelf ? null : r.active ? (
                    <button type="button" className="linkish danger" disabled={pending} aria-label={`Deactivate ${r.fullName}`} onClick={() => act(() => setStaffActiveAction(r.id, false))}>
                      Deactivate
                    </button>
                  ) : (
                    <button type="button" className="linkish" disabled={pending} aria-label={`Reactivate ${r.fullName}`} onClick={() => act(() => setStaffActiveAction(r.id, true))}>
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
