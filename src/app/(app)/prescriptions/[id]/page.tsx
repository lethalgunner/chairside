import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { frequencyWords } from '@/domain/rx';
import { getPrintHeader } from '@/services/branches';
import { getPrescription, prescriberAt } from '@/services/rx';
import PrintHead, { PrintBar } from '@/components/PrintHead';

/** A signed prescription, ready to print or save as PDF (LET-173/174). Opening it is audited. */
export default async function PrescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const rx = await getPrescription(ctx, id);
  if (!rx) notFound();
  const head = await getPrintHeader(ctx, rx.branchId);
  const canCorrect = rx.status === 'signed' && ctx.activeBranchId === rx.branchId && !!(await prescriberAt(ctx, rx.branchId));
  return (
    <>
      <div className="no-print print-bar">
        <Link className="link" href={`/patients/${rx.patientId}`}>← {rx.patientName}</Link>
        {canCorrect ? <Link className="link" href={`/prescriptions/new?patient=${rx.patientId}&from=${rx.id}`}>Correct (new prescription)</Link> : null}
        {rx.status === 'replaced' && rx.replacedById ? <Link className="pill credit" href={`/prescriptions/${rx.replacedById}`}>Replaced: see the correction</Link> : null}
      </div>
      <PrintBar title={`Prescription ${rx.ref}`} />
      <article className="print-doc">
        <PrintHead {...head} />
        {rx.status === 'replaced' ? <div className="test-mark">REPLACED BY A CORRECTED PRESCRIPTION</div> : null}
        <div className="meta">
          <div>
            <strong>{rx.patientName}</strong>
            <div>{[rx.patientAge !== null ? `${rx.patientAge} yrs` : null, rx.patientSex === 'F' ? 'Female' : rx.patientSex === 'M' ? 'Male' : null].filter(Boolean).join(', ')}</div>
          </div>
          <div>
            <div>{rx.ref}</div>
            <div>Date {displayDate(rx.issuedOn)}</div>
          </div>
        </div>
        {rx.allergies ? <p><strong>Allergies:</strong> {rx.allergies}</p> : null}
        {rx.complaint ? <p><strong>Complaint / diagnosis:</strong> {rx.complaint}</p> : null}
        <h1>℞</h1>
        <ol>
          {rx.lines.map((l, i) => (
            <li key={i} className="rx-line">
              <strong>{l.name}{l.strength ? ` ${l.strength}` : ''}</strong>
              <div>{[l.dose, frequencyWords(l.frequency), l.days ? `for ${l.days} day${l.days > 1 ? 's' : ''}` : null, l.instructions].filter(Boolean).join(' · ')}</div>
            </li>
          ))}
        </ol>
        {rx.advice ? <p style={{ whiteSpace: 'pre-line' }}><strong>Advice:</strong> {rx.advice}</p> : null}
        <div className="sign">
          <div><strong>{rx.doctorName}</strong>{rx.doctorQualification ? `, ${rx.doctorQualification}` : ''}</div>
          {rx.doctorRegistration ? <div>Reg. no. {rx.doctorRegistration}{rx.doctorCouncil ? `, ${rx.doctorCouncil}` : ''}</div> : null}
          <div className="muted small">Signed in Chairside</div>
        </div>
        {head.footer ? <div className="print-foot">{head.footer}</div> : null}
      </article>
    </>
  );
}
