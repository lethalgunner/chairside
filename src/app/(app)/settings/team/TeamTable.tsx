'use client';

import { useState } from 'react';
import { reissueInviteAction, setStaffActiveAction } from '@/app/actions/settings';
import type { InviteStatus } from '@/domain/staff';
import InviteLink from './InviteLink';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

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
  const { busy: pending, notSent, send, release, navigate } = useActionForm('staff.update');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ token: string; name: string } | null>(null);

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    void (async () => {
      setError(null);
      const res = await send(fn);
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      await navigate();
    })();

  return (
    <>
      {link ? <div className="body"><InviteLink token={link.token} name={link.name} onDone={() => setLink(null)} /></div> : null}
      {error ? <div className="body"><div className="callout warn" role="alert">{error}</div></div> : null}
      <NotSent message={notSent} />
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
                        void (async () => {
                          setError(null);
                          const res = await send(() => reissueInviteAction(r.id));
                          if (!res) return;
                          if (!res.ok) {
                            release();
                            return setError(res.error);
                          }
                          setLink({ token: res.data.token, name: res.data.fullName });
                          await navigate();
                        })()
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
