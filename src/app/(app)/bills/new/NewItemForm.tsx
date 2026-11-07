'use client';

import { useState } from 'react';
import { addBillItemAction } from '@/app/actions/settings';
import type { CatalogueEntry } from '@/services/catalogue';
import type { TaxCategory } from '@/domain/tax';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

export interface NewItemOptions {
  taxCategories: { value: TaxCategory; label: string; hsnSacCode: string; gstRateBp: number }[];
  rates: number[];
}

interface Props extends NewItemOptions {
  initialName: string;
  onAdded: (item: CatalogueEntry) => void;
  onCancel: () => void;
}

/**
 * "+ New item" on the bill (owner only). Saves to the price list with the same
 * rules as Settings → Price list, then hands the item back to be added to the
 * bill. No code field: the server picks one (RCT, RCT-2…).
 */
export default function NewItemForm({ initialName, taxCategories, rates, onAdded, onCancel }: Props) {
  const { busy, notSent, send, release } = useActionForm('catalogue.create_from_bill');
  const [draft, setDraft] = useState({ name: initialName, price: '', taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const exempt = draft.taxCategory === 'exempt_healthcare';

  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`new-${k}-err`}>{errors[k]}</div> : null);
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `new-${k}-err` : undefined, className: errors[k] ? 'err' : undefined });

  function pickCategory(value: string) {
    const d = taxCategories.find((c) => c.value === value);
    setDraft((x) => ({ ...x, taxCategory: value, hsnSacCode: d?.hsnSacCode || x.hsnSacCode, gstRateBp: d ? d.gstRateBp : x.gstRateBp }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => addBillItemAction({ ...draft, gstRateBp: exempt ? 0 : draft.gstRateBp }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      onAdded(res.data.item);
    })();
  }

  return (
    <form className="callout new-item" onSubmit={save} noValidate aria-label="New item for the price list">
      <strong>New item</strong>
      <div className="hint">Saved to the price list for every branch, and added to this bill.</div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="new-name">Name <span className="req">required</span></label>
          <input id="new-name" value={draft.name} onChange={(e) => setDraft((x) => ({ ...x, name: e.target.value }))} autoComplete="off" autoFocus={!initialName} {...aria('name')} />
          {err('name')}
        </div>
        <div className="field">
          <label htmlFor="new-price">Price (₹) <span className="req">required</span></label>
          <input id="new-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft((x) => ({ ...x, price: e.target.value }))} autoComplete="off" autoFocus={!!initialName} {...aria('price')} />
          {errors.price ? err('price') : <div className="hint">Before GST.</div>}
        </div>
        <div className="field">
          <label htmlFor="new-tax">GST treatment</label>
          <select id="new-tax" value={draft.taxCategory} onChange={(e) => pickCategory(e.target.value)} {...aria('taxCategory')}>
            {taxCategories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          {err('taxCategory')}
        </div>
        {exempt ? null : (
          <>
            <div className="field">
              <label htmlFor="new-hsn">HSN/SAC</label>
              <input id="new-hsn" inputMode="numeric" value={draft.hsnSacCode} onChange={(e) => setDraft((x) => ({ ...x, hsnSacCode: e.target.value }))} autoComplete="off" {...aria('hsnSacCode')} />
              {err('hsnSacCode')}
            </div>
            <div className="field">
              <label htmlFor="new-rate">GST %</label>
              <select id="new-rate" value={draft.gstRateBp} onChange={(e) => setDraft((x) => ({ ...x, gstRateBp: Number(e.target.value) }))} {...aria('gstRateBp')}>
                {rates.map((r) => (
                  <option key={r} value={r}>{r / 100}%</option>
                ))}
              </select>
              {errors.gstRateBp ? err('gstRateBp') : <div className="hint">Not yet confirmed by a CA.</div>}
            </div>
          </>
        )}
      </div>
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <NotSent message={notSent} />
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and add to bill'}</button>
        <button className="secondary-btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
