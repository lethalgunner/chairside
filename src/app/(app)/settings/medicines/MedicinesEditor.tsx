'use client';

import { useState } from 'react';
import { addStarterMedicinesAction, saveMedicineAction, setMedicineActiveAction } from '@/app/actions/rx';
import type { MedicineRow } from '@/services/rx';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

type Draft = { name: string; strength: string; form: string; dose: string; frequency: string; days: string; instructions: string };
const EMPTY: Draft = { name: '', strength: '', form: 'tablet', dose: '', frequency: '', days: '', instructions: '' };

/** The clinic's medicine list (LET-172). */
export default function MedicinesEditor({ medicines, forms }: { medicines: MedicineRow[]; forms: { value: string; label: string }[] }) {
  const { busy, notSent, send, release, navigate } = useActionForm('medicine.save');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const shown = medicines.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const err = (k: string) => (errors[k] ? <div className="hint err-text">{errors[k]}</div> : null);

  function open(m: MedicineRow | null) {
    setErrors({});
    setError(null);
    setMsg(null);
    setEditing(m ? m.id : 'new');
    setDraft(m ? { name: m.name, strength: m.strength ?? '', form: m.form, dose: m.dose ?? '', frequency: m.frequency ?? '', days: m.days?.toString() ?? '', instructions: m.instructions ?? '' } : EMPTY);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    void (async () => {
      const res = await send(() => saveMedicineAction(editing === 'new' ? null : editing, draft));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setMsg(`${draft.name.trim()} saved.`);
      setEditing(null);
      await navigate();
    })();
  }

  function act(call: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>, done: (data: unknown) => string) {
    setError(null);
    setMsg(null);
    void (async () => {
      const res = await send<{ ok: true; data?: unknown } | { ok: false; error: string }>(call);
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      setMsg(done(res.data));
      await navigate();
    })();
  }

  return (
    <section className="card" aria-label="Medicines">
      <header>
        <h2>Medicines · {medicines.filter((m) => m.active).length}</h2>
        <span className="row-actions">
          <button type="button" className="linkish" onClick={() => open(null)}>+ Medicine</button>
          <button type="button" className="linkish" disabled={busy} onClick={() => act(() => addStarterMedicinesAction(), (d) => `${(d as { added: number }).added} common dental medicines added. Check each dose before using it.`)}>Add common dental medicines</button>
        </span>
      </header>
      <div className="body">
        {msg ? <div className="callout good" role="status">{msg}</div> : null}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        {editing ? (
          <form onSubmit={save} noValidate aria-label={editing === 'new' ? 'New medicine' : `Edit ${draft.name}`} className="sub-form">
            <div className="field-grid">
              <div className="field"><label htmlFor="med-name">Name</label><input id="med-name" value={draft.name} onChange={set('name')} placeholder="Amoxicillin" autoFocus />{err('name')}</div>
              <div className="field"><label htmlFor="med-str">Strength</label><input id="med-str" value={draft.strength} onChange={set('strength')} placeholder="500 mg" />{err('strength')}</div>
              <div className="field"><label htmlFor="med-form">Form</label><select id="med-form" value={draft.form} onChange={set('form')}>{forms.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>{err('form')}</div>
              <div className="field"><label htmlFor="med-dose">Usual dose</label><input id="med-dose" value={draft.dose} onChange={set('dose')} placeholder="1 capsule" />{err('dose')}</div>
              <div className="field"><label htmlFor="med-freq">How often</label><input id="med-freq" value={draft.frequency} onChange={set('frequency')} placeholder="1-0-1 or SOS" />{err('frequency')}</div>
              <div className="field"><label htmlFor="med-days">Days</label><input id="med-days" inputMode="numeric" value={draft.days} onChange={set('days')} placeholder="5" />{err('days')}</div>
              <div className="field"><label htmlFor="med-ins">Instructions</label><input id="med-ins" value={draft.instructions} onChange={set('instructions')} placeholder="After food" />{err('instructions')}</div>
            </div>
            <div className="actions">
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save medicine'}</button>
              <button className="secondary-btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : null}
        {medicines.length > 8 ? <input className="filter" aria-label="Find a medicine" placeholder="Find a medicine" value={q} onChange={(e) => setQ(e.target.value)} /> : null}
        {medicines.length === 0 ? <p className="muted">No medicines yet. Press “Add common dental medicines” to start with about 30, then edit them.</p> : null}
        <ul className="plain med-list">
          {shown.map((m) => (
            <li key={m.id} className={m.active ? '' : 'inactive'}>
              <strong>{m.name}</strong> {m.strength ? <span>{m.strength}</span> : null} <span className="muted small">{forms.find((f) => f.value === m.form)?.label}</span>
              <div className="muted small">{[m.dose, m.frequency, m.days ? `${m.days} days` : null, m.instructions].filter(Boolean).join(' · ') || 'No defaults'}</div>
              <span className="row-actions">
                <button type="button" className="linkish small" onClick={() => open(m)} aria-label={`Edit ${m.name}`}>Edit</button>
                <button type="button" className="linkish small" disabled={busy} onClick={() => act(() => setMedicineActiveAction(m.id, !m.active), () => (m.active ? `${m.name} hidden from new prescriptions.` : `${m.name} is back.`))}>{m.active ? 'Hide' : 'Bring back'}</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
