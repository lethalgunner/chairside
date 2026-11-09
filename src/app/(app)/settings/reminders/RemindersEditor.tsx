'use client';

import { useMemo, useRef, useState } from 'react';
import {
  addRuleAction,
  addSuggestedRemindersAction,
  removeRuleAction,
  removeTemplateAction,
  saveMessageOptionsAction,
  saveTemplateAction,
  setRuleActiveAction,
} from '@/app/actions/messages';
import { LANGUAGE_LABEL, missingFor, renderMessage, TRIGGER_LABEL, TRIGGERS, VARIABLE_HELP, VARIABLES, type Trigger, type Variable } from '@/domain/messages';
import type { MessageSettings, TemplateRow } from '@/services/messages';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

const SAMPLE: Record<Variable, string> = {
  first_name: 'Rahul',
  clinic: 'Your clinic',
  branch: 'Your branch',
  date: 'Thu 12 Nov',
  time: '11:00',
  address: 'FC Road, Pune',
  phone: '020 2567 1234',
  calendar_link: 'https://calendar.google.com/…',
  amount_due: '₹4,500.00',
  upi_id: 'clinic@upi',
  doctor: 'Dr Mehta',
};

type Errors = Record<string, string>;
const fieldErr = (errors: Errors, k: string, prefix: string) => (errors[k] ? <div className="hint err-text" id={`${prefix}-${k}-err`}>{errors[k]}</div> : null);
const ariaFor = (errors: Errors, k: string, prefix: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${prefix}-${k}-err` : undefined, className: errors[k] ? 'err' : undefined });

export default function RemindersEditor({ settings, branches }: { settings: MessageSettings; branches: { id: string; name: string }[] }) {
  return (
    <>
      <RulesCard settings={settings} branches={branches} />
      <TemplatesCard templates={settings.templates} doctorAllowed={settings.doctorName} />
      <OptionsCard settings={settings} />
    </>
  );
}

function RulesCard({ settings, branches }: { settings: MessageSettings; branches: { id: string; name: string }[] }) {
  const { busy, notSent, send, release, navigate } = useActionForm('messages.rules');
  const [error, setError] = useState<string | null>(null);

  function act(call: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    void (async () => {
      const res = await send(call);
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      await navigate();
    })();
  }

  return (
    <section className="card" aria-labelledby="rules-h">
      <header><h2 id="rules-h">Reminders</h2></header>
      <div className="body">
        {settings.rules.length === 0 ? (
          <div className="callout" role="note">
            <strong>No reminders yet.</strong> Start with a suggested set (booking confirmation, 1 day and 2 hours before, a missed-appointment note, come-back due, and money owed every 7 days up to 3 times), then change anything.
            <div className="actions">
              <button type="button" className="primary" disabled={busy} onClick={() => act(() => addSuggestedRemindersAction())}>{busy ? 'Adding…' : 'Add suggested reminders'}</button>
            </div>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="stack-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Wording</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {settings.rules.map((r) => (
                  <tr key={r.id} className={r.active ? undefined : 'muted'}>
                    <td data-label="When"><span className="strong">{r.timing}</span></td>
                    <td data-label="Wording">{r.templateName}</td>
                    <td data-label="Branch">{r.branchName}</td>
                    <td data-label="Status">{r.active ? <span className="pill paid">On</span> : <span className="pill">Paused</span>}</td>
                    <td data-label="Actions" className="row-actions">
                      <button type="button" className="linkish small" disabled={busy} aria-label={`${r.active ? 'Pause' : 'Turn on'}: ${r.timing}`} onClick={() => act(() => setRuleActiveAction(r.id, !r.active))}>{r.active ? 'Pause' : 'Turn on'}</button>{' '}
                      <button type="button" className="linkish small" disabled={busy} aria-label={`Remove: ${r.timing}`} onClick={() => act(() => removeRuleAction(r.id))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        {settings.templates.length > 0 ? <AddRuleForm templates={settings.templates} branches={branches} /> : null}
      </div>
    </section>
  );
}

function AddRuleForm({ templates, branches }: { templates: TemplateRow[]; branches: { id: string; name: string }[] }) {
  const { busy, notSent, send, release, navigate } = useActionForm('messages.rule_add');
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<Trigger>('before_appointment');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState('hours');
  const [everyDays, setEveryDays] = useState('7');
  const [maxTimes, setMaxTimes] = useState('3');
  const [templateId, setTemplateId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const fits = templates.filter((t) => missingFor(trigger, t.body).length === 0);
  const e = (k: string) => fieldErr(errors, k, 'nr');
  const a = (k: string) => ariaFor(errors, k, 'nr');

  if (!open) {
    return (
      <div className="actions">
        <button type="button" className="secondary-btn" onClick={() => setOpen(true)}>+ Add a reminder</button>
      </div>
    );
  }

  function save(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => addRuleAction({ trigger, amount, unit, everyDays, maxTimes, templateId, branchId }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setErrors({});
      setOpen(false);
      await navigate();
    })();
  }

  const timed = trigger === 'before_appointment' || trigger === 'no_show' || trigger === 'after_visit' || trigger === 'recall_due';
  const daysOnly = trigger === 'after_visit' || trigger === 'recall_due';
  return (
    <form className="subcard" onSubmit={save} noValidate aria-label="New reminder">
      <h3>New reminder</h3>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="nr-trigger">When</label>
          <select id="nr-trigger" value={trigger} onChange={(x) => { const t = x.target.value as Trigger; setTrigger(t); if (t === 'after_visit' || t === 'recall_due') setUnit('days'); setTemplateId(''); }} {...a('trigger')}>
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>
            ))}
          </select>
          {e('trigger')}
        </div>
        {timed ? (
          <div className="field">
            <label htmlFor="nr-amount">{trigger === 'before_appointment' ? 'How long before' : trigger === 'recall_due' ? 'Days before it’s due (0 = on the day)' : 'How long after'}</label>
            <div className="input-suffix">
              <input id="nr-amount" inputMode="numeric" value={amount} maxLength={4} onChange={(x) => setAmount(x.target.value)} {...a('amount')} />
              <select aria-label="Unit" value={unit} onChange={(x) => setUnit(x.target.value)} {...a('unit')}>
                {daysOnly ? null : <option value="minutes">minutes</option>}
                {daysOnly ? null : <option value="hours">hours</option>}
                <option value="days">days</option>
              </select>
            </div>
            {e('amount')}
            {e('unit')}
          </div>
        ) : null}
        {trigger === 'dues' ? (
          <>
            <div className="field">
              <label htmlFor="nr-every">Every (days)</label>
              <input id="nr-every" inputMode="numeric" value={everyDays} maxLength={3} onChange={(x) => setEveryDays(x.target.value)} {...a('everyDays')} />
              {e('everyDays')}
            </div>
            <div className="field">
              <label htmlFor="nr-max">At most (times)</label>
              <input id="nr-max" inputMode="numeric" value={maxTimes} maxLength={2} onChange={(x) => setMaxTimes(x.target.value)} {...a('maxTimes')} />
              {e('maxTimes')}
            </div>
          </>
        ) : null}
        <div className="field">
          <label htmlFor="nr-template">Wording</label>
          <select id="nr-template" value={templateId} onChange={(x) => setTemplateId(x.target.value)} {...a('templateId')}>
            <option value="">Choose…</option>
            {fits.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {errors.templateId ? e('templateId') : fits.length < templates.length ? <div className="hint">Wording that uses details this reminder can’t fill (like {'{amount_due}'}) isn’t listed.</div> : null}
        </div>
        <div className="field">
          <label htmlFor="nr-branch">Branch</label>
          <select id="nr-branch" value={branchId} onChange={(x) => setBranchId(x.target.value)}>
            <option value="">Every branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <NotSent message={notSent} />
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add reminder'}</button>
        <button className="secondary-btn" type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function TemplatesCard({ templates, doctorAllowed }: { templates: TemplateRow[]; doctorAllowed: boolean }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const { busy, send, release, navigate } = useActionForm('messages.template_remove');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="tpl-h">
      <header><h2 id="tpl-h">Wording</h2></header>
      <div className="body">
        <p className="muted small">Write it the way your clinic talks. Details in braces, like {'{first_name}'}, are filled in for each patient. A line is left out when its detail is missing (for example, no phone number set). Treatments and reasons are never included.</p>
        {templates.length === 0 ? <p className="muted small">No wording yet.</p> : null}
        <ul className="plain tpl-list">
          {templates.map((t) =>
            editing === t.id ? (
              <li key={t.id}><TemplateForm template={t} doctorAllowed={doctorAllowed} onDone={() => setEditing(null)} /></li>
            ) : (
              <li key={t.id}>
                <div className="tpl-head">
                  <span className="strong">{t.name}</span> <span className="muted small">{LANGUAGE_LABEL[t.language]}{t.inUse ? ` · used by ${t.inUse} reminder${t.inUse === 1 ? '' : 's'}` : ' · not used'}</span>
                  <span className="row-actions">
                    <button type="button" className="linkish small" aria-label={`Edit wording: ${t.name}`} onClick={() => setEditing(t.id)}>Edit</button>
                    {t.inUse === 0 ? (
                      <button
                        type="button"
                        className="linkish small"
                        disabled={busy}
                        aria-label={`Remove wording: ${t.name}`}
                        onClick={() =>
                          void (async () => {
                            setError(null);
                            const res = await send(() => removeTemplateAction(t.id));
                            if (!res) return;
                            if (!res.ok) {
                              release();
                              return setError(res.error);
                            }
                            await navigate();
                          })()
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </span>
                </div>
                <pre className="tpl-body">{t.body}</pre>
              </li>
            ),
          )}
        </ul>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        {editing === 'new' ? (
          <TemplateForm template={null} doctorAllowed={doctorAllowed} onDone={() => setEditing(null)} />
        ) : (
          <div className="actions">
            <button type="button" className="secondary-btn" onClick={() => setEditing('new')}>+ New wording</button>
          </div>
        )}
      </div>
    </section>
  );
}

function TemplateForm({ template, doctorAllowed, onDone }: { template: TemplateRow | null; doctorAllowed: boolean; onDone: () => void }) {
  const { busy, notSent, send, release, navigate } = useActionForm('messages.template');
  const [name, setName] = useState(template?.name ?? '');
  const [language, setLanguage] = useState<string>(template?.language ?? 'en');
  const [body, setBody] = useState(template?.body ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const prefix = template ? `tp-${template.id.slice(0, 8)}` : 'tp-new';
  const preview = useMemo(() => renderMessage(body, SAMPLE), [body]);
  const vars = VARIABLES.filter((v) => v !== 'doctor' || doctorAllowed);

  function insert(v: Variable) {
    const el = box.current;
    const token = `{${v}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function save(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    void (async () => {
      const res = await send(() => saveTemplateAction(template?.id ?? null, { name, language, body }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      onDone();
      await navigate();
    })();
  }

  return (
    <form className="subcard" onSubmit={save} noValidate aria-label={template ? `Edit wording: ${template.name}` : 'New wording'}>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={`${prefix}-name`}>Name</label>
          <input id={`${prefix}-name`} value={name} maxLength={60} onChange={(x) => setName(x.target.value)} autoComplete="off" {...ariaFor(errors, 'name', prefix)} />
          {fieldErr(errors, 'name', prefix)}
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-lang`}>Language</label>
          <select id={`${prefix}-lang`} value={language} onChange={(x) => setLanguage(x.target.value)} {...ariaFor(errors, 'language', prefix)}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
          {fieldErr(errors, 'language', prefix)}
        </div>
        <div className="field span2">
          <label htmlFor={`${prefix}-body`}>Message</label>
          <textarea id={`${prefix}-body`} ref={box} rows={6} value={body} maxLength={1000} onChange={(x) => setBody(x.target.value)} {...ariaFor(errors, 'body', prefix)} />
          {fieldErr(errors, 'body', prefix)}
          <div className="chips var-chips" role="group" aria-label="Insert a detail">
            {vars.map((v) => (
              <button key={v} type="button" className="chip" title={VARIABLE_HELP[v]} onClick={() => insert(v)}>{`{${v}}`}</button>
            ))}
          </div>
        </div>
        <div className="field span2">
          <div className="lbl">Preview <span className="muted small">(sample details)</span></div>
          <pre className="tpl-body preview" aria-live="polite">{preview || ' '}</pre>
        </div>
      </div>
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <NotSent message={notSent} />
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save wording'}</button>
        <button className="secondary-btn" type="button" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function OptionsCard({ settings }: { settings: MessageSettings }) {
  const { busy, notSent, send, release, navigate } = useActionForm('messages.options');
  const [quietStart, setQuietStart] = useState(settings.quiet.start);
  const [quietEnd, setQuietEnd] = useState(settings.quiet.end);
  const [doctorName, setDoctorName] = useState(settings.doctorName);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setSaved(false);
    void (async () => {
      const res = await send(() => saveMessageOptionsAction({ quietStart, quietEnd, doctorName }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setErrors({});
      setSaved(true);
      await navigate();
    })();
  }

  return (
    <form className="card" onSubmit={save} noValidate aria-label="Quiet hours and details">
      <header><h2>Quiet hours and details</h2></header>
      <div className="body">
        <p className="muted small">No reminder is due in quiet hours: one that would be waits until they end (or, before an early appointment, goes the evening before). Every patient can reply STOP; mark it on their page and they get no more reminders.</p>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="mo-start">Quiet from</label>
            <input id="mo-start" type="time" step={900} value={quietStart} onChange={(x) => setQuietStart(x.target.value)} {...ariaFor(errors, 'quietStart', 'mo')} />
            {fieldErr(errors, 'quietStart', 'mo')}
          </div>
          <div className="field">
            <label htmlFor="mo-end">Until</label>
            <input id="mo-end" type="time" step={900} value={quietEnd} onChange={(x) => setQuietEnd(x.target.value)} {...ariaFor(errors, 'quietEnd', 'mo')} />
            {fieldErr(errors, 'quietEnd', 'mo')}
          </div>
          <div className="field span2">
            <label className="ack">
              <input type="checkbox" checked={doctorName} onChange={(x) => setDoctorName(x.target.checked)} aria-describedby={errors.doctorName ? 'mo-doctorName-err' : undefined} />{' '}
              Allow the doctor’s name in appointment messages ({'{doctor}'})
            </label>
            {fieldErr(errors, 'doctorName', 'mo')}
          </div>
        </div>
        {saved ? <div className="callout good" role="status">Saved.</div> : null}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form>
  );
}
