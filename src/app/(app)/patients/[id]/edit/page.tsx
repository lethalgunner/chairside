import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { formatIndianMobile } from '@/domain/phone';
import { canAnywhere } from '@/services/context';
import { getPatientDetails, REFERRAL_SOURCES } from '@/services/patients';
import { PageHead } from '@/components/ui';
import NewPatientForm from '../../new/NewPatientForm';

/** Fix a typo in a patient's details (Sprint 3, T38). */
export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  if (!canAnywhere(ctx, 'patient.edit')) {
    return (
      <>
        <PageHead title="Edit patient" />
        <div className="callout">Patient details are corrected by the front desk, a branch manager or the owner.</div>
        <Link className="secondary" href={`/patients/${id}`}>Back to the patient</Link>
      </>
    );
  }
  const p = await getPatientDetails(ctx, id);
  if (!p) notFound();
  const sources = REFERRAL_SOURCES.includes(p.referralSource as (typeof REFERRAL_SOURCES)[number]) || !p.referralSource ? [...REFERRAL_SOURCES] : [...REFERRAL_SOURCES, p.referralSource];
  return (
    <>
      <PageHead eyebrow="Edit patient" title={p.fullName} sub="Changes are recorded with your name. Bills keep their numbers." />
      <NewPatientForm
        referralSources={sources}
        initialPhone={formatIndianMobile(p.phone)}
        initialName={p.fullName}
        edit={{ patientId: p.id, sex: p.sex ?? '', age: p.age === null ? '' : String(p.age), referralSource: p.referralSource ?? 'Walk-in', referralDetail: p.referralDetail ?? '' }}
      />
    </>
  );
}
