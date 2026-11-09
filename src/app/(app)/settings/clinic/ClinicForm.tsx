'use client';

import { useState } from 'react';
import { saveClinicAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

export default function ClinicForm({ clinic }: { clinic: { name: string; parallelRun: boolean } }) {
  const { busy, notSent, send, release, navigate } = useActionForm('clinic.update');
  const [d, setD] = useState(clinic);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => saveClinicAction(d));
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
    <form className="card" onSubmit={save} noValidate aria-label="Clinic settings">
      <div className="body">
        <div className="field">
          <label htmlFor="clinic-name">Clinic name</label>
          <input id="clinic-name" value={d.name} onChange={(e) => { setSaved(false); setD((x) => ({ ...x, name: e.target.value })); }} autoComplete="off" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'clinic-name-err' : 'clinic-name-hint'} />
          {errors.name ? <div className="hint err-text" id="clinic-name-err">{errors.name}</div> : <div className="hint" id="clinic-name-hint">Shown at sign-in and in the menu. Each branch&apos;s printed name is in Bill header.</div>}
        </div>
        <fieldset className="field">
          <legend>Running alongside your old software?</legend>
          <label className="ack">
            <input type="checkbox" checked={d.parallelRun} onChange={(e) => { setSaved(false); setD((x) => ({ ...x, parallelRun: e.target.checked })); }} />{' '}
            Yes, we still use the old software too
          </label>
          <div className="hint">On: day close asks for the old software&apos;s bills and collection, the dashboard compares them, the Pilot scorecard shows, and dues reminders ask staff to check the old software first. Turn it off once you&apos;ve switched over.</div>
        </fieldset>
        {saved ? <div className="callout good" role="status">Saved.</div> : null}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form>
  );
}
