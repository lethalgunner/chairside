'use client';

import { useState } from 'react';
import { previewImportAction, saveImportAction } from '@/app/actions/import';
import { APPOINTMENT_COLUMNS, COLUMN_LABEL, DATA_IMPORT_MAX_BYTES, DATA_IMPORT_MAX_ROWS, PATIENT_COLUMNS, type ImportKind } from '@/domain/data-import';
import type { DataPreview, DataPreviewRow } from '@/services/data-import';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

type Preview = Extract<DataPreview, { ok: true }>;
const STATUS: Record<DataPreviewRow['status'], { label: string; cls: string }> = {
  new: { label: 'Will add', cls: 'paid' },
  skip: { label: 'Skipped', cls: '' },
  error: { label: 'Problem', cls: 'due' },
};
const noun = (k: ImportKind, n: number) => `${n} ${k === 'patients' ? (n === 1 ? 'patient' : 'patients') : n === 1 ? 'appointment' : 'appointments'}`;

/** The browser only sends text; the server decides what every row is, on Check and again on Import. */
export default function DataImport({ kind, branchName }: { kind: ImportKind; branchName: string }) {
  const { busy, notSent, send, release, navigate } = useActionForm('import');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [doing, setDoing] = useState<'check' | 'save'>('check');
  const cols = (kind === 'patients' ? PATIENT_COLUMNS : APPOINTMENT_COLUMNS).map((c) => COLUMN_LABEL[c]).join(', ');
  const canImport = !!preview && preview.counts.error === 0 && preview.counts.new > 0 && !busy;

  function edit(v: string) {
    setText(v);
    setPreview(null);
    setPasteError(null);
    setDone(null);
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > DATA_IMPORT_MAX_BYTES) return setPasteError(`That file is over ${DATA_IMPORT_MAX_BYTES / 1024} KB. Split it into parts of up to ${DATA_IMPORT_MAX_ROWS} rows.`);
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) return setPasteError('Pick a .csv file (in Excel: File → Save as → CSV). Or copy the cells and paste them in the box.');
    edit(await file.text());
  }

  function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setPreview(null);
    setDoing('check');
    void (async () => {
      const res = await send(() => previewImportAction(kind, text));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setPasteError(res.data.error);
      setPasteError(null);
      setPreview(res.data);
    })();
  }

  function save() {
    if (!preview || !canImport) return;
    setError(null);
    setDoing('save');
    void (async () => {
      const res = await send(() => saveImportAction(kind, text, preview.counts.new));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) {
        setPasteError(res.data.error);
        setPreview(res.data.preview?.ok ? res.data.preview : null);
        return;
      }
      setDone(`Imported ${noun(kind, res.data.created)} into ${branchName}${res.data.skipped ? ` (${res.data.skipped} skipped)` : ''}.${kind === 'patients' ? ' Next: coming appointments.' : ''}`);
      setText('');
      setPreview(null);
      await navigate();
    })();
  }

  return (
    <section className="card" aria-labelledby="di-title">
      <header>
        <h2 id="di-title">{kind === 'patients' ? 'Patients' : 'Coming appointments'} into {branchName}</h2>
        <span className="note">Up to {DATA_IMPORT_MAX_ROWS} rows at a time</span>
      </header>
      <div className="body">
        <NotSent message={notSent} />
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        {done ? <div className="callout good" role="status">{done}</div> : null}
        <form onSubmit={check} noValidate aria-label={`Import ${kind}`}>
          <div className="field">
            <label htmlFor="di-text">Rows from Excel or a CSV file</label>
            <textarea id="di-text" rows={8} value={text} onChange={(e) => edit(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!!pasteError} aria-describedby={`di-hint${pasteError ? ' di-err' : ''}`} className={pasteError ? 'err' : undefined} />
            <div className="hint" id="di-hint">
              {kind === 'patients'
                ? `Columns are found by their names (Name, Mobile or Phone, Gender, Age, DOB…). Without a header row the order is ${cols}. Sex, age and date of birth can be blank. Someone already here with the same mobile and name is skipped.`
                : `Columns are found by their names (Mobile, Patient, Date, Time, Doctor, Duration). Without a header row the order is ${cols}. Dates like 21/11/2026, times like 11:00 or 4:30 pm. Patients are matched by mobile, so import them first. Past appointments are skipped. Imported appointments don’t get a “booking confirmation” message; the usual reminders before them still apply.`}
            </div>
            {pasteError ? <div className="hint err-text" id="di-err">{pasteError}</div> : null}
          </div>
          <div className="field">
            <label htmlFor="di-file">Or pick a CSV file</label>
            <input id="di-file" type="file" accept=".csv,.txt,.tsv,text/csv" onChange={(e) => void pickFile(e)} />
          </div>
          <div className="actions">
            <button className="secondary-btn" type="submit" disabled={busy || !text.trim()}>{busy && doing === 'check' ? 'Checking…' : 'Check'}</button>
            <button className="primary" type="button" disabled={!canImport} onClick={save}>{busy && doing === 'save' ? 'Importing…' : `Import ${noun(kind, preview?.counts.new ?? 0)}`}</button>
          </div>
        </form>
        {preview ? (
          <>
            <p className="import-summary" role="status">
              {noun(kind, preview.counts.new)} to add, {preview.counts.skip} skipped, {preview.counts.error} with problems.{' '}
              {preview.counts.error > 0 ? 'Fix the rows marked Problem, paste again and press Check. Nothing is imported until every row is right.' : 'Nothing is saved until you press Import.'}
            </p>
            <div className="tablewrap">
              <table className="stack-table import-preview" aria-label="Rows to import">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Result</th>
                    <th scope="col">Row</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={r.status === 'error' ? 'diff-row' : undefined}>
                      <td data-label="Line" className="mono">{r.line}</td>
                      <td data-label="Result"><span className={`pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                      <td data-label="Row">{r.summary || '—'}</td>
                      <td data-label="Notes" className="small">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
