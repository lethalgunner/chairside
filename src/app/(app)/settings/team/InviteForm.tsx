'use client';

import { useState } from 'react';
import { inviteStaffAction } from '@/app/actions/settings';
import InviteLink from './InviteLink';
import { useActionForm } from '@/lib/nav/use-action-form';

interface Props {
  roles: { value: string; label: string }[];
  branches: { id: string; name: string }[];
  unlinked: { id: string; fullName: string }[];
}

/** Invite a new person, or give an existing record (a doctor from the price list load) a login. */
export default function InviteForm({ roles, branches, unlinked }: Props) {
  const { busy: pending, send, release, navigate } = useActionForm('staff.invite');
  const [who, setWho] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('front_desk');
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0]!.id : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string | null; name: string } | null>(null);
  const isOwner = role === 'owner';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => inviteStaffAction({ fullName, email, role, branchId: isOwner ? null : branchId || null, linkUserId: who || null }));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setErrors({});
      setIssued({ token: res.data.token, name: res.data.fullName });
      setWho('');
      setFullName('');
      setEmail('');
      await navigate();
    })();
  }

  const describedBy = (k: string) => (errors[k] ? `${k}-err` : undefined);
  const fieldError = (k: string) => (errors[k] ? <div className="hint err-text" id={`${k}-err`}>{errors[k]}</div> : null);

  return (
    <form onSubmit={submit} noValidate>
      {issued ? (
        issued.token ? (
          <InviteLink token={issued.token} name={issued.name} onDone={() => setIssued(null)} />
        ) : (
          <div className="callout good" role="status">{issued.name} already has a login. The new role is added; they can sign in as before.</div>
        )
      ) : null}
      <div className="field-grid">
        {unlinked.length > 0 ? (
          <div className="field">
            <label htmlFor="invite-who">Who</label>
            <select id="invite-who" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Someone new</option>
              {unlinked.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName} (no login yet)</option>
              ))}
            </select>
          </div>
        ) : null}
        {who ? null : (
          <div className="field">
            <label htmlFor="invite-name">Full name <span className="req">required</span></label>
            <input id="invite-name" autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-invalid={!!errors.fullName} aria-describedby={describedBy('fullName')} className={errors.fullName ? 'err' : undefined} />
            {fieldError('fullName')}
          </div>
        )}
        <div className="field">
          <label htmlFor="invite-email">Email <span className="req">required</span></label>
          <input id="invite-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={describedBy('email')} className={errors.email ? 'err' : undefined} />
          {errors.email ? fieldError('email') : <div className="hint">They sign in with this.</div>}
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} aria-invalid={!!errors.role} aria-describedby={describedBy('role')}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {fieldError('role')}
        </div>
        <div className="field">
          <label htmlFor="invite-branch">Branch {isOwner ? null : <span className="req">required</span>}</label>
          <select id="invite-branch" value={isOwner ? '' : branchId} disabled={isOwner} onChange={(e) => setBranchId(e.target.value)} aria-invalid={!!errors.branchId} aria-describedby={describedBy('branchId')}>
            <option value="">{isOwner ? 'All branches' : 'Pick a branch'}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {errors.branchId ? fieldError('branchId') : isOwner ? <div className="hint">An owner sees and manages every branch.</div> : null}
        </div>
      </div>
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <div className="actions">
        <button className="primary" type="submit" disabled={pending}>{pending ? 'Creating link…' : 'Create invite link'}</button>
      </div>
    </form>
  );
}
