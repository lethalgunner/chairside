'use client';

import { useMemo, useState } from 'react';
import { writePrescriptionAction } from '@/app/actions/rx';
import type { MedicineRow, TemplateRow } from '@/services/rx';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

type Line = { key: string; medicineId: string; name: string; strength: string; form: string; dose: string; frequency: string; days: string; instructions: string };

interface Props {
  patientId: string;
  replacesId: string | null;
  allergies: string;
  medicines: MedicineRow[];
  templates: TemplateRow[];
  suggested: string[];
  initial: { complaint: string; advice: string; lines: { name: string; strength: string | null; form: string | null; dose: string | null; frequency: string | null; days: number | null; instructions: string | null }[] } | null;
}

/**
 * Prescription form (LET-173): pick a template (suggested ones first) or
 * medicines, adjust doses, sign. Nothing is saved until Sign; a signed
 * prescription can only be corrected by a new one.
 */
export default function RxForm({ patientId, replacesId, allergies: initialAllergies, medicines, templates, suggested, initial }: Props) {
  const { busy, notSent, send, release, navigate } = useActionForm('prescription.sign');
  const [complaint, setComplaint] = useState(initial?.complaint ?? '');
  const [advice, setAdvice] = useState(initial?.advice ?? '');
  const [allergies, setAllergies] = useState(initialAllergies);
  const [lines, setLines] = useState<Line[]>(
    (initial?.lines ?? []).map((l) => ({ key: crypto.randomUUID(), medicineId: medicines.find((m) => m.name === l.name && (m.strength ?? null) === l.strength)?.id ?? '', name: l.name, strength: l.strength ?? '', form: l.form ?? '', dose: l.dose ?? '', frequency: l.frequency ?? '', days: l.days?.toString() ?? '', instructions: l.instructions ?? '' })),
  );
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(() => [...templates].sort((a, b) => Number(suggested.includes(b.id)) - Number(suggested.includes(a.id))), [templates, suggested]);
  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return [];
    return medicines.filter((m) => m.name.toLowerCase().includes(f)).slice(0, 8);
  }, [filter, medicines]);

  const fromMedicine = (m: MedicineRow): Line => ({ key: crypto.randomUUID(), medicineId: m.id, name: m.name, strength: m.strength ?? '', form: m.form, dose: m.dose ?? '', frequency: m.frequency ?? '', days: m.days?.toString() ?? '', instructions: m.instructions ?? '' });

  function applyTemplate(t: TemplateRow) {
    setLines((ls) => [
      ...ls,
      ...t.lines.filter((l) => !ls.some((x) => x.medicineId === l.medicineId)).map((l) => ({ key: crypto.randomUUID(), medicineId: l.medicineId, name: l.name, strength: l.strength ?? '', form: l.form, dose: l.dose ?? '', frequency: l.frequency ?? '', days: l.days?.toString() ?? '', instructions: l.instructions ?? '' })),
    ]);
    if (t.advice && !advice.includes(t.advice)) setAdvice((a) => (a ? `${a}\n${t.advice}` : t.advice!));
  }
  function addTyped() {
    const name = filter.trim();
    if (name.length < 2) return;
    setLines((ls) => [...ls, { key: crypto.randomUUID(), medicineId: '', name, strength: '', form: '', dose: '', frequency: '', days: '', instructions: '' }]);
    setFilter('');
  }
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function sign(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    void (async () => {
      const res = await send(() => writePrescriptionAction({ patientId, replacesId, complaint, advice, allergies, lines: lines.map(({ key: _k, ...l }) => l) }));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      await navigate(`/prescriptions/${res.data.id}`);
    })();
  }

  const lineErr = (i: number) => Object.entries(errors).filter(([k]) => k.startsWith(`lines.${i}.`)).map(([, v]) => v);

  return (
    <form className="card" onSubmit={sign} noValidate aria-label="Prescription">
      <div className="body">
        <div className={`callout${allergies.trim() ? ' warn allergy' : ''}`}>
          <label htmlFor="rx-allergies"><strong>Allergies</strong></label>
          <input id="rx-allergies" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="None known, or e.g. Penicillin" maxLength={200} />
          {errors.allergies ? <div className="hint err-text">{errors.allergies}</div> : <div className="hint">Saved on the patient and printed on the prescription. Check before adding a medicine.</div>}
        </div>

        <div className="field">
          <label htmlFor="rx-complaint">Complaint or diagnosis</label>
          <input id="rx-complaint" value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="e.g. Pain in 36, deep caries" maxLength={200} />
          {errors.complaint ? <div className="hint err-text">{errors.complaint}</div> : null}
        </div>

        {ordered.length > 0 ? (
          <fieldset className="field">
            <legend>Templates</legend>
            <div className="chips">
              {ordered.map((t) => (
                <button key={t.id} type="button" className={`chip${suggested.includes(t.id) ? ' on' : ''}`} onClick={() => applyTemplate(t)} title={t.lines.map((l) => l.name).join(', ')}>
                  {suggested.includes(t.id) ? '★ ' : ''}{t.name}
                </button>
              ))}
            </div>
            {suggested.length > 0 ? <div className="hint">★ suggested from today’s treatment or the patient’s plan.</div> : null}
          </fieldset>
        ) : null}

        <div className="field">
          <label htmlFor="rx-find">Add a medicine</label>
          <input
            id="rx-find"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matches[0]) {
                  setLines((ls) => [...ls, fromMedicine(matches[0]!)]);
                  setFilter('');
                } else addTyped();
              }
            }}
            placeholder="Type a name; Enter adds it"
            autoComplete="off"
          />
          {filter.trim() ? (
            <ul className="pick-list" aria-label="Matching medicines">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => { setLines((ls) => [...ls, fromMedicine(m)]); setFilter(''); }}>
                    <span>{m.name} {m.strength}</span>
                    <span className="muted small">{[m.dose, m.frequency, m.days ? `${m.days} days` : null].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={addTyped}><span>Add “{filter.trim()}” (not on the list)</span></button>
              </li>
            </ul>
          ) : null}
          {errors.lines ? <div className="hint err-text">{errors.lines}</div> : null}
        </div>

        <ol className="rx-lines rx-edit">
          {lines.map((l, i) => (
            <li key={l.key}>
              <strong>{l.name}{l.strength ? ` ${l.strength}` : ''}</strong>
              <input aria-label={`Dose for ${l.name}`} value={l.dose} onChange={(e) => set(l.key, { dose: e.target.value })} placeholder="1 tablet" />
              <input aria-label={`How often for ${l.name}`} value={l.frequency} onChange={(e) => set(l.key, { frequency: e.target.value })} placeholder="1-0-1" />
              <input aria-label={`Days for ${l.name}`} className="tiny" value={l.days} onChange={(e) => set(l.key, { days: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="days" />
              <input aria-label={`Instructions for ${l.name}`} value={l.instructions} onChange={(e) => set(l.key, { instructions: e.target.value })} placeholder="After food" />
              <button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
              {lineErr(i).map((m) => <div key={m} className="hint err-text" style={{ flexBasis: '100%' }}>{m}</div>)}
            </li>
          ))}
        </ol>
        {lines.length === 0 ? <p className="muted small">Pick a template or add medicines.</p> : null}

        <div className="field">
          <label htmlFor="rx-advice">Advice</label>
          <textarea id="rx-advice" rows={3} value={advice} onChange={(e) => setAdvice(e.target.value)} placeholder="Warm saline rinses. Review after 7 days." maxLength={500} />
          {errors.advice ? <div className="hint err-text">{errors.advice}</div> : null}
        </div>

        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy || lines.length === 0}>{busy ? 'Signing…' : replacesId ? 'Sign the corrected prescription' : 'Sign prescription'}</button>
          <span className="muted small">Signed prescriptions can’t be edited, only corrected with a new one.</span>
        </div>
      </div>
    </form>
  );
}
