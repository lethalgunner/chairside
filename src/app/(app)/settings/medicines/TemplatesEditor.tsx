'use client';

import { useState } from 'react';
import { saveTemplateAction, setTemplateActiveAction } from '@/app/actions/rx';
import type { MedicineRow, TemplateRow } from '@/services/rx';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

type Line = { key: string; medicineId: string; dose: string; frequency: string; days: string; instructions: string };
type Draft = { name: string; catalogueItemId: string; advice: string; lines: Line[] };

/** Ready sets of medicines per treatment, e.g. Root canal → 3 medicines (LET-173). */
export default function TemplatesEditor({ templates, medicines, treatments }: { templates: TemplateRow[]; medicines: MedicineRow[]; treatments: { id: string; name: string }[] }) {
  const { busy, notSent, send, release, navigate } = useActionForm('rx_template.save');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', catalogueItemId: '', advice: '', lines: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const lineFrom = (m: MedicineRow): Line => ({ key: crypto.randomUUID(), medicineId: m.id, dose: m.dose ?? '', frequency: m.frequency ?? '', days: m.days?.toString() ?? '', instructions: m.instructions ?? '' });

  function open(t: TemplateRow | null) {
    setErrors({});
    setError(null);
    setMsg(null);
    setEditing(t ? t.id : 'new');
    setDraft(
      t
        ? { name: t.name, catalogueItemId: t.catalogueItemId ?? '', advice: t.advice ?? '', lines: t.lines.map((l) => ({ key: crypto.randomUUID(), medicineId: l.medicineId, dose: l.dose ?? '', frequency: l.frequency ?? '', days: l.days?.toString() ?? '', instructions: l.instructions ?? '' })) }
        : { name: '', catalogueItemId: '', advice: '', lines: [] },
    );
  }
  const setLine = (key: string, patch: Partial<Line>) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    void (async () => {
      const res = await send(() => saveTemplateAction(editing === 'new' ? null : editing, { name: draft.name, catalogueItemId: draft.catalogueItemId, advice: draft.advice, lines: draft.lines.map(({ key: _k, ...l }) => l) }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setMsg(`${draft.name.trim()} saved.`);
      setEditing(null);
      await navigate();
    })();
  }

  function toggle(t: TemplateRow) {
    void (async () => {
      const res = await send(() => setTemplateActiveAction(t.id, !t.active));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      await navigate();
    })();
  }

  const name = (id: string) => {
    const m = medicines.find((x) => x.id === id);
    return m ? `${m.name}${m.strength ? ` ${m.strength}` : ''}` : 'Medicine';
  };
  const lineErr = Object.entries(errors).filter(([k]) => k.startsWith('lines.')).map(([, v]) => v);

  return (
    <section className="card" aria-label="Prescription templates">
      <header>
        <h2>Templates · {templates.filter((t) => t.active).length}</h2>
        <button type="button" className="linkish" onClick={() => open(null)} disabled={medicines.length === 0}>+ Template</button>
      </header>
      <div className="body">
        {msg ? <div className="callout good" role="status">{msg}</div> : null}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        {medicines.length === 0 ? <p className="muted small">Add medicines first.</p> : null}
        {editing ? (
          <form onSubmit={save} noValidate aria-label={editing === 'new' ? 'New template' : `Edit ${draft.name}`} className="sub-form">
            <div className="field-grid">
              <div className="field"><label htmlFor="tpl-name">Template name</label><input id="tpl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Root canal" autoFocus />{errors.name ? <div className="hint err-text">{errors.name}</div> : null}</div>
              <div className="field">
                <label htmlFor="tpl-treat">Suggest after treatment</label>
                <select id="tpl-treat" value={draft.catalogueItemId} onChange={(e) => setDraft({ ...draft, catalogueItemId: e.target.value })}>
                  <option value="">Don’t link</option>
                  {treatments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="tpl-add">Add a medicine</label>
              <select id="tpl-add" value="" onChange={(e) => { const m = medicines.find((x) => x.id === e.target.value); if (m) setDraft((d) => ({ ...d, lines: [...d.lines, lineFrom(m)] })); }}>
                <option value="">Choose…</option>
                {medicines.map((m) => <option key={m.id} value={m.id}>{m.name}{m.strength ? ` ${m.strength}` : ''}</option>)}
              </select>
              {errors.lines ? <div className="hint err-text">{errors.lines}</div> : null}
            </div>
            <ul className="plain rx-lines">
              {draft.lines.map((l) => (
                <li key={l.key}>
                  <strong>{name(l.medicineId)}</strong>
                  <input aria-label={`Dose for ${name(l.medicineId)}`} value={l.dose} onChange={(e) => setLine(l.key, { dose: e.target.value })} placeholder="Dose" />
                  <input aria-label={`How often for ${name(l.medicineId)}`} value={l.frequency} onChange={(e) => setLine(l.key, { frequency: e.target.value })} placeholder="1-0-1" />
                  <input aria-label={`Days for ${name(l.medicineId)}`} className="tiny" value={l.days} onChange={(e) => setLine(l.key, { days: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="Days" />
                  <input aria-label={`Instructions for ${name(l.medicineId)}`} value={l.instructions} onChange={(e) => setLine(l.key, { instructions: e.target.value })} placeholder="After food" />
                  <button type="button" className="icon-btn" aria-label={`Remove ${name(l.medicineId)}`} onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))}>✕</button>
                </li>
              ))}
            </ul>
            {lineErr.map((m) => <div key={m} className="hint err-text">{m}</div>)}
            <div className="field"><label htmlFor="tpl-advice">Advice to print</label><textarea id="tpl-advice" rows={2} value={draft.advice} onChange={(e) => setDraft({ ...draft, advice: e.target.value })} placeholder="Avoid chewing on that side until the crown is fitted." /></div>
            <div className="actions">
              <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</button>
              <button className="secondary-btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : null}
        {templates.length === 0 ? <p className="muted small">No templates yet. Make one per common treatment, like Root canal or Extraction.</p> : null}
        <ul className="plain med-list">
          {templates.map((t) => (
            <li key={t.id} className={t.active ? '' : 'inactive'}>
              <strong>{t.name}</strong> {t.treatmentName ? <span className="muted small">after {t.treatmentName}</span> : null}
              <div className="muted small">{t.lines.map((l) => `${l.name}${l.frequency ? ` ${l.frequency}` : ''}${l.days ? ` × ${l.days}d` : ''}`).join(' · ')}</div>
              <span className="row-actions">
                <button type="button" className="linkish small" onClick={() => open(t)} aria-label={`Edit ${t.name}`}>Edit</button>
                <button type="button" className="linkish small" disabled={busy} onClick={() => toggle(t)}>{t.active ? 'Hide' : 'Bring back'}</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
