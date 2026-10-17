import Link from 'next/link';
import { formatINR, type Paise } from '@/domain/money';
import type { TaxCategory } from '@/domain/tax';

export function Money({ v, whole = false }: { v: Paise; whole?: boolean }) {
  return <span className="num">{formatINR(v, { paise: !whole })}</span>;
}

export function PageHead({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {right ? <div className="page-actions">{right}</div> : null}
    </div>
  );
}

export function Card({ title, note, flush, children, action }: { title: string; note?: string; flush?: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <header>
        <h2>{title}</h2>
        {action ?? (note ? <span className="note">{note}</span> : null)}
      </header>
      <div className={flush ? 'body flush' : 'body'}>{children}</div>
    </section>
  );
}

/** Shown wherever a list has nothing in it, with the next useful action. */
export function Empty({ children, action }: { children: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action ? (
        <Link className="primary-link" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

const RATE_CLASS: Record<number, string> = { 0: 'exempt', 500: 'tax5', 1200: 'tax12', 1800: 'tax18' };

export function TaxPill({ rateBp, code }: { rateBp: number; code: string }) {
  const cls = RATE_CLASS[rateBp] ?? 'tax18';
  const label = rateBp === 0 ? `Exempt · ${code}` : `${rateBp / 100}% · ${code}`;
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function CategoryLabel({ c }: { c: TaxCategory }) {
  const map: Record<TaxCategory, string> = {
    exempt_healthcare: 'Healthcare service',
    goods_prosthetic: 'Prosthetic / implant',
    goods_retail: 'Retail product',
    cosmetic_service: 'Cosmetic',
    other_taxable: 'Other',
  };
  return <span className="muted small">{map[c]}</span>;
}

export function Tile({ k, l, foot, tone }: { k: string; l: string; foot?: string; tone?: 'alert' | 'good' }) {
  return (
    <div className={`tile${tone ? ` ${tone}` : ''}`}>
      <div className="k">{k}</div>
      <div className="l">{l}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    open: ['due', 'Open'],
    reopened: ['due', 'Reopened'],
    reconciling: ['due', 'Reconciling'],
    closed: ['paid', 'Closed'],
    issued: ['paid', 'Issued'],
    void: ['credit', 'Cancelled'],
  };
  const [cls, label] = map[status] ?? ['', status];
  return <span className={`pill ${cls}`}>{label}</span>;
}

export const MODE_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  financing: 'Financing',
};
