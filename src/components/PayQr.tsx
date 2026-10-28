import { formatINR, type Paise } from '@/domain/money';
import { upiPayLink } from '@/domain/upi';
import { amountInWords } from '@/domain/words';
import { qrPath } from '@/lib/qr';

/**
 * Scan-to-pay QR for an exact amount (Sprint 2, T31). Drawn on the server.
 * Renders nothing when the branch has no UPI ID or nothing is due.
 * The QR does not record anything: the desk still records the payment once
 * it shows up in the clinic's UPI app.
 */
export default function PayQr({ upiId, payee, amount, note, title = 'Scan to pay by UPI' }: { upiId: string | null; payee: string | null; amount: Paise; note: string; title?: string }) {
  if (!upiId || !payee) return null;
  const link = upiPayLink({ upiId, payee, amount, note });
  if (!link) return null;
  const { size, d } = qrPath(link);
  const q = 4; // quiet zone, in modules
  return (
    <section className="card pay-qr" aria-label={title}>
      <header>
        <h2>{title}</h2>
      </header>
      <div className="body pay-qr-body">
        <svg
          className="qr"
          viewBox={`${-q} ${-q} ${size + 2 * q} ${size + 2 * q}`}
          width="200"
          height="200"
          role="img"
          aria-label={`UPI QR code: pay ${formatINR(amount)} to ${payee}`}
          shapeRendering="crispEdges"
        >
          <rect x={-q} y={-q} width={size + 2 * q} height={size + 2 * q} fill="#fff" />
          <path d={d} fill="#000" />
        </svg>
        <div className="pay-qr-text">
          <div className="big-amount">{formatINR(amount)}</div>
          <div className="muted small">{amountInWords(amount)}</div>
          <p>
            Pays <strong>{payee}</strong> · <span className="mono">{upiId}</span>
            <br />
            <span className="muted small">Reference {note}</span>
          </p>
          <p className="muted small">Any UPI app can scan this. When the money shows in the clinic’s UPI app, record it here as a UPI payment.</p>
        </div>
      </div>
    </section>
  );
}
