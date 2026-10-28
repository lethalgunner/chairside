'use client';

import { useState } from 'react';
import { previewCatalogueImportAction, saveCatalogueImportAction } from '@/app/actions/settings';
import { checkPasteSize, IMPORT_COLUMNS, IMPORT_FIELD_LABELS, IMPORT_MAX_ROWS, type PreviewRow } from '@/domain/catalogue-import';
import { formatINR } from '@/domain/money';
import { CategoryLabel, TaxPill } from '@/components/ui';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';
import type { ImportPreview } from '@/services/catalogue-import';

type Preview = Extract<ImportPreview, { ok: true }>;

const STATUS: Record<PreviewRow['status'], { label: string; cls: string }> = {
  new: { label: 'New', cls: 'paid' },
  update: { label: 'Will update', cls: 'credit' },
  error: { label: 'Error', cls: 'due' },
};

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/**
 * Paste the price list from Excel (T25). The server parses the text for the
 * preview and again on save; this component never decides what a row is.
 */
export default function PasteImport({ onClose }: { onClose: () => void }) {
  const { busy, notSent, send, release, navigate } = useActionForm('catalogue.import');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [doing, setDoing] = useState<'check' | 'save'>('check');

  const toSave = preview ? preview.counts.new + preview.counts.update : 0;
  const canSave = !!preview && preview.counts.error === 0 && toSave > 0 && !busy;

  function edit(value: string) {
    // Any change makes the last check stale: Save waits for a fresh one.
    setText(value);
    setPreview(null);
    setPasteError(null);
    setSaved(null);
  }

  function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setPreview(null);
    const tooBig = checkPasteSize(text);
    if (tooBig) return setPasteError(tooBig);
    setDoing('check');
    void (async () => {
      const res = await send(() => previewCatalogueImportAction(text));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setPasteError(res.data.error);
      setPasteError(null);
      setPreview(res.data);
    })();
  }

  function save() {
    if (!preview || !canSave) return;
    setError(null);
    setDoing('save');
    void (async () => {
      const res = await send(() => saveCatalogueImportAction(text, preview.plan));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) {
        setPasteError(res.data.error);
        setPreview(res.data.preview?.ok ? res.data.preview : null);
        return;
      }
      setSaved(`Saved ${items(res.data.created + res.data.updated)}.`);
      setText('');
      setPreview(null);
      await navigate();
    })();
  }

  const describedBy = ['import-hint', pasteError ? 'import-err' : null].filter(Boolean).join(' ');

  return (
    <section className="card paste-import" aria-labelledby="import-title">
      <header>
        <h2 id="import-title">Paste from Excel</h2>
        <span className="note">Up to {IMPORT_MAX_ROWS} rows</span>
      </header>
      <div className="body">
        <NotSent message={notSent} />
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        {saved ? <div className="callout good" role="status">{saved}</div> : null}
        <form onSubmit={check} noValidate aria-label="Paste from Excel">
          <div className="field">
            <label htmlFor="import-text">Rows from Excel</label>
            <textarea
              id="import-text"
              rows={8}
              value={text}
              onChange={(e) => edit(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!pasteError}
              aria-describedby={describedBy}
              className={pasteError ? 'err' : undefined}
            />
            <div className="hint" id="import-hint">
              Select the cells in Excel or Google Sheets, copy, and paste here. Columns in this order: {IMPORT_COLUMNS.join(', ')}. A header row is fine. GST treatment can be exempt, prosthetic, retail, cosmetic or other.
            </div>
            {pasteError ? <div className="hint err-text" id="import-err">{pasteError}</div> : null}
          </div>
          <div className="actions">
            <button className="secondary-btn" type="submit" disabled={busy || !text.trim()}>{busy && doing === 'check' ? 'Checking…' : 'Check'}</button>
            <button className="primary" type="button" disabled={!canSave} onClick={save}>{busy && doing === 'save' ? 'Saving…' : `Save ${items(toSave)}`}</button>
            <button className="secondary-btn" type="button" onClick={onClose}>Close</button>
          </div>
        </form>
        {preview ? (
          <>
            <p className="import-summary" role="status">
              {preview.summary}.{' '}
              {preview.counts.error > 0 ? 'Fix the rows marked Error in Excel, paste again and press Check. Nothing is saved until every row is right.' : 'Nothing is saved until you press Save.'}
            </p>
            <div className="tablewrap">
              <table className="stack-table import-preview" aria-label="Rows to save">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Result</th>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col" className="num">Price</th>
                    <th scope="col">GST</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <PreviewLine key={r.line} r={r} />
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

function PreviewLine({ r }: { r: PreviewRow }) {
  const s = STATUS[r.status];
  const v = r.value;
  return (
    <tr className={r.status === 'error' ? 'import-error-row' : undefined}>
      <td className="mono" data-label="Line">{r.line}</td>
      <td data-label="Result"><span className={`pill ${s.cls}`}>{s.label}</span></td>
      <td className="mono" data-label="Code">{v ? v.code : r.cells[0] || '—'}</td>
      <td data-label="Name">
        {v ? v.name : r.cells[1] || '—'}
        {v ? <div><CategoryLabel c={v.taxCategory} /></div> : null}
      </td>
      <td className="num" data-label="Price">
        {v ? (
          r.oldPricePaise !== null && r.oldPricePaise !== v.defaultPricePaise ? (
            <>
              <span className="muted">{formatINR(r.oldPricePaise)}</span> → {formatINR(v.defaultPricePaise)}
            </>
          ) : (
            formatINR(v.defaultPricePaise)
          )
        ) : (
          r.cells[3] || '—'
        )}
      </td>
      <td data-label="GST">{v ? <TaxPill rateBp={v.gstRateBp} code={v.hsnSacCode} /> : r.cells[6] || '—'}</td>
      <td data-label="Notes">
        {r.status === 'error' ? (
          <ul className="import-errors">
            {Object.entries(r.errors).map(([k, msg]) => (
              <li key={k}>
                <strong>{IMPORT_FIELD_LABELS[k] ?? k}:</strong> {msg}
              </li>
            ))}
          </ul>
        ) : r.status === 'update' ? (
          r.oldPricePaise === v!.defaultPricePaise && r.alsoChanges.length === 0 ? 'No change' : r.alsoChanges.length > 0 ? `Also changes ${r.alsoChanges.join(', ')}` : 'Price only'
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}
