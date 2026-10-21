'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { issueBillAction } from '@/app/actions/money';
import { formatINR, parseRupeesInput, add, multiply, ZERO, type Paise } from '@/domain/money';
import { parseQuantity as parseQty } from '@/domain/input';
import { computeInvoice, type LineInput } from '@/domain/tax';
import type { CatalogueEntry, DoctorOption } from '@/services/catalogue';
import { TaxPill } from '@/components/ui';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

interface Line {
  key: string;
  catalogueItemId?: string;
  procedureId?: string;
  name: string;
  unitPricePaise: Paise;
  /** Raw text while typing (Q11); checked on blur and before issuing. */
  qty: string;
  discount: string;
  discountReason: string;
  tooth: string;
  taxCategory: CatalogueEntry['taxCategory'];
  hsnSacCode: string;
  gstRateBp: number;
}

interface Props {
  patient: { id: string; name: string };
  branch: { name: string; gstRegistered: boolean; gstin: string | null; state: string | null };
  catalogue: CatalogueEntry[];
  doctors: DoctorOption[];
  unbilled: { procedureId: string; name: string; doctorName: string; valuePaise: Paise }[];
}

function parseDiscount(s: string): Paise | null {
  if (!s.trim()) return ZERO;
  const r = parseRupeesInput(s);
  return r.ok ? r.paise : null;
}


/**
 * Keyboard-first bill entry: type to filter the price list, Enter to add.
 * Totals are computed live by the same domain function the server uses, so
 * the preview and the issued bill cannot disagree.
 */
