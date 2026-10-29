'use client';

import { useState } from 'react';
import { passwordResetLinkAction, reissueInviteAction, setStaffActiveAction } from '@/app/actions/settings';
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
  const [link, setLink] = useState<{ token: string; name: string; reset?: boolean } | null>(null);

  /** Make a one-time link and show it once (new link, or a forgotten-password reset, T39). */
  const makeLink = (call: () => ReturnType<typeof reissueInviteAction>, reset: boolean) =>
    void (async () => {
      setError(null);
      const res = await send(call);
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      setLink({ token: res.data.token, name: res.data.fullName, reset });
      await navigate();
    })();

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
      {link ? <div className="body"><InviteLink token={link.token} name={link.name} reset={link.reset} onDone={() => setLink(null)} /></div> : null}
      {error ? <div className="body"><div className="callout warn" role="alert">{error}</div></div> : null}
      <NotSent message={notSent} />
      <div className="tablewrap">
        <table className="stack-table">
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
                <td className="small" data-label="Access">{r.access.length ? r.access.join(', ') : '—'}</td>
                <td data-label="Login">{r.active ? <LoginPill row={r} /> : <span className="pill credit">Deactivated</span>}</td>
                <td className="row-actions">
                  {r.active && (r.status === 'pending' || r.status === 'expired') ? (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={pending}
                      aria-label={`New link for ${r.fullName}`}
                      onClick={() => makeLink(() => reissueInviteAction(r.id), false)}
                    >
                      New link
                    </button>
                  ) : null}
                  {r.active && !r.isSelf && r.status === 'set_up' ? (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={pending}
                      aria-label={`Reset password link for ${r.fullName}`}
                      onClick={() => makeLink(() => passwordResetLinkAction(r.id), true)}
                    >
                      Reset password link
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
