import { requireContext } from '@/lib/auth';
import { ENGAGEMENT_LABEL, ENGAGEMENT_TYPES, PROVIDER_COLOURS, SLOT_MINUTES } from '@/domain/providers';
import { listBranches } from '@/services/branches';
import { listProvidersForSettings, myProvider } from '@/services/providers';
import AddMeAsDoctor from '@/components/AddMeAsDoctor';
import { settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';
import DoctorsEditor from './DoctorsEditor';

export default async function DoctorsPage() {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).doctors) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Doctors" />
        <Empty>Only the owner can change doctor profiles.</Empty>
      </>
    );
  }
  const [doctors, branches, me] = await Promise.all([listProvidersForSettings(ctx), listBranches(ctx), myProvider(ctx)]);
  return (
    <>
      <PageHead eyebrow="Settings" title="Doctors" sub="Who appears on bills, appointments and prescriptions, and when they work. Doctors with a login are added from Team; visiting doctors can be added here without one." />
      {!me ? (
        <div className="callout" role="note">
          <strong>Do you also treat patients?</strong> Add yourself as a doctor: you'll appear on bills and appointments at every branch and can sign prescriptions once your registration number is filled in below.
          <AddMeAsDoctor />
        </div>
      ) : null}
      <DoctorsEditor
        doctors={doctors}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        engagement={ENGAGEMENT_TYPES.map((e) => ({ value: e, label: ENGAGEMENT_LABEL[e] }))}
        colours={[...PROVIDER_COLOURS]}
        slots={[...SLOT_MINUTES]}
      />
    </>
  );
}
