'use client';

import { useState } from 'react';
import { saveCatalogueItemAction, setCatalogueItemActiveAction } from '@/app/actions/settings';
import { formatINR, type Paise } from '@/domain/money';
import { CategoryLabel, TaxPill } from '@/components/ui';
import type { TaxCategory } from '@/domain/tax';
import { useActionForm } from '@/lib/nav/use-action-form';

interface Item {
  id: string;
  code: string;
  name: string;
  category: string | null;
  price: string;
  pricePaise: Paise;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  gstRateBp: number;
  active: boolean;
}

interface Props {
  items: Item[];
  taxCategories: { value: TaxCategory; label: string; hsnSacCode: string; gstRateBp: number }[];
  rates: number[];
}

type Draft = { code: string; name: string; category: string; price: string; taxCategory: string; hsnSacCode: string; gstRateBp: number };
const EMPTY: Draft = { code: '', name: '', category: '', price: '', taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 };

export default function CatalogueEditor({ items, taxCategories, rates }: Props) {
  const { busy: pending, send, release, navigate } = useActionForm('catalogue.save');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const exempt = draft.taxCategory === 'exempt_healthcare';

  function open(item: Item | null) {
    setErrors({});
    setError(null);
    setSaved(null);
    setEditing(item ? item.id : 'new');
    setDraft(item ? { code: item.code, name: item.name, category: item.category ?? '', price: item.price, taxCategory: item.taxCategory, hsnSacCode: item.hsnSacCode, gstRateBp: item.gstRateBp } : EMPTY);
  }

  function pickCategory(value: string) {
    const d = taxCategories.find((c) => c.value === value);
    // Prefill the usual code and rate for the category; both stay editable (except exempt, fixed at 0 %).
    setDraft((x) => ({ ...x, taxCategory: value, hsnSacCode: d?.hsnSacCode || x.hsnSacCode, gstRateBp: d ? d.gstRateBp : x.gstRateBp }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => saveCatalogueItemAction(editing === 'new' ? null : editing, { ...draft, gstRateBp: exempt ? 0 : draft.gstRateBp }));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setSaved(`${draft.name.trim()} saved.`);
      setEditing(null);
      await navigate();
    })();
  }

  function toggle(item: Item) {
    setError(null);
    setSaved(null);
    void (async () => {
      const res = await send(() => setCatalogueItemActiveAction(item.id, !item.active));
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      await navigate();
    })();
  }

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`item-${k}-err`}>{errors[k]}</div> : null);
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `item-${k}-err` : undefined, className: errors[k] ? 'err' : undefined });

  return (
    <>
      {saved ? <div className="callout good" role="status">{saved}</div> : null}
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      {editing ? (
        <form className="card" onSubmit={save} noValidate aria-label={editing === 'new' ? 'New item' : `Edit ${draft.name}`}>
          <header><h2>{editing === 'new' ? 'New item' : `Edit ${draft.code}`}</h2></header>
          <div className="body">
            <div className="field-grid">
              <div className="field">
                <label htmlFor="item-code">Code <span className="req">required</span></label>
                <input id="item-code" value={draft.code} onChange={set('code')} disabled={editing !== 'new'} autoComplete="off" {...aria('code')} />
                {errors.code ? err('code') : <div className="hint">{editing === 'new' ? 'Short and permanent, like RCT.' : 'The code can’t change.'}</div>}
              </div>
              <div className="field">
                <label htmlFor="item-name">Name <span className="req">required</span></label>
                <input id="item-name" value={draft.name} onChange={set('name')} autoComplete="off" {...aria('name')} />
                {err('name')}
              </div>
              <div className="field">
                <label htmlFor="item-category">Category</label>
                <input id="item-category" value={draft.category} onChange={set('category')} placeholder="e.g. Endodontics" autoComplete="off" {...aria('category')} />
                {err('category')}
              </div>
              <div className="field">
                <label htmlFor="item-price">Price (₹) <span className="req">required</span></label>
                <input id="item-price" inputMode="decimal" value={draft.price} onChange={set('price')} autoComplete="off" {...aria('price')} />
                {errors.price ? err('price') : <div className="hint">Before GST. Changes apply to bills issued from now on.</div>}
              </div>
              <div className="field">
                <label htmlFor="item-tax">GST treatment</label>
                <select id="item-tax" value={draft.taxCategory} onChange={(e) => pickCategory(e.target.value)} {...aria('taxCategory')}>
                  {taxCategories.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                {err('taxCategory')}
              </div>
              <div className="field">
                <label htmlFor="item-hsn">HSN/SAC <span className="req">required</span></label>
                <input id="item-hsn" inputMode="numeric" value={draft.hsnSacCode} onChange={set('hsnSacCode')} autoComplete="off" {...aria('hsnSacCode')} />
                {err('hsnSacCode')}
              </div>
              <div className="field">
                <label htmlFor="item-rate">GST %</label>
                <select id="item-rate" value={exempt ? 0 : draft.gstRateBp} disabled={exempt} onChange={(e) => setDraft((x) => ({ ...x, gstRateBp: Number(e.target.value) }))} {...aria('gstRateBp')}>
                  {rates.map((r) => (
                    <option key={r} value={r}>{r / 100}%</option>
                  ))}
                </select>
                {errors.gstRateBp ? err('gstRateBp') : exempt ? <div className="hint">Exempt healthcare is always 0%.</div> : null}
              </div>
            </div>
            <div className="actions">
              <button className="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : editing === 'new' ? 'Add item' : 'Save changes'}</button>
              <button className="secondary-btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button className="primary" type="button" onClick={() => open(null)}>Add item</button>
        </div>
      )}
      <section className="card" aria-label="Items">
        <header><h2>Items</h2><span className="note">{items.filter((i) => i.active).length} active</span></header>
        <div className="body flush tablewrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">Price</th>
                <th scope="col">GST</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={i.active ? undefined : 'muted'}>
                  <td className="mono">{i.code}</td>
                  <td>{i.name}<div><CategoryLabel c={i.taxCategory} /></div></td>
                  <td>{i.category ?? '—'}</td>
                  <td className="num">{formatINR(i.pricePaise)}</td>
                  <td><TaxPill rateBp={i.gstRateBp} code={i.hsnSacCode} /></td>
                  <td>{i.active ? <span className="pill paid">Active</span> : <span className="pill credit">Inactive</span>}</td>
                  <td className="row-actions">
                    <button type="button" className="linkish" disabled={pending} aria-label={`Edit ${i.name}`} onClick={() => open(i)}>Edit</button>
                    <button type="button" className={i.active ? 'linkish danger' : 'linkish'} disabled={pending} aria-label={`${i.active ? 'Deactivate' : 'Reactivate'} ${i.name}`} onClick={() => toggle(i)}>
                      {i.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
