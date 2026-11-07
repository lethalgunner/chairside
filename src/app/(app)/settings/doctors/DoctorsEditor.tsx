'use client';

import { useState } from 'react';
import { saveProviderAction, setProviderActiveAction, setProviderHoursAction } from '@/app/actions/settings';
import { hoursLabel, WEEKDAY_SHORT, WEEKDAYS, type EngagementType } from '@/domain/providers';
import type { ProviderRow } from '@/services/providers';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';
import CalendarLink from './CalendarLink';

interface Props {
  doctors: ProviderRow[];
  branches: { id: string; name: string }[];
  engagement: { value: EngagementType; label: string }[];
  colours: string[];
  slots: number[];
}

type Draft = { fullName: string; qualification: string; registrationNumber: string; registrationCouncil: string; specialty: string; engagementType: string; colour: string; slotMinutes: number };
const EMPTY: Draft = { fullName: '', qualification: '', registrationNumber: '', registrationCouncil: '', specialty: '', engagementType: 'visiting', colour: '', slotMinutes: 15 };
type HoursDraft = { providerId: string; branchId: string; days: number[]; startTime: string; endTime: string };

export default function DoctorsEditor({ doctors, branches, engagement, colours, slots }: Props) {
  const { busy, notSent, send, release, navigate } = useActionForm('provider.save');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [hours, setHours] = useState<HoursDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`doc-${k}-err`}>{errors[k]}</div> : null);
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `doc-${k}-err` : undefined, className: errors[k] ? 'err' : undefined });
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: k === 'slotMinutes' ? Number(e.target.value) : e.target.value }));

  function reset() {
    setErrors({});
    setError(null);
    setSaved(null);
  }

  function open(d: ProviderRow | null) {
    reset();
    setHours(null);
    setEditing(d ? d.id : 'new');
    setDraft(d ? { fullName: d.fullName, qualification: d.qualification ?? '', registrationNumber: d.registrationNumber ?? '', registrationCouncil: d.registrationCouncil ?? '', specialty: d.specialty ?? '', engagementType: d.engagementType, colour: d.colour ?? '', slotMinutes: d.slotMinutes } : EMPTY);
  }

  function openHours(d: ProviderRow, branchId: string) {
    reset();
    setEditing(null);
    const h = d.hours.find((x) => x.branchId === branchId);
    setHours({ providerId: d.id, branchId, days: h?.days ?? [1, 2, 3, 4, 5, 6], startTime: h?.startTime ?? '10:00', endTime: h?.endTime ?? '19:00' });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => saveProviderAction(editing === 'new' ? null : editing, draft));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setSaved(`${draft.fullName.trim()} saved.`);
      setEditing(null);
      await navigate();
    })();
  }

  function saveHours(e: React.FormEvent | null, remove = false) {
    e?.preventDefault();
    if (!hours) return;
    setError(null);
    void (async () => {
      const res = await send(() => setProviderHoursAction(hours.providerId, hours.branchId, remove ? null : { days: hours.days, startTime: hours.startTime, endTime: hours.endTime }));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setSaved(remove ? 'Removed from that branch.' : 'Hours saved.');
      setHours(null);
      await navigate();
    })();
  }

  function toggle(d: ProviderRow) {
    reset();
    void (async () => {
      const res = await send(() => setProviderActiveAction(d.id, !d.active));
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      setSaved(d.active ? `${d.fullName} won’t be offered on new bills or appointments.` : `${d.fullName} is back.`);
      await navigate();
    })();
  }

  const label = (e: string) => engagement.find((x) => x.value === e)?.label ?? e;
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '';

  return (
    <>
      {saved ? <div className="callout good" role="status">{saved}</div> : null}
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <NotSent message={notSent} />

      {editing ? (
        <form className="card" onSubmit={save} noValidate aria-label={editing === 'new' ? 'New doctor' : `Edit ${draft.fullName}`}>
          <header><h2>{editing === 'new' ? 'Doctor without a login' : `Edit ${draft.fullName}`}</h2></header>
          <div className="body">
            <div className="field-grid">
              <div className="field">
                <label htmlFor="doc-name">Name as printed <span className="req">required</span></label>
                <input id="doc-name" value={draft.fullName} onChange={set('fullName')} placeholder="Dr. Anshul Vij" autoComplete="off" {...aria('fullName')} />
                {err('fullName')}
              </div>
              <div className="field">
                <label htmlFor="doc-qual">Qualification</label>
                <input id="doc-qual" value={draft.qualification} onChange={set('qualification')} placeholder="BDS, MDS" autoComplete="off" {...aria('qualification')} />
                {err('qualification')}
              </div>
              <div className="field">
                <label htmlFor="doc-reg">Registration number</label>
                <input id="doc-reg" value={draft.registrationNumber} onChange={set('registrationNumber')} placeholder="A-12345" autoComplete="off" {...aria('registrationNumber')} />
                {errors.registrationNumber ? err('registrationNumber') : <div className="hint">Printed on prescriptions.</div>}
              </div>
              <div className="field">
                <label htmlFor="doc-council">Dental council</label>
                <input id="doc-council" value={draft.registrationCouncil} onChange={set('registrationCouncil')} placeholder="Maharashtra State Dental Council" autoComplete="off" {...aria('registrationCouncil')} />
                {err('registrationCouncil')}
              </div>
              <div className="field">
                <label htmlFor="doc-spec">Specialty</label>
                <input id="doc-spec" value={draft.specialty} onChange={set('specialty')} placeholder="Endodontics" autoComplete="off" {...aria('specialty')} />
                {err('specialty')}
              </div>
              <div className="field">
                <label htmlFor="doc-eng">Works with the clinic as</label>
                <select id="doc-eng" value={draft.engagementType} onChange={set('engagementType')} {...aria('engagementType')}>
                  {engagement.map((e) => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
                {err('engagementType')}
              </div>
              <div className="field">
                <label htmlFor="doc-slot">Appointment slot</label>
                <select id="doc-slot" value={draft.slotMinutes} onChange={set('slotMinutes')} {...aria('slotMinutes')}>
                  {slots.map((m) => (
                    <option key={m} value={m}>{m} minutes</option>
                  ))}
                </select>
                {err('slotMinutes')}
              </div>
              <fieldset className="field">
                <legend>Calendar colour</legend>
                <div className="chips swatches" role="radiogroup" aria-label="Calendar colour">
                  {colours.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={draft.colour === c} aria-label={`Colour ${c}`} className={`swatch${draft.colour === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setDraft((d) => ({ ...d, colour: c }))} />
                  ))}
                </div>
                {err('colour')}
              </fieldset>
            </div>
            <div className="actions">
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editing === 'new' ? 'Add doctor' : 'Save changes'}</button>
              <button className="secondary-btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </form>
      ) : null}

      {hours ? (
        <form className="card" onSubmit={(e) => saveHours(e)} noValidate aria-label={`Hours at ${branchName(hours.branchId)}`}>
          <header><h2>Hours at {branchName(hours.branchId)}</h2></header>
          <div className="body">
            <fieldset className="field">
              <legend>Working days</legend>
              <div className="chips" role="group" aria-label="Working days">
                {WEEKDAYS.map((d) => {
                  const on = hours.days.includes(d);
                  return (
                    <button key={d} type="button" aria-pressed={on} className={`chip${on ? ' on' : ''}`} onClick={() => setHours((h) => h && { ...h, days: on ? h.days.filter((x) => x !== d) : [...h.days, d] })}>
                      {WEEKDAY_SHORT[d - 1]}
                    </button>
                  );
                })}
              </div>
              {err('days')}
            </fieldset>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="hours-start">From</label>
                <input id="hours-start" type="time" step={900} value={hours.startTime} onChange={(e) => setHours((h) => h && { ...h, startTime: e.target.value })} {...aria('startTime')} />
                {err('startTime')}
              </div>
              <div className="field">
                <label htmlFor="hours-end">To</label>
                <input id="hours-end" type="time" step={900} value={hours.endTime} onChange={(e) => setHours((h) => h && { ...h, endTime: e.target.value })} {...aria('endTime')} />
                {err('endTime')}
              </div>
            </div>
            <div className="actions">
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save hours'}</button>
              <button className="secondary-btn" type="button" onClick={() => setHours(null)}>Cancel</button>
              {doctors.find((d) => d.id === hours.providerId)?.hours.some((h) => h.branchId === hours.branchId) ? (
                <button className="linkish danger" type="button" disabled={busy} onClick={() => saveHours(null, true)}>Doesn’t work here any more</button>
              ) : null}
            </div>
          </div>
        </form>
      ) : null}

      <div className="actions top">
        <button className="secondary-btn" type="button" onClick={() => open(null)}>+ Doctor without a login</button>
      </div>

      {doctors.length === 0 ? <p className="muted">No doctors yet. Invite one from Team with the Doctor role.</p> : null}
      <ul className="plain doctor-list">
        {doctors.map((d) => (
          <li key={d.id} className={`card doctor${d.active ? '' : ' inactive'}`}>
            <div className="body">
              <div className="doctor-head">
                <span className="dot" style={{ background: d.colour ?? 'var(--line-strong)' }} aria-hidden="true" />
                <div>
                  <strong>{d.fullName}</strong>
                  {d.active ? null : <span className="pill"> Inactive</span>}
                  <div className="muted small">
                    {[d.qualification, d.specialty, label(d.engagementType), `${d.slotMinutes}-min slots`].filter(Boolean).join(' · ')}
                  </div>
                  <div className="muted small">
                    {d.registrationNumber ? `Reg. ${d.registrationNumber}${d.registrationCouncil ? `, ${d.registrationCouncil}` : ''}` : 'No registration number yet: needed for prescriptions.'}
                    {' · '}
                    {d.userId ? `Signs in as ${d.loginName}` : 'No login'}
                  </div>
                </div>
              </div>
              <ul className="plain hours">
                {branches.map((b) => {
                  const h = d.hours.find((x) => x.branchId === b.id);
                  return (
                    <li key={b.id}>
                      <span>{b.name}: {h ? hoursLabel(h) : <span className="muted">doesn’t work here</span>}</span>{' '}
                      <button type="button" className="linkish" onClick={() => openHours(d, b.id)} aria-label={`${h ? 'Change' : 'Add'} hours for ${d.fullName} at ${b.name}`}>
                        {h ? 'Change' : 'Add'}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <CalendarLink providerId={d.id} name={d.fullName} hasLink={d.hasCalendarLink} />
              <div className="row-actions">
                <button type="button" className="linkish" onClick={() => open(d)}>Edit profile</button>
                <button type="button" className="linkish" disabled={busy} onClick={() => toggle(d)}>{d.active ? 'Deactivate' : 'Reactivate'}</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
