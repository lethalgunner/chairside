import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { listCatalogue } from '@/services/catalogue';
import { canDo } from '@/services/context';
import { getPatient } from '@/services/patients';
import { listProviders, myProvider } from '@/services/providers';
import { PageHead } from '@/components/ui';
import PlanBuilder from '../PlanBuilder';

/** New treatment plan for a patient (Sprint 4, LET-168). */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  const ctx = await requireContext();
  const { patient: patientId = '' } = await searchParams;
  const patient = await getPatient(ctx, patientId);
  if (!patient) notFound();
  const branch = ctx.activeBranchId === 'all' ? null : ctx.activeBranchId;
  if (!branch || !canDo(ctx, 'plan.manage', branch)) {
    return (
      <>
        <PageHead title="New treatment plan" />
        <div className="callout warn">{branch ? 'Treatment plans are made by doctors and managers.' : 'Pick the branch the treatment will be at in the branch menu.'}</div>
        <Link className="secondary" href={`/patients/${patient.id}`}>Back to {patient.fullName}</Link>
      </>
    );
  }
  const [catalogue, doctors, me] = await Promise.all([listCatalogue(ctx, branch), listProviders(ctx, branch), myProvider(ctx)]);
  return (
    <>
      <PageHead eyebrow={patient.fileNumbers.join(' · ')} title={`Treatment plan for ${patient.fullName}`} sub="Saved as a draft. Print the estimate for the patient, then mark work done at each sitting." />
      <PlanBuilder mode="create" patientId={patient.id} catalogue={catalogue} doctors={doctors} defaultDoctorId={me && doctors.some((d) => d.id === me.id) ? me.id : undefined} />
    </>
  );
}
