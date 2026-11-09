import { requireContext } from '@/lib/auth';
import { getClinicSettings } from '@/services/clinic';
import { settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';
import ClinicForm from './ClinicForm';

export default async function ClinicSettingsPage() {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).clinic) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Clinic" />
        <Empty>Only the owner can change clinic settings.</Empty>
      </>
    );
  }
  const clinic = await getClinicSettings(ctx);
  return (
    <>
      <PageHead eyebrow="Settings" title="Clinic" />
      <ClinicForm clinic={clinic} />
    </>
  );
}
