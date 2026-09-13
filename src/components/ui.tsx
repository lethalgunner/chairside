import { formatINR, type Paise } from '@/domain/money';
import type { TaxCategory } from '@/domain/tax';

export function Money({ v, bare = false }: { v: Paise; bare?: boolean }) {
  return <span className="num">{formatINR(v, { symbol: !bare })}</span>;
}

export function PageHead({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

export function Card({
  title,
  note,
  flush,
  children,
  action,
}: {
  title: string;
  note?: string;
  flush?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="card">
      <header>
        <h2>{title}</h2>
        {action ?? (note ? <span className="note">{note}</span> : null)}
      </header>
      <div className={flush ? 'body flush' : 'body'}>{children}</div>
    </section>
  );
}

const RATE_CLASS: Record<number, string> = { 0: 'exempt', 1200: 'tax12', 1800: 'tax18' };

/** The visual tell that separates exempt treatment from taxable goods at a glance. */
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
  return <span className="muted" style={{ fontSize: 11.5 }}>{map[c]}</span>;
}

export function Initials({ name }: { name: string }) {
  const i = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return <span className="avatar">{i}</span>;
}

export function Tile({
  k,
  l,
  foot,
  tone,
}: {
  k: string;
  l: string;
  foot?: string;
  tone?: 'alert' | 'good';
}) {
  return (
    <div className={`tile${tone ? ` ${tone}` : ''}`}>
      <div className="k">{k}</div>
      <div className="l">{l}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}
