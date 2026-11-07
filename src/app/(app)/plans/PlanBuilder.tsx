'use client';

import { useMemo, useRef, useState } from 'react';
import { addPlanItemsAction, createPlanAction } from '@/app/actions/plans';
import { formatINR, parseRupeesInput, toRupeeString, type Paise } from '@/domain/money';
import type { CatalogueEntry } from '@/services/catalogue';
import type { ProviderOption } from '@/services/providers';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

interface Row {
  key: string;
  catalogueItemId: string;
  name: string;
  listPricePaise: Paise;
  toothNumber: string;
  quantity: string;
  session: string;
  price: string;
  priceReason: string;
}

interface Props {
  mode: 'create' | 'add';
  patientId: string;
  planId?: string;
  catalogue: CatalogueEntry[];
  doctors: ProviderOption[];
  defaultDoctorId?: string;
  nextSession?: number;
}

/**
 * Build a treatment plan (LET-168): type to find a treatment, set tooth,
 * sitting and agreed price. A price different from the list needs a reason.
 * The server re-checks every line against the price list.
 */
export default function PlanBuilder({ mode, patientId, planId, catalogue, doctors, defaultDoctorId, nextSession = 1 }: Props) {
  const { busy, notSent, send, release, navigate } = useActionForm(mode === 'create' ? 'plan.create' : 'plan.items_added');
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? (doctors.length === 1 ? doctors[0]!.id : ''));
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return catalogue.slice(0, 8);
    return catalogue.filter((c) => c.name.toLowerCase().includes(f) || c.code.toLowerCase().includes(f) || (c.category ?? '').toLowerCase().includes(f)).slice(0, 8);
  }, [filter, catalogue]);

  function add(c: CatalogueEntry) {
    const session = rows.length > 0 ? rows[rows.length - 1]!.session : String(nextSession);
    setRows((rs) => [...rs, { key: crypto.randomUUID(), catalogueItemId: c.id, name: c.name, listPricePaise: c.pricePaise, toothNumber: '', quantity: '1', session, price: toRupeeString(c.pricePaise), priceReason: '' }]);
    setFilter('');
    filterRef.current?.focus();
  }
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const differs = (r: Row) => {
    const p = parseRupeesInput(r.price);
    return p.ok && p.paise !== r.listPricePaise;
  };
  const total = rows.reduce((s, r) => {
    const p = parseRupeesInput(r.price);
    return s + (p.ok ? p.paise : 0) * (Number(r.quantity) || 0);
  }, 0) as Paise;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    setRowErrors({});
    if (rows.length === 0) return setErrors({ items: 'Add at least one treatment.' });
    const items = rows.map((r) => ({ catalogueItemId: r.catalogueItemId, toothNumber: r.toothNumber, quantity: Number(r.quantity) || 0, price: r.price, priceReason: r.priceReason, session: Number(r.session) || 0 }));
    void (async () => {
      const res = await send(() => (mode === 'create' ? createPlanAction({ patientId, providerId: doctorId, title, items }) : addPlanItemsAction(planId!, items)));
      if (!res) return;
      if (!res.ok || !res.data.ok) release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) {
        setErrors(res.data.fieldErrors);
        return setRowErrors(res.data.itemErrors ?? {});
      }
      await navigate(`/plans/${res.data.id}${mode === 'add' ? '?added=1' : ''}`);
    })();
  }

  const err = (k: string) => (errors[k] ? <div className="hint err-text" role="alert">{errors[k]}</div> : null);

  return (
    <form className="card" onSubmit={save} noValidate aria-label={mode === 'create' ? 'New treatment plan' : 'Add to plan'}>
      <div className="body">
        {mode === 'create' ? (
          <div className="field-grid">
            <div className="field">
              <label htmlFor="plan-title">Plan name</label>
              <input id="plan-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lower left RCT and crown" maxLength={80} autoComplete="off" aria-invalid={!!errors.title} />
              {err('title')}
            </div>
            <div className="field">
              <label htmlFor="plan-doctor">Doctor</label>
              <select id="plan-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-invalid={!!errors.providerId}>
                <option value="">Choose…</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.fullName}</option>
                ))}
              </select>
              {err('providerId')}
            </div>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="plan-filter">Add treatment</label>
          <input
            id="plan-filter"
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matches[0]) add(matches[0]);
              }
            }}
            placeholder="Type to search, Enter adds the first match"
            autoComplete="off"
          />
          <ul className="pick-list" aria-label="Matching treatments">
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => add(c)}>
                  <span>{c.name}</span>
                  <span className="muted small">{formatINR(c.pricePaise)}</span>
                </button>
              </li>
            ))}
          </ul>
          {err('items')}
        </div>

        {rows.length > 0 ? (
          <div className="tablewrap">
            <table className="plan-rows">
              <thead>
                <tr>
                  <th scope="col">Treatment</th>
                  <th scope="col">Tooth</th>
                  <th scope="col" className="num">Qty</th>
                  <th scope="col" className="num">Sitting</th>
                  <th scope="col" className="num">Agreed price (₹)</th>
                  <th scope="col"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const re = rowErrors[i] ?? {};
                  return (
                    <tr key={r.key}>
                      <td className="strong">
                        {r.name}
                        {re.catalogueItemId ? <div className="hint err-text">{re.catalogueItemId}</div> : null}
                      </td>
                      <td>
                        <input className="tiny" aria-label={`Tooth for ${r.name}`} value={r.toothNumber} onChange={(e) => update(r.key, { toothNumber: e.target.value.replace(/[^\d,\s]/g, '').slice(0, 20) })} placeholder="36" aria-invalid={!!re.toothNumber} />
                        {re.toothNumber ? <div className="hint err-text">{re.toothNumber}</div> : null}
                      </td>
                      <td className="num">
                        <input className="tiny num" inputMode="numeric" aria-label={`Quantity for ${r.name}`} value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value.replace(/\D/g, '').slice(0, 2) })} aria-invalid={!!re.quantity} />
                      </td>
                      <td className="num">
                        <input className="tiny num" inputMode="numeric" aria-label={`Sitting for ${r.name}`} value={r.session} onChange={(e) => update(r.key, { session: e.target.value.replace(/\D/g, '').slice(0, 2) })} aria-invalid={!!re.session} />
                        {re.session ? <div className="hint err-text">{re.session}</div> : null}
                      </td>
                      <td className="num">
                        <input className="small-in num" inputMode="decimal" aria-label={`Agreed price for ${r.name}`} value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} aria-invalid={!!re.price} />
                        {differs(r) ? <input className="small-in" aria-label={`Why the price differs for ${r.name}`} value={r.priceReason} onChange={(e) => update(r.key, { priceReason: e.target.value })} placeholder={`List ${formatINR(r.listPricePaise)}: why?`} aria-invalid={!!re.priceReason} /> : null}
                        {re.price || re.priceReason ? <div className="hint err-text">{re.price ?? re.priceReason}</div> : null}
                      </td>
                      <td>
                        <button type="button" className="icon-btn" aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Add each treatment the patient needs. Put work for the same visit in the same sitting.</p>
        )}

        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : mode === 'create' ? 'Save plan' : 'Add to plan'}</button>
          {rows.length > 0 ? <span className="muted">{rows.length} item{rows.length > 1 ? 's' : ''} · {formatINR(total)} before GST</span> : null}
        </div>
      </div>
    </form>
  );
}
