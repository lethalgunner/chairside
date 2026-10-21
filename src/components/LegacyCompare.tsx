import { formatINR, type Paise } from '@/domain/money';
import type { LegacyComparison } from '@/domain/parallel';

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}
function signedRupees(p: Paise): string {
  return p > 0 ? `+${formatINR(p)}` : p < 0 ? `−${formatINR(Math.abs(p) as Paise)}` : formatINR(p);
}

/** Old system vs Chairside: bills, collected, and a verdict (T21). Works on server and client. */
export default function LegacyCompare({ c, caption = 'Old system vs Chairside' }: { c: LegacyComparison; caption?: string }) {
  const tone = (d: number | null) => (d === null ? 'muted' : d === 0 ? 'variance-ok' : 'variance-bad');
  return (
    <div className="legacy-compare">
      <table className="compact">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Figure</span></th>
            <th scope="col" className="num">Old system</th>
            <th scope="col" className="num">Chairside</th>
            <th scope="col" className="num">Difference</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Bills</th>
            <td className="num">{c.bills.old ?? '—'}</td>
            <td className="num">{c.bills.chairside}</td>
            <td className={`num ${tone(c.bills.diff)}`}>{c.bills.diff === null ? '—' : signed(c.bills.diff)}</td>
          </tr>
          <tr>
            <th scope="row">Collected</th>
            <td className="num">{c.collected.old === null ? '—' : formatINR(c.collected.old)}</td>
            <td className="num">{formatINR(c.collected.chairside)}</td>
            <td className={`num ${tone(c.collected.diff)}`}>{c.collected.diff === null ? '—' : signedRupees(c.collected.diff)}</td>
          </tr>
        </tbody>
      </table>
      <p className={`verdict ${c.matches ? 'variance-ok' : 'variance-bad'}`} aria-live="polite">
        <strong>{c.verdict}</strong>
      </p>
    </div>
  );
}
