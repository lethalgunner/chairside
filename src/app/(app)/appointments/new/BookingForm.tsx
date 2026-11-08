'use client';

import { useRef, useState } from 'react';
import { bookAppointmentAction, doctorDaysAction, rescheduleAppointmentAction } from '@/app/actions/appointments';
import type { DoctorDay } from '@/services/appointments';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

interface Props {
  patientId: string;
  moveId: string | null;
  today: string;
  date: string;
  doctorId: string;
  time: string;
  reason: string;
  minutes: number;
  doctors: DoctorDay[];
}

/**
 * Pick doctor, date and a free time (LET-167). Changing the doctor or date
 * reloads the free slots from the server; "Other time" allows a booking off
 * the slot grid. The server is the judge of overlaps.
 */
export default function BookingForm({ patientId, moveId, today, date: serverDate, doctorId: serverDoctorId, time: initialTime, reason: initialReason, minutes: initialMinutes, doctors: serverDoctors }: Props) {
  // Doctor, date and free slots live here. A new date asks the server for its
  // slots directly, not by navigating (QA 8 Nov: a navigation could stall and
  // leave the form on "Loading free times…", and two quick changes undid each other).
  const [doctorId, setDoctorId] = useState(serverDoctorId);
  const [date, setDate] = useState(serverDate);
  const [doctors, setDoctors] = useState(serverDoctors);
  const [loading, setLoading] = useState(false);
  const asked = useRef(serverDate);
  const { busy, notSent, send, release, navigate } = useActionForm(moveId ? 'appointment.move' : 'appointment.book');
  const [time, setTime] = useState(initialTime);
  const [other, setOther] = useState(!!initialTime && !doctors.find((d) => d.providerId === doctorId)?.free.includes(initialTime));
  const [reason, setReason] = useState(initialReason);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const doc = doctors.find((d) => d.providerId === doctorId);
  const slot = minutes || doc?.slotMinutes || 15;

  function pickDoctor(id: string) {
    setDoctorId(id);
    setTime('');
    setOther(false);
    setErrors({});
  }

  function pickDate(d: string) {
    if (!d) return;
    setDate(d);
    setTime('');
    setOther(false);
    setErrors({});
    asked.current = d;
    setLoading(true);
    void (async () => {
      try {
        const res = await doctorDaysAction(d);
        if (asked.current !== d) return; // a later date was picked meanwhile
        if (res.ok) setDoctors(res.data);
        else setError(res.error);
      } catch {
        if (asked.current === d) setError('Free times didn’t load. Check the internet and pick the date again.');
      } finally {
        if (asked.current === d) setLoading(false);
      }
    })();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    if (!doctorId) return setErrors({ providerId: 'Pick the doctor.' });
    if (!time) {
      timeRef.current?.focus();
      return setErrors({ time: 'Pick a time.' });
    }
    const input = { providerId: doctorId, date, time, minutes, reason };
    void (async () => {
      const res = await send(() => (moveId ? rescheduleAppointmentAction(moveId, input) : bookAppointmentAction(patientId, input)));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      await navigate(`/appointments?date=${date}`);
    })();
  }

  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`book-${k}-err`} role="alert">{errors[k]}</div> : null);

  return (
    <form className="card" onSubmit={submit} noValidate aria-label={moveId ? 'Move appointment' : 'Book appointment'}>
      <div className="body">
        <div className="field-grid">
          <div className="field">
            <label htmlFor="book-doctor">Doctor</label>
            <select id="book-doctor" value={doctorId} onChange={(e) => pickDoctor(e.target.value)} aria-invalid={!!errors.providerId}>
              <option value="">Choose…</option>
              {doctors.map((d) => (
                <option key={d.providerId} value={d.providerId}>{d.name}</option>
              ))}
            </select>
            {err('providerId')}
          </div>
          <div className="field">
            <label htmlFor="book-date">Date</label>
            <input id="book-date" type="date" min={today} value={date} onChange={(e) => pickDate(e.target.value)} aria-invalid={!!errors.date} />
            {err('date')}
          </div>
        </div>

        {doc && loading ? <p className="muted small" role="status">Loading free times…</p> : null}
        {doc && !loading ? (
          <fieldset className="field">
            <legend>Time {doc.hours ? <span className="muted small">({doc.name} works {doc.hours.startTime}–{doc.hours.endTime}, {doc.slotMinutes}-minute slots)</span> : <span className="muted small">({doc.name} doesn’t usually work this day)</span>}</legend>
            <div className="chips" role="radiogroup" aria-label="Free times" tabIndex={-1} ref={timeRef}>
              {doc.free.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={!other && time === t} className={`chip${!other && time === t ? ' on' : ''}`} onClick={() => { setOther(false); setTime(t); }}>
                  {t}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={other} className={`chip${other ? ' on' : ''}`} onClick={() => { setOther(true); }}>Other time</button>
            </div>
            {doc.free.length === 0 ? <div className="hint">No free slot left this day. Use Other time, or pick another day.</div> : null}
            {other ? (
              <div className="field narrow">
                <label htmlFor="book-time">Other time</label>
                <input id="book-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            ) : null}
            {err('time')}
          </fieldset>
        ) : null}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="book-minutes">Length</label>
            <select id="book-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              <option value={0}>{doc ? `${doc.slotMinutes} minutes (usual)` : 'Usual slot'}</option>
              {[15, 20, 30, 45, 60, 90, 120].filter((m) => m !== doc?.slotMinutes).map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
            {err('minutes')}
          </div>
          <div className="field">
            <label htmlFor="book-reason">Reason <span className="muted small">(optional, stays in Chairside)</span></label>
            <input id="book-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Check-up, RCT sitting 2" maxLength={80} autoComplete="off" />
            {err('reason')}
          </div>
        </div>

        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : moveId ? `Move to ${time || '…'}` : time ? `Book ${time}, ${slot} min` : 'Book'}
          </button>
        </div>
      </div>
    </form>
  );
}
