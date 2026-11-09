'use client';

import { useState } from 'react';
import { signUpAction } from '@/app/actions/auth';

const EMPTY = { clinicName: '', fullName: '', email: '', password: '', confirm: '', branchCode: '', branchName: '', city: '', state: '', gstRegistered: false, gstin: '', isDentist: true };

export default function SignupForm({ states }: { states: string[] }) {
  const [d, setD] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`su-${k}-err`}>{errors[k]}</div> : null);
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `su-${k}-err` : undefined, className: errors[k] ? 'err' : undefined });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const res = await signUpAction(d);
        if (res.ok) {
          // A full load, so the new session cookie is used from the first request.
          window.location.assign('/start');
          return;
        }
        setErrors(res.fieldErrors ?? {});
        if (res.error) setError(res.error);
      } catch {
        setError('Not sent: check the internet and press again. Nothing was saved.');
      }
      setBusy(false);
    })();
  }

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Set up your clinic">
      <div className="field">
        <label htmlFor="su-clinic">Clinic name</label>
        <input id="su-clinic" value={d.clinicName} onChange={set('clinicName')} autoComplete="organization" {...aria('clinicName')} />
        {err('clinicName')}
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="su-name">Your name</label>
          <input id="su-name" value={d.fullName} onChange={set('fullName')} autoComplete="name" {...aria('fullName')} />
          {err('fullName')}
        </div>
        <div className="field">
          <label htmlFor="su-email">Email</label>
          <input id="su-email" type="email" value={d.email} onChange={set('email')} autoComplete="email" {...aria('email')} />
          {err('email')}
        </div>
        <div className="field">
          <label htmlFor="su-pw">Password</label>
          <input id="su-pw" type="password" value={d.password} onChange={set('password')} autoComplete="new-password" {...aria('password')} />
          {errors.password ? err('password') : <div className="hint">At least 10 characters.</div>}
        </div>
        <div className="field">
          <label htmlFor="su-confirm">Password again</label>
          <input id="su-confirm" type="password" value={d.confirm} onChange={set('confirm')} autoComplete="new-password" {...aria('confirm')} />
          {err('confirm')}
        </div>
      </div>
      <label className="ack">
        <input type="checkbox" checked={d.isDentist} onChange={(e) => setD((x) => ({ ...x, isDentist: e.target.checked }))} /> I also treat patients (adds me as a doctor)
      </label>
      <fieldset className="field">
        <legend>Your first branch</legend>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="su-bname">Branch name</label>
            <input id="su-bname" value={d.branchName} onChange={set('branchName')} {...aria('branchName')} />
            {err('branchName')}
          </div>
          <div className="field">
            <label htmlFor="su-bcode">Branch code</label>
            <input id="su-bcode" value={d.branchCode} onChange={set('branchCode')} maxLength={3} {...aria('branchCode')} />
            {errors.branchCode ? err('branchCode') : <div className="hint">3 letters, like PUN. It goes in every bill number.</div>}
          </div>
          <div className="field">
            <label htmlFor="su-city">City</label>
            <input id="su-city" value={d.city} onChange={set('city')} {...aria('city')} />
            {err('city')}
          </div>
          <div className="field">
            <label htmlFor="su-state">State</label>
            <select id="su-state" value={d.state} onChange={set('state')} {...aria('state')}>
              <option value="">Choose…</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {err('state')}
          </div>
        </div>
        <label className="ack">
          <input type="checkbox" checked={d.gstRegistered} onChange={(e) => setD((x) => ({ ...x, gstRegistered: e.target.checked }))} /> This branch is GST registered
        </label>
        {d.gstRegistered ? (
          <div className="field">
            <label htmlFor="su-gstin">GSTIN</label>
            <input id="su-gstin" value={d.gstin} onChange={set('gstin')} {...aria('gstin')} />
            {err('gstin')}
          </div>
        ) : null}
      </fieldset>
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Setting up…' : 'Create my clinic'}</button>
    </form>
  );
}
