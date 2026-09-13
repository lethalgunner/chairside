'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { registerPatient, type RegisterResult } from '@/app/actions';

export interface ExistingPatient {
  id: string;
  fullName: string;
  phone: string;
  fileNumber: string;
  lastVisit: string;
}

const SEXES = ['F', 'M', 'Other'] as const;

/**
 * Registration, built against one number: under 40 seconds, start to saved.
 *
 * Every decision here serves that. Mobile is first because it is the primary
 * handle and the duplicate key. Sex and referral source are buttons, not
 * dropdowns, because a dropdown costs two interactions. Age is a plain number
 * rather than a date picker, because a walk-in usually knows their age and
 * rarely has their date of birth to hand. Nothing else is asked at all.
 */
export default function NewPatientForm({ existing }: { existing: ExistingPatient[] }) {
  const [state, formAction, pending] = useActionState<RegisterResult | null, FormData>(
    registerPatient,
    null,
  );

  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [sex, setSex] = useState('');
  const [referral, setReferral] = useState('Walk-in');
  const [elapsed, setElapsed] = useState(0);
  const started = useRef<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Stopwatch. PAT-02 sets a 40-second target, so the form shows whether it is
  // actually being met rather than leaving it as an aspiration in a document.
  useEffect(() => {
    if (started.current === null) return;
    const t = setInterval(() => {
      if (started.current !== null) setElapsed(Math.floor((Date.now() - started.current) / 1000));
    }, 500);
    return () => clearInterval(t);
  }, [elapsed === 0 ? 'idle' : 'running']);

  function touch() {
    if (started.current === null) {
      started.current = Date.now();
      setElapsed(1);
    }
  }

  const duplicates = useMemo(() => {
    const digits = phone.replace(/\D/g, '');
    const name = fullName.trim().toLowerCase();
    if (digits.length < 6 && name.length < 3) return [];
    return existing.filter((p) => {
      const pDigits = p.phone.replace(/\D/g, '');
      if (digits.length >= 6 && pDigits.endsWith(digits.slice(-6))) return true;
      if (name.length >= 3) {
        const pName = p.fullName.toLowerCase();
        if (pName.includes(name) || name.includes(pName)) return true;
      }
      return false;
    });
  }, [phone, fullName, existing]);

  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} onChange={touch} className="reg">
      {duplicates.length > 0 ? (
        <div className="callout warn" role="alert">
          <strong>
            {duplicates.length} existing record{duplicates.length > 1 ? 's' : ''} may be this person.
          </strong>{' '}
          Open one instead of creating a second — a patient registered twice is two ledgers and two
          histories.
          <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
            {duplicates.slice(0, 4).map((d) => (
              <li key={d.id} style={{ marginBottom: 2 }}>
                <a className="link" href={`/patients/${d.id}`}>
                  {d.fullName}
                </a>{' '}
                <span className="mono muted">
                  {d.fileNumber} · {d.phone} · last seen {d.lastVisit}
                </span>
              </li>
            ))}
          </ul>
          <label className="ack">
            <input type="checkbox" name="acknowledgedDuplicate" value="yes" />
            <span>
              Different person — register anyway (a family member sharing a mobile number, for
              instance)
            </span>
          </label>
        </div>
      ) : null}

      {state?.message && duplicates.length === 0 ? (
        <div className="callout warn" role="alert">
          {state.message}
        </div>
      ) : null}

      <div className="field-grid">
        <div className="field span2">
          <label htmlFor="phone">
            Mobile <span className="req">required</span>
          </label>
          <input
            id="phone"
            name="phone"
            inputMode="numeric"
            autoComplete="off"
            placeholder="98220 41155"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onFocus={touch}
            className={fe.phone ? 'err' : ''}
            autoFocus
          />
          <p className="hint">
            {fe.phone ?? 'The primary handle. Everything else can be corrected later.'}
          </p>
        </div>

        <div className="field span2">
          <label htmlFor="fullName">
            Full name <span className="req">required</span>
          </label>
          <input
            id="fullName"
            name="fullName"
            ref={nameRef}
            autoComplete="off"
            placeholder="Meera Kulkarni"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onFocus={touch}
            className={fe.fullName ? 'err' : ''}
          />
          {fe.fullName ? <p className="hint err-text">{fe.fullName}</p> : null}
        </div>

        <div className="field">
          <label>
            Sex <span className="req">required</span>
          </label>
          <div className="chips">
            {SEXES.map((s) => (
              <button
                type="button"
                key={s}
                className={`chip${sex === s ? ' on' : ''}`}
                onClick={() => {
                  setSex(s);
                  touch();
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <input type="hidden" name="sex" value={sex} />
          {fe.sex ? <p className="hint err-text">{fe.sex}</p> : null}
        </div>

        <div className="field">
          <label htmlFor="age">
            Age <span className="req">required</span>
          </label>
          <input
            id="age"
            name="age"
            inputMode="numeric"
            placeholder="34"
            onFocus={touch}
            className={fe.age ? 'err' : ''}
          />
          <p className="hint">{fe.age ?? 'Date of birth can be added later.'}</p>
        </div>

        <div className="field span2">
          <label>How did they hear about the clinic?</label>
          <div className="chips">
            {[
              'Walk-in',
              'Patient referral',
              'Doctor referral',
              'Google',
              'Instagram',
              'Practo',
            ].map((r) => (
              <button
                type="button"
                key={r}
                className={`chip${referral === r ? ' on' : ''}`}
                onClick={() => {
                  setReferral(r);
                  touch();
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <input type="hidden" name="referralSource" value={referral} />
          {referral.includes('referral') ? (
            <input
              name="referralDetail"
              placeholder={referral === 'Doctor referral' ? 'Referring doctor' : 'Referred by'}
              autoComplete="off"
              style={{ marginTop: 8 }}
            />
          ) : null}
          <p className="hint">
            Captured now because it is the only moment anyone will ever know the answer. It is what
            makes referral attribution possible later.
          </p>
        </div>
      </div>

      <div className="actions">
        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Registering…' : 'Register and open file'}
        </button>
        <a href="/patients" className="secondary">
          Cancel
        </a>
        <span className="timer">
          {started.current === null ? (
            <span className="muted">Timer starts when you type</span>
          ) : (
            <>
              <span className={elapsed <= 40 ? 'ok' : 'over'}>{elapsed}s</span>
              <span className="muted"> / 40s target</span>
            </>
          )}
        </span>
      </div>
    </form>
  );
}
