'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createBranchAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

const EMPTY = { code: '', name: '', addressLine: '', city: '', state: '', phone: '', gstRegistered: false, gstin: '', dayCloseTolerance: '100', defaultFloat: '0' };

/** "+ Add a branch" (Sprint 7, self-serve). Owner only; the page hides it from everyone else. */
export default function NewBranchForm({ states }: { states: string[] }) {
  const { busy, notSent, send, release, navigate } = useActionForm('branch.create');
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const text = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`nb-${k}-err`}>{errors[k]}</div> : null);
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `nb-${k}-err` : undefined, className: errors[k] ? 'err' : undefined });

  if (!open) {
    return (
      <div className="actions">
        {added ? (
          <div className="callout good" role="status">
            {added} added. Next: set doctors&apos; hours there in <Link className="link" href="/settings/doctors">Settings → Doctors</Link>, and give staff access on <Link className="link" href="/settings/team">Team</Link>.
          </div>
        ) : null}
        <button type="button" className="secondary-btn" onClick={() => { setOpen(true); setAdded(null); }}>+ Add a branch</button>
      </div>
    );
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => createBranchAction(d));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setAdded(d.name.trim());
      setD(EMPTY);
      setErrors({});
      setOpen(false);
      await navigate();
    })();
  }

  return (
    <form className="card" onSubmit={save} noValidate aria-label="New branch">
      <header><h2>New branch</h2></header>
      <div className="body">
        <div className="field-grid">
          <div className="field">
            <label htmlFor="nb-code">Code <span className="req">required</span></label>
            <input id="nb-code" value={d.code} onChange={text('code')} maxLength={3} autoComplete="off" {...aria('code')} />
            {errors.code ? err('code') : <div className="hint">3 letters or digits, like PUN. It goes in every bill number and can&apos;t change.</div>}
          </div>
          <div className="field">
            <label htmlFor="nb-name">Branch name <span className="req">required</span></label>
            <input id="nb-name" value={d.name} onChange={text('name')} autoComplete="off" {...aria('name')} />
            {err('name')}
          </div>
          <div className="field">
            <label htmlFor="nb-state">State <span className="req">required</span></label>
            <select id="nb-state" value={d.state} onChange={text('state')} {...aria('state')}>
              <option value="">Choose…</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {err('state')}
          </div>
          <div className="field">
            <label htmlFor="nb-city">City</label>
            <input id="nb-city" value={d.city} onChange={text('city')} autoComplete="off" {...aria('city')} />
            {err('city')}
          </div>
          <div className="field">
            <label htmlFor="nb-address">Address</label>
            <input id="nb-address" value={d.addressLine} onChange={text('addressLine')} autoComplete="off" {...aria('addressLine')} />
            {err('addressLine')}
          </div>
          <div className="field">
            <label htmlFor="nb-phone">Phone</label>
            <input id="nb-phone" inputMode="tel" value={d.phone} onChange={text('phone')} autoComplete="off" {...aria('phone')} />
            {err('phone')}
          </div>
          <div className="field span2">
            <label className="ack">
              <input type="checkbox" checked={d.gstRegistered} onChange={(e) => setD((x) => ({ ...x, gstRegistered: e.target.checked }))} />{' '}
              GST registered: charge GST on taxable items at this branch
            </label>
          </div>
          {d.gstRegistered ? (
            <div className="field">
              <label htmlFor="nb-gstin">GSTIN <span className="req">required</span></label>
              <input id="nb-gstin" value={d.gstin} onChange={text('gstin')} autoComplete="off" {...aria('gstin')} />
              {err('gstin')}
            </div>
          ) : null}
        </div>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add branch'}</button>
          <button className="secondary-btn" type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        </div>
      </div>
    </form>
  );
}
