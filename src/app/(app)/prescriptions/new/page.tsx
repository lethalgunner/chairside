import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { getPatient } from '@/services/patients';
import { getPrescription, listMedicines, listTemplates, patientAllergies, prescriberAt, suggestedTemplateIds } from '@/services/rx';
import { PageHead } from '@/components/ui';
import RxForm from './RxForm';

/** Write (or correct) a prescription (Sprint 5, LET-173). Doctors with a profile at this branch only. */
export default async function NewPrescriptionPage({ searchParams }: { searchParams: Promise<{ patient?: string; from?: string }> }) {
  const ctx = await requireContext();
  const { patient: patientId = '', from = '' } = await searchParams;
  const patient = await getPatient(ctx, patientId);
  if (!patient) notFound();
  const branch = ctx.activeBranchId === 'all' ? null : ctx.activeBranchId;
  const doctor = branch ? await prescriberAt(ctx, branch) : null;
  if (!branch || !doctor) {
    return (
      <>
        <PageHead title="Write prescription" />
        <div className="callout warn">
          {!branch ? 'Pick your branch in the branch menu first.' : 'Only a doctor can sign a prescription, and they need a doctor profile at this branch (the owner sets it in Settings → Doctors).'}
        </div>
        <Link className="secondary" href={`/patients/${patient.id}`}>Back to {patient.fullName}</Link>
      </>
    );
  }
  const [meds, templates, suggested, allergies, prev] = await Promise.all([
    listMedicines(ctx, { activeOnly: true }),
    listTemplates(ctx, { activeOnly: true }),
    suggestedTemplateIds(ctx, patient.id, branch),
    patientAllergies(ctx, patient.id),
    from ? getPrescription(ctx, from) : Promise.resolve(null),
  ]);
  const correcting = prev && prev.patientId === patient.id && prev.status === 'signed' ? prev : null;
  return (
    <>
      <PageHead
        eyebrow={patient.fileNumbers.join(' · ')}
        title={correcting ? `Correct ${correcting.ref}` : `Prescription for ${patient.fullName}`}
        sub={[patient.age !== null ? `${patient.age} yrs` : null, patient.sex === 'F' ? 'Female' : patient.sex === 'M' ? 'Male' : null, `Signed by ${doctor.fullName}${doctor.registrationNumber ? ` (Reg. ${doctor.registrationNumber})` : ''}`].filter(Boolean).join(' · ')}
      />
      {!doctor.registrationNumber ? <div className="callout warn">Your registration number isn’t set, so it won’t print. The owner adds it in Settings → Doctors.</div> : null}
      <RxForm
        patientId={patient.id}
        replacesId={correcting?.id ?? null}
        allergies={allergies ?? ''}
        medicines={meds}
        templates={templates}
        suggested={suggested}
        initial={correcting ? { complaint: correcting.complaint ?? '', advice: correcting.advice ?? '', lines: correcting.lines } : null}
      />
    </>
  );
}
