'use client';

import { useState } from 'react';
import { recordMovementAction, saveStockItemAction } from '@/app/actions/stock';
import { unitLabel } from '@/domain/stock';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/** Add a stock item: a medicine from the list, or a clinic supply by name (LET-176). */
export function StockItemForm({ kinds, units, medicines, goods }: { kinds: { value: string; label: string }[]; units: string[]; medicines: { id: string; name: string }[]; goods: { id: string; name: string }[] }) {
  const { busy, notSent, send, release, navigate } = useActionForm('stock.item_save');
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ kind: 'supply', name: '', unit: 'box', reorderLevel: '', medicineId: '', catalogueItemId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: string) => (errors[k] ? <div className="hint err-text">{errors[k]}</div> : null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    void (async () => {
      const res = await send(() => saveStockItemAction(null, d));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setOpen(false);
      setD({ kind: d.kind, name: '', unit: d.unit, reorderLevel: '', medicineId: '', catalogueItemId: '' });
      await navigate();
    })();
  }

  if (!open) return <div className="actions top"><button type="button" className="secondary-btn" onClick={() => setOpen(true)}>+ Stock item</button></div>;
  return (
    <form className="card" onSubmit={save} noValidate aria-label="New stock item">
      <div className="body">
        <div className="field-grid">
          <div className="field"><label htmlFor="st-kind">Kind</label><select id="st-kind" value={d.kind} onChange={set('kind')}>{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
          {d.kind === 'medicine' ? (
            <div className="field">
              <label htmlFor="st-med">Medicine</label>
              <select id="st-med" value={d.medicineId} onChange={set('medicineId')}>
                <option value="">Choose from your medicine list…</option>
                {medicines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {err('medicineId')}
              {medicines.length === 0 ? <div className="hint">Add medicines in Settings → Medicines first.</div> : null}
            </div>
          ) : (
            <div className="field"><label htmlFor="st-name">Name</label><input id="st-name" value={d.name} onChange={set('name')} placeholder="Nitrile gloves (M)" autoFocus />{err('name')}</div>
          )}
          <div className="field"><label htmlFor="st-unit">Counted in</label><select id="st-unit" value={d.unit} onChange={set('unit')}>{units.map((u) => <option key={u} value={u}>{unitLabel(u, 2)}</option>)}</select>{err('unit')}</div>
          <div className="field"><label htmlFor="st-reorder">Reorder when down to</label><input id="st-reorder" inputMode="numeric" value={d.reorderLevel} onChange={set('reorderLevel')} placeholder="0" />{err('reorderLevel')}</div>
          <div className="field">
            <label htmlFor="st-sold">Sold to patients as</label>
            <select id="st-sold" value={d.catalogueItemId} onChange={set('catalogueItemId')}>
              <option value="">Not sold (used in the clinic)</option>
              {goods.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {errors.catalogueItemId ? err('catalogueItemId') : <div className="hint">Billing it then takes it off the shelf.</div>}
          </div>
        </div>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add item'}</button>
          <button className="secondary-btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </div>
    </form>
  );
}

/** Received, used or adjust, inline in the stock table. */
export function MovementForm({ itemId, name, unit, isMedicine }: { itemId: string; name: string; unit: string; isMedicine: boolean }) {
  const { busy, send, release, navigate } = useActionForm('stock.movement');
  const [kind, setKind] = useState<'received' | 'used' | 'adjusted' | null>(null);
  const [d, setD] = useState({ quantity: '', direction: 'out' as 'in' | 'out', expiresOn: '', unitCost: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setErrors({});
    setError(null);
    void (async () => {
      const res = await send(() => recordMovementAction(itemId, { kind, ...d }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setKind(null);
      setD({ quantity: '', direction: 'out', expiresOn: '', unitCost: '', reason: '' });
      await navigate();
    })();
  }

  if (!kind) {
    return (
      <span className="row-actions">
        <button type="button" className="linkish small" onClick={() => setKind('received')} aria-label={`Received: ${name}`}>Received</button>
        <button type="button" className="linkish small" onClick={() => setKind('used')} aria-label={`Used: ${name}`}>Used</button>
        <button type="button" className="linkish small" onClick={() => setKind('adjusted')} aria-label={`Adjust: ${name}`}>Adjust</button>
      </span>
    );
  }
  return (
    <form className="item-edit" onSubmit={save} noValidate aria-label={`${kind} ${name}`}>
      {kind === 'adjusted' ? (
        <select aria-label="Up or down" value={d.direction} onChange={(e) => setD({ ...d, direction: e.target.value as 'in' | 'out' })}>
          <option value="out">Fewer than shown</option>
          <option value="in">More than shown</option>
        </select>
      ) : null}
      <label>{kind === 'received' ? 'How many came' : kind === 'used' ? 'How many used' : 'By how many'} <input className="tiny num" inputMode="numeric" value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value.replace(/\D/g, '').slice(0, 5) })} autoFocus /> {unitLabel(unit, 2)}</label>
      {kind === 'received' && isMedicine ? <label>Expires <input type="date" value={d.expiresOn} onChange={(e) => setD({ ...d, expiresOn: e.target.value })} /></label> : null}
      {kind === 'received' ? <label>Cost each ₹ <input className="small-in num" value={d.unitCost} onChange={(e) => setD({ ...d, unitCost: e.target.value })} placeholder="optional" /></label> : null}
      {kind !== 'received' ? <label>Why <input value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} placeholder={kind === 'used' ? 'Extraction trays' : 'Counted 2 short'} /></label> : null}
      {Object.values(errors).map((m) => <div key={m} className="hint err-text" role="alert">{m}</div>)}
      {error ? <div className="hint err-text" role="alert">{error}</div> : null}
      <button type="submit" className="secondary-btn" disabled={busy}>Save</button>
      <button type="button" className="linkish small" onClick={() => setKind(null)}>Cancel</button>
    </form>
  );
}
