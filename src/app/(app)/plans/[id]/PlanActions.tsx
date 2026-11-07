'use client';

import { useRef, useState } from 'react';
import { dropPlanItemAction, markItemsDoneAction, setPlanStatusAction, updatePlanItemAction } from '@/app/actions/plans';
import type { PlanStatus } from '@/domain/plans';
import type { ProviderOption } from '@/services/providers';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/** Tick the work done at today's sitting and record it under a doctor. */
export function MarkDone({ planId, enabled, doctors, defaultDoctorId, children }: { planId: string; enabled: boolean; doctors: ProviderOption[]; defaultDoctorId: string; children: React.ReactNode }) {
  const { busy, notSent, send, release, navigate } = useActionForm('plan.items_done');
  const formRef = useRef<HTMLFormElement>(null);
  const [doctorId, setDoctorId] = useState(doctors.some((d) => d.id === defaultDoctorId) ? defaultDoctorId : (doctors[0]?.id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ids = new FormData(formRef.current!).getAll('done').map(String);
    if (ids.length === 0) return setError('Tick the work that was done today.');
    void (async () => {
      const res = await send(() => markItemsDoneAction(planId, ids, doctorId));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      setDone(`${res.data.done} marked done. It is now under “Done, not billed” until you bill it.`);
      await navigate();
    })();
  }

  if (!enabled) return <>{children}</>;
  return (
    <form ref={formRef} onSubmit={submit} aria-label="Mark plan work done">
      {children}
      <div className="card"><div className="body">
        <div className="inline-form">
          <label htmlFor="done-doctor">Done today by</label>
          <select id="done-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.fullName}</option>
            ))}
          </select>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Mark ticked work done'}</button>
        </div>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        {done ? <div className="callout good" role="status">{done}</div> : null}
        <NotSent message={notSent} />
      </div></div>
    </form>
  );
}

/** Change or drop a line that is still to do. */
export function ItemControls({ item }: { item: { id: string; name: string; toothNumber: string; quantity: number; price: string; priceReason: string; session: number } }) {
  const { busy, send, release, navigate } = useActionForm('plan.item');
  const [mode, setMode] = useState<'edit' | 'drop' | null>(null);
  const [draft, setDraft] = useState(item);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    setErrors({});
    void (async () => {
      type R = { ok: true; data?: { ok: true } | { ok: false; fieldErrors: Record<string, string> } } | { ok: false; error: string };
      const res = await send<R>(() =>
        mode === 'drop'
          ? dropPlanItemAction(item.id, reason)
          : updatePlanItemAction(item.id, { toothNumber: draft.toothNumber, quantity: Number(draft.quantity) || 0, price: draft.price, priceReason: draft.priceReason, session: Number(draft.session) || 0 }),
      );
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (res.data && !res.data.ok) return setErrors(res.data.fieldErrors);
      setMode(null);
      await navigate();
    })();
  }

  if (!mode) {
    return (
      <span className="row-actions">
        <button type="button" className="linkish small" onClick={() => setMode('edit')} aria-label={`Change ${item.name}`}>Change</button>
        <button type="button" className="linkish small danger" onClick={() => setMode('drop')} aria-label={`Drop ${item.name}`}>Drop</button>
      </span>
    );
  }
  return (
    <div className="item-edit">
      {mode === 'edit' ? (
        <>
          <label>Tooth <input className="tiny" value={draft.toothNumber} onChange={(e) => setDraft({ ...draft, toothNumber: e.target.value })} /></label>
          <label>Qty <input className="tiny num" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value.replace(/\D/g, '')) })} /></label>
          <label>Sitting <input className="tiny num" value={draft.session} onChange={(e) => setDraft({ ...draft, session: Number(e.target.value.replace(/\D/g, '')) })} /></label>
          <label>Price ₹ <input className="small-in num" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></label>
          <label>Why <input className="small-in" value={draft.priceReason} onChange={(e) => setDraft({ ...draft, priceReason: e.target.value })} placeholder="if not the list price" /></label>
        </>
      ) : (
        <label>Why drop it? <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. patient chose extraction" autoFocus /></label>
      )}
      {Object.values(errors).map((m) => <div key={m} className="hint err-text" role="alert">{m}</div>)}
      {error ? <div className="hint err-text" role="alert">{error}</div> : null}
      <button type="button" className="secondary-btn" disabled={busy} onClick={save}>{mode === 'drop' ? 'Drop it' : 'Save'}</button>
      <button type="button" className="linkish small" onClick={() => setMode(null)}>Cancel</button>
    </div>
  );
}

/** Accept, complete, reopen or cancel the whole plan. */
export default function PlanActions({ planId, status }: { planId: string; status: PlanStatus }) {
  const { busy, notSent, send, release, navigate } = useActionForm('plan.status');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function go(to: 'accepted' | 'completed' | 'cancelled') {
    setError(null);
    void (async () => {
      const res = await send(() => setPlanStatusAction(planId, to, reason));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      setCancelling(false);
      await navigate();
    })();
  }

  if (status === 'cancelled') return null;
  return (
    <div className="actions">
      {status === 'draft' ? <button type="button" className="secondary-btn" disabled={busy} onClick={() => go('accepted')}>Patient accepted the estimate</button> : null}
      {status === 'accepted' ? <button type="button" className="secondary-btn" disabled={busy} onClick={() => go('completed')}>Mark plan complete</button> : null}
      {status === 'completed' ? <button type="button" className="secondary-btn" disabled={busy} onClick={() => go('accepted')}>Reopen plan</button> : null}
      {status !== 'completed' ? <button type="button" className="linkish danger" disabled={busy} onClick={() => setCancelling((c) => !c)}>Cancel plan</button> : null}
      {cancelling ? (
        <span className="inline-form">
          <label className="sr-only" htmlFor="plan-cancel">Why cancelled</label>
          <input id="plan-cancel" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. patient moving cities" autoFocus />
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => go('cancelled')}>Cancel the plan</button>
        </span>
      ) : null}
      {error ? <span className="err-text small" role="alert">{error}</span> : null}
      <NotSent message={notSent} />
    </div>
  );
}
