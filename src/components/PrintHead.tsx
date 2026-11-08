import Link from 'next/link';
import PrintButton from './PrintButton';

/**
 * The printed header for bills, estimates and prescriptions (LET-174).
 * The logo is a data URL that the server checked is a real PNG or JPEG.
 */
export interface PrintHeadProps {
  name: string;
  addressLines: string[];
  phone: string | null;
  email: string | null;
  gstin: string | null;
  footer: string | null;
  logo: string | null;
}

export default function PrintHead({ name, addressLines, phone, email, gstin, logo }: PrintHeadProps) {
  return (
    <div className="print-head">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small data URL; next/image adds nothing here */}
      {logo ? <img src={logo} alt="" className="print-logo" /> : null}
      <div>
        <div className="print-name">{name}</div>
        {addressLines.map((l) => <div key={l}>{l}</div>)}
        <div>{[phone ? `Phone ${phone}` : null, email].filter(Boolean).join(' · ')}</div>
        {gstin ? <div>GSTIN {gstin}</div> : null}
      </div>
    </div>
  );
}

/** A Print button and the "test, not a tax invoice" note while the CA hasn't signed off. */
export function PrintBar({ title, testNote, back }: { title: string; testNote?: string | null; back?: { href: string; label: string } }) {
  return (
    <div className="print-bar no-print">
      {/* A way back that doesn't depend on the browser's Back button (tablets in full screen; QA 8 Nov). */}
      {back ? <Link className="link" href={back.href}>← {back.label}</Link> : null}
      <span className="muted small">{title}</span>
      <PrintButton />
      {testNote ? <span className="pill credit">{testNote}</span> : null}
    </div>
  );
}

