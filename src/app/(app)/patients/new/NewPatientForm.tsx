'use client';

import Link from 'next/link';
import { useState } from 'react';
import { registerPatientAction, type RegisterFormState } from '@/app/actions/patients';
import { formatIndianMobile } from '@/domain/phone';
import { useActionForm } from '@/lib/nav/use-action-form';

const SEXES = [
  { v: 'F', label: 'Female' },
  { v: 'M', label: 'Male' },
  { v: 'O', label: 'Other' },
];

/**
 * Walk-in registration. Mobile first (it is the duplicate key), sex and
 * referral as buttons (one tap, not a dropdown), age instead of a date picker.
 * All fields are controlled, so a failed submit never wipes what was typed.
 */
export default function NewPatientForm({ referralSources, initialPhone, initialName }: { referralSources: string[]; initialPhone: string; initialName: string }) {
  const { busy: pending, send, release, navigate } = useActionForm('patient.register');
  const [phone, setPhone] = useState(initialPhone);
  const [fullName, setFullName] = useState(initialName);
  const [sex, setSex] = useState('');
  const [age, setAge] = useState('');
  const [referral, setReferral] = useState('Walk-in');
  const [referralDetail, setReferralDetail] = useState('');
  const [ack, setAck] = useState(false);
  const [state, setState] = useState<RegisterFormState>({});
  const err = state.fieldErrors ?? {};

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void (async () => {
      const res = await send(() => registerPatientAction({ fullName, phone, sex, age, referralSource: referral, referralDetail, acknowledgedDuplicate: ack }));
      if (!res) return;
      setState(res);
      // Navigate outside any transition; the button stays on "Saving…" until the patient page is up (T18).
      if (res.createdId) return navigate(`/patients/${res.createdId}?new=1`);
      release();
    })();
  }

  const describedBy = (k: string) => (err[k] ? `${k}-err` : undefined);

  return (
    <form className="reg card" onSubmit={submit} noValidate>
      <div className="body">
        <div className="field-grid">
          <div className="field">
            <label htmlFor="phone">
              Mobile <span className="req">required</span>
            </label>
            <input id="phone" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => { setPhone(e.target.value); setAck(false); }} className={err.phone ? 'err' : undefined} aria-invalid={!!err.phone} aria-describedby={describedBy('phone')} autoFocus />
            {err.phone ? <div className="hint err-text" id="phone-err">{err.phone}</div> : <div className="hint">+91, spaces and a leading 0 are fine.</div>}
          </div>
          <div className="field">
            <label htmlFor="fullName">
              Full name <span className="req">required</span>
            </label>
            <input id="fullName" autoComplete="off" value={fullName} onChange={(e) => { setFullName(e.target.value); setAck(false); }} className={err.fullName ? 'err' : undefined} aria-invalid={!!err.fullName} aria-describedby={describedBy('fullName')} />
            {err.fullName ? <div className="hint err-text" id="fullName-err">{err.fullName}</div> : null}
          </div>
          <fieldset className="field">
            <legend>
              Sex <span className="req">required</span>
            </legend>
            <div className="chips" role="group" aria-describedby={describedBy('sex')}>
              {SEXES.map((s) => (
                <button key={s.v} type="button" className={`chip${sex === s.v ? ' on' : ''}`} aria-pressed={sex === s.v} onClick={() => setSex(s.v)}>
                  {s.label}
                </button>
              ))}
            </div>
            {err.sex ? <div className="hint err-text" id="sex-err">{err.sex}</div> : null}
          </fieldset>
          <div className="field">
            <label htmlFor="age">
              Age in years <span className="req">required</span>
            </label>
            <input id="age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ''))} className={err.age ? 'err' : undefined} aria-invalid={!!err.age} aria-describedby={describedBy('age')} />
            {err.age ? <div className="hint err-text" id="age-err">{err.age}</div> : <div className="hint">For a baby under 1, enter 0.</div>}
          </div>
          <fieldset className="field span2">
            <legend>How did they hear about us?</legend>
            <div className="chips" role="group">
              {referralSources.map((r) => (
                <button key={r} type="button" className={`chip${referral === r ? ' on' : ''}`} aria-pressed={referral === r} onClick={() => setReferral(r)}>
                  {r}
                </button>
              ))}
            </div>
            {referral === 'Doctor referral' || referral === 'Patient referral' || referral === 'Other' ? (
              <input aria-label="Referred by" placeholder="Who referred them? (optional)" value={referralDetail} onChange={(e) => setReferralDetail(e.target.value)} style={{ marginTop: 8 }} />
            ) : null}
          </fieldset>
        </div>

        {state.duplicates && state.duplicates.length > 0 ? (
          <div className="callout warn" role="alert">
            <strong>
              {state.duplicates.length === 1 ? 'This may already be a patient:' : `${state.duplicates.length} existing patients look similar:`}
            </strong>
            <ul className="dupes">
              {state.duplicates.map((d) => (
                <li key={d.id}>
                  <Link className="link" href={`/patients/${d.id}`}>
                    {d.fullName}
                  </Link>{' '}
                  · {formatIndianMobile(d.phone)} · {d.fileNumbers.join(', ') || 'no file'} {d.age !== null ? `· ${d.age} yrs` : ''}
                </li>
              ))}
            </ul>
            <label className="ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> This is a different person (for example, a family member on the same phone). Register anyway.
            </label>
          </div>
        ) : null}

        {state.error ? (
          <div className="callout warn" role="alert">
            {state.error}
          </div>
        ) : null}

        <div className="actions">
          <button className="primary" type="submit" disabled={pending || (!!state.duplicates?.length && !ack)}>
            {pending ? 'Saving…' : 'Register patient'}
          </button>
          <Link className="secondary" href="/patients">
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
