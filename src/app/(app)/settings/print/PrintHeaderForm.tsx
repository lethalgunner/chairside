'use client';

import { useState } from 'react';
import { savePrintHeaderAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';
import PrintHead, { type PrintHeadProps } from '@/components/PrintHead';

type Draft = { printName: string; printAddress: string; printEmail: string; printFooter: string; printLogo: string };

/** One branch's printed header, with a live preview (LET-174). */
export default function PrintHeaderForm({ branchId, branchName, initial, preview }: { branchId: string; branchName: string; initial: Draft; preview: PrintHeadProps }) {
  const { busy, notSent, send, release, navigate } = useActionForm('branch.print_header');
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = (k: string) => `${k}-${branchId}`;
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  };
  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`${id(k)}-err`}>{errors[k]}</div> : null);

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setErrors((x) => ({ ...x, printLogo: '' }));
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setErrors((x) => ({ ...x, printLogo: 'Use a PNG or JPG image.' }));
    if (file.size > 200 * 1024) return setErrors((x) => ({ ...x, printLogo: 'Keep the logo under 200 KB.' }));
    const reader = new FileReader();
    reader.onload = () => setDraft((d) => ({ ...d, printLogo: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    void (async () => {
      const res = await send(() => savePrintHeaderAction(branchId, draft));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setSaved(true);
      await navigate();
    })();
  }

  const live: PrintHeadProps = {
    ...preview,
    name: draft.printName.trim() || preview.name,
    addressLines: draft.printAddress.trim() ? draft.printAddress.split('\n').filter((l) => l.trim()) : preview.addressLines,
    email: draft.printEmail.trim() || null,
    footer: draft.printFooter.trim() || null,
    logo: draft.printLogo || null,
  };

  return (
    <form className="card" onSubmit={save} noValidate aria-label={`${branchName} bill header`}>
      <header><h2>{branchName}</h2></header>
      <div className="body">
        <div className="field-grid">
          <div className="field">
            <label htmlFor={id('pname')}>Clinic name as printed</label>
            <input id={id('pname')} value={draft.printName} onChange={set('printName')} placeholder={preview.name} maxLength={80} />
            {err('printName')}
          </div>
          <div className="field">
            <label htmlFor={id('pemail')}>Email</label>
            <input id={id('pemail')} value={draft.printEmail} onChange={set('printEmail')} placeholder="clinic@example.com" type="email" />
            {err('printEmail')}
          </div>
          <div className="field">
            <label htmlFor={id('paddr')}>Address (up to 4 lines)</label>
            <textarea id={id('paddr')} value={draft.printAddress} onChange={set('printAddress')} rows={4} placeholder={preview.addressLines.join('\n')} />
            {err('printAddress')}
          </div>
          <div className="field">
            <label htmlFor={id('pfoot')}>Footer</label>
            <textarea id={id('pfoot')} value={draft.printFooter} onChange={set('printFooter')} rows={3} placeholder="Timings: Mon–Sat 10 am – 7 pm. Thank you!" maxLength={200} />
            {err('printFooter')}
          </div>
          <div className="field">
            <label htmlFor={id('plogo')}>Logo (PNG or JPG, under 200 KB)</label>
            <input id={id('plogo')} type="file" accept="image/png,image/jpeg" onChange={pickLogo} />
            {draft.printLogo ? <button type="button" className="linkish small" onClick={() => setDraft((d) => ({ ...d, printLogo: '' }))}>Remove logo</button> : null}
            {err('printLogo')}
          </div>
        </div>
        <div className="print-preview" aria-label="Preview">
          <div className="muted small">Preview</div>
          <PrintHead {...live} />
          {live.footer ? <div className="print-foot">{live.footer}</div> : null}
        </div>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        {saved ? <div className="callout good" role="status">Saved. New printouts use it.</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save header'}</button>
        </div>
      </div>
    </form>
  );
}
