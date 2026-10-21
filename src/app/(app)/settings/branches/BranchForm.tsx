'use client';

import { useState } from 'react';
import { saveBranchAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';

interface Branch {
  id: string;
  code: string;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  phone: string;
  gstRegistered: boolean;
  gstin: string;
  dayCloseTolerance: string;
  defaultFloat: string;
}

/** One branch's details. Field ids carry the branch code so two forms on the page never clash. */
export default function BranchForm({ branch, states }: { branch: Branch; states: string[] }) {
  const { busy: pending, send, release, navigate } = useActionForm('branch.update');
  const [d, setD] = useState(branch);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = (k: string) => `${branch.code}-${k}`;

  const text = (k: keyof Branch) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setD((x) => ({ ...x, [k]: e.target.value }));
  };
  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={id(`${k}-err`)}>{errors[k]}</div> : null);
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? id(`${k}-err`) : undefined, className: errors[k] ? 'err' : undefined });

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void (async () => {
      const { id: _id, code: _code, ...input } = d;
      const res = await send(() => saveBranchAction(branch.id, input));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setErrors({});
      setSaved(true);
      await navigate();
    })();
  }

  return (
    <form className="card" onSubmit={save} noValidate aria-label={`${branch.name} details`}>
      <header>
        <h2>{branch.name}</h2>
        <span className="note">Code <span className="mono">{branch.code}</span> · fixed, it is in every bill number</span>
      </header>
      <div className="body">
        <div className="field-grid">
          <div className="field">
            <label htmlFor={id('name')}>Branch name</label>
            <input id={id('name')} value={d.name} onChange={text('name')} {...aria('name')} />
            {err('name')}
          </div>
          <div className="field">
            <label htmlFor={id('phone')}>Phone</label>
            <input id={id('phone')} inputMode="tel" value={d.phone} onChange={text('phone')} {...aria('phone')} />
            {err('phone')}
          </div>
          <div className="field span2">
            <label htmlFor={id('address')}>Address</label>
            <input id={id('address')} value={d.addressLine} onChange={text('addressLine')} {...aria('addressLine')} />
            {err('addressLine')}
          </div>
          <div className="field">
            <label htmlFor={id('city')}>City</label>
            <input id={id('city')} value={d.city} onChange={text('city')} {...aria('city')} />
            {err('city')}
          </div>
          <div className="field">
            <label htmlFor={id('state')}>State</label>
            <select id={id('state')} value={d.state} onChange={text('state')} {...aria('state')}>
              <option value="">Pick the state</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {err('state')}
          </div>
          <div className="field span2">
            <label className="ack">
              <input
                type="checkbox"
                checked={d.gstRegistered}
                onChange={(e) => {
                  setSaved(false);
                  setD((x) => ({ ...x, gstRegistered: e.target.checked }));
                }}
              />{' '}
              GST registered: charge GST on taxable items at this branch
            </label>
          </div>
          {d.gstRegistered ? (
            <div className="field">
              <label htmlFor={id('gstin')}>GSTIN <span className="req">required</span></label>
              <input id={id('gstin')} value={d.gstin} onChange={text('gstin')} autoComplete="off" className={errors.gstin ? 'err mono' : 'mono'} aria-invalid={!!errors.gstin} aria-describedby={errors.gstin ? id('gstin-err') : undefined} />
              {errors.gstin ? err('gstin') : <div className="hint">15 characters; the first two match the state.</div>}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor={id('tolerance')}>Day-close tolerance (₹)</label>
            <input id={id('tolerance')} inputMode="decimal" value={d.dayCloseTolerance} onChange={text('dayCloseTolerance')} {...aria('dayCloseTolerance')} />
            {errors.dayCloseTolerance ? err('dayCloseTolerance') : <div className="hint">A cash difference larger than this needs a written reason.</div>}
          </div>
          <div className="field">
            <label htmlFor={id('float')}>Opening float (₹)</label>
            <input id={id('float')} inputMode="decimal" value={d.defaultFloat} onChange={text('defaultFloat')} {...aria('defaultFloat')} />
            {errors.defaultFloat ? err('defaultFloat') : <div className="hint">Cash left in the drawer each morning. Applies from the next day opened.</div>}
          </div>
        </div>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        {saved ? <div className="callout good" role="status">{d.name} saved.</div> : null}
        <div className="actions">
          <button className="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : `Save ${branch.name}`}</button>
        </div>
      </div>
    </form>
  );
}
