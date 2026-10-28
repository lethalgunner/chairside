import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { canDo } from '@/services/context';
import { REFERRAL_SOURCES } from '@/services/patients';
import { PageHead } from '@/components/ui';
import NewPatientForm from './NewPatientForm';

export default async function NewPatientPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const { q = '' } = await searchParams;
  if (ctx.activeBranchId === 'all' || !canDo(ctx, 'patient.register', ctx.activeBranchId)) {
    return (
      <>
        <PageHead title="New patient" />
        <div className="callout warn">Pick a branch in the branch menu first. A patient is registered at the branch they walk into.</div>
        <Link className="secondary" href="/patients">
          Back to patients
        </Link>
      </>
    );
  }
  const digits = q.replace(/\D/g, '');
  return (
    <>
      <PageHead title="New patient" sub="Name, mobile, sex and age. Everything else can wait." />
      <NewPatientForm referralSources={[...REFERRAL_SOURCES]} initialPhone={digits.length >= 6 ? q : ''} initialName={digits.length >= 6 ? '' : q} />
    </>
  );
}