export default function BillBuilder({ patient, branch, catalogue, doctors, unbilled }: Props) {
  const { busy: pending, notSent, send, release, navigate } = useActionForm('bill.issue');
  const idem = useRef<string>(crypto.randomUUID());
  const [doctorId, setDoctorId] = useState(doctors.length === 1 ? doctors[0]!.id : '');
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: string; invoiceId: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return catalogue.slice(0, 8);
    return catalogue.filter((c) => c.name.toLowerCase().includes(f) || c.code.toLowerCase().includes(f) || (c.category ?? '').toLowerCase().includes(f)).slice(0, 8);
  }, [filter, catalogue]);

  function addItem(c: CatalogueEntry) {
    setLines((ls) => [...ls, { key: crypto.randomUUID(), catalogueItemId: c.id, name: c.name, unitPricePaise: c.pricePaise, qty: '1', discount: '', discountReason: '', tooth: '', taxCategory: c.taxCategory, hsnSacCode: c.hsnSacCode, gstRateBp: c.gstRateBp }]);
    setFilter('');
    setConfirming(false);
  }

  function addUnbilled(u: Props['unbilled'][number]) {
    const item = catalogue.find((c) => c.name === u.name);
    setLines((ls) => [
      ...ls,
      { key: u.procedureId, procedureId: u.procedureId, name: u.name, unitPricePaise: u.valuePaise, qty: '1', discount: '', discountReason: '', tooth: '', taxCategory: item?.taxCategory ?? 'exempt_healthcare', hsnSacCode: item?.hsnSacCode ?? '9993', gstRateBp: item?.gstRateBp ?? 0 },
    ]);
    setConfirming(false);
  }

  const update = (key: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setConfirming(false);
  };

  const { computed, problem } = useMemo(() => {
    if (lines.length === 0) return { computed: null, problem: null };
    const inputs: LineInput[] = [];
    for (const l of lines) {
      const q = parseQty(l.qty);
      if (q === null) return { computed: null, problem: `Quantity for “${l.name}” must be a whole number from 1 to 99.` };
      const d = parseDiscount(l.discount);
      if (d === null) return { computed: null, problem: `Discount on “${l.name}”: enter rupees, like 500 or 1,500.` };
      const gross = multiply(l.unitPricePaise, q);
      if (d > gross) return { computed: null, problem: `Discount on ${l.name} is more than its price (${formatINR(gross, { paise: gross % 100 !== 0 })}).` };
      if (d > 0 && l.discountReason.trim().length < 3) return { computed: null, problem: `Give a reason for the discount on “${l.name}”.` };
      inputs.push({ description: l.name, quantity: q, unitPricePaise: l.unitPricePaise, discountPaise: d, taxCategory: l.taxCategory, hsnSacCode: l.hsnSacCode, gstRateBp: l.gstRateBp });
    }
    try {
      return { computed: computeInvoice(inputs, { gstRegistered: branch.gstRegistered, gstin: branch.gstin, placeOfSupplyState: branch.state }, branch.state), problem: null };
    } catch (e) {
      return { computed: null, problem: (e as Error).message };
    }
  }, [lines, branch]);

  function submit(mode: 'issue' | 'unbilled') {
    setError(null);
    if (!doctorId) return setError('Pick the doctor who did the work.');
    if (mode === 'issue' && !confirming) return setConfirming(true);
    void (async () => {
      const res = await send(() => issueBillAction({
        patientId: patient.id,
        doctorId,
        idempotencyKey: idem.current,
        mode,
        lines: lines.map((l) => ({
          catalogueItemId: l.catalogueItemId,
          procedureId: l.procedureId,
          quantity: parseQty(l.qty) ?? 1,
          discountPaise: parseDiscount(l.discount) ?? 0,
          discountReason: l.discountReason.trim() || undefined,
          toothNumber: l.tooth.trim() || undefined,
        })),
      }));
      if (!res) return;
      if (!res.ok) {
        setConfirming(false);
        release();
        return setError(res.error);
      }
      if (res.data.kind === 'issued') {
        setDone({ number: res.data.number, invoiceId: res.data.invoiceId });
        return release();
      }
      return navigate(`/patients/${patient.id}`);
    })();
  }

  if (done) {
    return (
      <div className="card">
        <div className="body">
          <div className="callout good" role="status">
            Bill <strong className="mono">{done.number}</strong> issued to {patient.name} at {branch.name}.
          </div>
          <div className="actions">
            <Link className="primary-link" href={`/receipts/new?patient=${patient.id}`}>Record payment</Link>
            <Link className="secondary" href={`/invoices/${done.invoiceId}`}>View bill</Link>
            <Link className="secondary" href={`/patients/${patient.id}`}>Back to patient</Link>
          </div>
        </div>
      </div>
    );
  }

  const total = computed?.totalPaise ?? ZERO;
  const tax = computed ? add(computed.cgstPaise, computed.sgstPaise, computed.igstPaise) : ZERO;

  return (
    <div className="bill-grid">
      <div className="card">
        <div className="body">
          <div className="field">
            <label htmlFor="doctor">Doctor</label>
            <select id="doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Choose…</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.fullName}</option>
              ))}
            </select>
          </div>

          {unbilled.length > 0 ? (
            <div className="callout">
              <strong>Already recorded, not yet billed:</strong>
              <ul className="dupes">
                {unbilled.filter((u) => !lines.some((l) => l.procedureId === u.procedureId)).map((u) => (
                  <li key={u.procedureId}>
                    {u.name} · {u.doctorName} · {formatINR(u.valuePaise)}{' '}
                    <button type="button" className="linkish" onClick={() => addUnbilled(u)}>Add to this bill</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="item-filter">Add treatment or item</label>
            <input
              id="item-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (matches[0]) addItem(matches[0]);
                }
              }}
              placeholder="Type to search, Enter adds the first match"
              autoComplete="off"
              autoFocus
            />
            <ul className="pick-list" aria-label="Matching items">
              {matches.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => addItem(c)}>
                    <span>{c.name}</span>
                    <span className="muted small">{formatINR(c.pricePaise)} · <TaxPill rateBp={branch.gstRegistered ? c.gstRateBp : 0} code={c.hsnSacCode} /></span>
                  </button>
                </li>
              ))}
              {matches.length === 0 ? <li className="muted small">Nothing matches “{filter}”.</li> : null}
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <header>
          <h2>Bill</h2>
          <span className="note">{branch.gstRegistered ? 'GST applies to taxable items' : 'Branch not GST-registered: no GST charged'}</span>
        </header>
        <div className="body flush">
          {lines.length === 0 ? (
            <div className="empty"><p>Add what was done today from the list on the left.</p></div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Tooth</th>
                    <th scope="col" className="num">Qty</th>
                    <th scope="col" className="num">Price</th>
                    <th scope="col">Discount (₹) and reason</th>
                    <th scope="col" className="num">Line total</th>
                    <th scope="col"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const cl = computed?.lines[i];
                    return (
                      <tr key={l.key}>
                        <td className="strong">
                          {l.name}
                          <br />
                          <TaxPill rateBp={cl?.gstRateBp ?? (branch.gstRegistered ? l.gstRateBp : 0)} code={l.hsnSacCode} />
                        </td>
                        <td>
                          <input aria-label={`Tooth for ${l.name}`} className="tiny" value={l.tooth} disabled={!!l.procedureId} onChange={(e) => update(l.key, { tooth: e.target.value.replace(/[^\d,\s]/g, '').slice(0, 10) })} placeholder="e.g. 26" />
                        </td>
                        <td className="num">
                          <div className="qty">
                            <button type="button" className="icon-btn" aria-label={`One less ${l.name}`} disabled={!!l.procedureId || (parseQty(l.qty) ?? 1) <= 1} onClick={() => update(l.key, { qty: String(Math.max(1, (parseQty(l.qty) ?? 1) - 1)) })}>−</button>
                            <input aria-label={`Quantity for ${l.name}`} className="tiny num" inputMode="numeric" value={l.qty} disabled={!!l.procedureId} aria-invalid={parseQty(l.qty) === null} onChange={(e) => update(l.key, { qty: e.target.value.replace(/\D/g, '').slice(0, 2) })} onBlur={() => { if (l.qty.trim() === '') update(l.key, { qty: '1' }); }} />
                            <button type="button" className="icon-btn" aria-label={`One more ${l.name}`} disabled={!!l.procedureId || (parseQty(l.qty) ?? 0) >= 99} onClick={() => update(l.key, { qty: String(Math.min(99, (parseQty(l.qty) ?? 0) + 1)) })}>+</button>
                          </div>
                        </td>
                        <td className="num">{formatINR(l.unitPricePaise)}</td>
                        <td>
                          <input aria-label={`Discount for ${l.name}`} className="small-in num" inputMode="decimal" value={l.discount} onChange={(e) => update(l.key, { discount: e.target.value })} placeholder="0" />
                          {parseDiscount(l.discount) ? (
                            <input aria-label={`Reason for discount on ${l.name}`} className="small-in" value={l.discountReason} onChange={(e) => update(l.key, { discountReason: e.target.value })} placeholder="Reason" />
                          ) : null}
                        </td>
                        <td className="num strong">{cl ? formatINR(cl.lineTotalPaise) : '—'}</td>
                        <td>
                          <button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} title="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {computed ? (
            <dl className="kv totals">
              <dt>Treatment (exempt)</dt>
              <dd>{formatINR(computed.exemptPaise)}</dd>
              <dt>Taxable items</dt>
              <dd>{formatINR(computed.taxablePaise)}</dd>
              <dt>GST (CGST + SGST)</dt>
              <dd>{formatINR(tax)}</dd>
              {computed.roundingPaise !== 0 ? (
                <>
                  <dt>Rounding</dt>
                  <dd>{formatINR(computed.roundingPaise)}</dd>
                </>
              ) : null}
              <dt className="strong">Total</dt>
              <dd className="strong big">{formatINR(total)}</dd>
            </dl>
          ) : null}
          <div className="body">
            {problem ? <div className="callout warn" role="alert">{problem}</div> : null}
            {error ? <div className="callout warn" role="alert">{error}</div> : null}
            <NotSent message={notSent} />
            {confirming && computed ? (
              <div className="callout confirm" role="alert">
                Issue a bill of <strong>{formatINR(total)}</strong> to <strong>{patient.name}</strong> from <strong>{branch.name}</strong>? It gets a number and can only be cancelled, not edited.
              </div>
            ) : null}
            <div className="actions">
              <button className="primary" type="button" disabled={pending || !computed || !!problem} onClick={() => submit('issue')}>
                {pending ? 'Issuing…' : confirming ? 'Yes, issue bill' : 'Issue bill'}
              </button>
              <button className="secondary-btn" type="button" disabled={pending || lines.length === 0 || lines.some((l) => l.procedureId)} onClick={() => submit('unbilled')}>
                Save as done, bill later
              </button>
              <Link className="secondary" href={`/patients/${patient.id}`}>Cancel</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
