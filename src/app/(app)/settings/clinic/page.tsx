import { requireContext } from '@/lib/auth';
import { getClinicSettings } from '@/services/clinic';
import { settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';
import ClinicForm from './ClinicForm';
import DiscountCapsForm from './DiscountCapsForm';
import RecallDaysForm from './RecallDaysForm';
import { RECALL_KINDS, RECALL_LABEL } from '@/domain/visits';
import { getDiscountCaps } from '@/services/discounts';
import { CAPPABLE_ROLES } from '@/domain/discounts';
import { ROLE_LABELS } from '@/domain/permissions';

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
  const [clinic, caps] = await Promise.all([getClinicSettings(ctx), getDiscountCaps(ctx)]);
  return (
    <>
      <PageHead eyebrow="Settings" title="Clinic" />
      <ClinicForm clinic={clinic} />
      <DiscountCapsForm
        roles={CAPPABLE_ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] }))}
        initial={Object.fromEntries(Object.entries(caps).map(([r, bp]) => [r, String(bp! / 100)]))}
      />
      <RecallDaysForm kinds={RECALL_KINDS.map((k) => ({ kind: k, label: RECALL_LABEL[k] }))} initial={clinic.recallDays} />
    </>
  );
}
