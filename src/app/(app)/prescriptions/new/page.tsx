import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { getPatient } from '@/services/patients';
import { getPrescription, listMedicines, listTemplates, patientAllergies, prescriberAt, suggestedTemplateIds } from '@/services/rx';
import { PageHead } from '@/components/ui';
import AddMeAsDoctor from '@/components/AddMeAsDoctor';
import { canAnywhere } from '@/services/context';
import { listProviders, myProvider } from '@/services/providers';
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
    // Say exactly why, and offer the fix this person can make (QA 9 Nov: an owner saw no way in).
    const owner = canAnywhere(ctx, 'provider.manage');
    const [me, doctorsHere] = branch ? await Promise.all([myProvider(ctx), listProviders(ctx, branch)]) : [null, []];
    const back = `/prescriptions/new?patient=${patient.id}`;
    return (
      <>
        <PageHead title="Write prescription" sub={`For ${patient.fullName}`} />
        {!branch ? (
          <div className="callout warn">Pick your branch in the branch menu first.</div>
        ) : owner && !me ? (
          <div className="callout">
            <strong>Prescriptions are signed by a doctor.</strong> If you also treat patients, add yourself as a doctor and you can write this one now. Fill in your registration number afterwards in Settings → Doctors; it prints on every prescription.
            <AddMeAsDoctor label="Add me as a doctor and continue" then={back} />
          </div>
        ) : owner && me ? (
          <div className="callout warn">
            You&apos;re a doctor here, but not at this branch. Add this branch to your working hours in <Link className="link" href="/settings/doctors">Settings → Doctors</Link>.
          </div>
        ) : (
          <div className="callout warn">
            Prescriptions are signed by a doctor with a profile at this branch
            {doctorsHere.length ? `: ${doctorsHere.map((d) => d.fullName).join(', ')}` : ''}. Ask one of them to sign in, or ask the owner to set you up in Settings → Doctors.
          </div>
        )}
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
