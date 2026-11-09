import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { listBranches } from '@/services/branches';
import { getMessageSettings } from '@/services/messages';
import { settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';
import RemindersEditor from './RemindersEditor';

/** Settings → Reminders (Sprint 8, ADR-020): the clinic's own rules and wording. */
export default async function RemindersSettingsPage() {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).reminders) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Reminders" />
        <Empty>Only the owner can change reminders.</Empty>
      </>
    );
  }
  const [settings, branches] = await Promise.all([getMessageSettings(ctx), listBranches(ctx)]);
  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="Reminders"
        sub="When patients get a WhatsApp message and what it says. Chairside lists each one in Today’s messages when it’s due; the desk taps Send and it goes from the clinic’s own WhatsApp."
        right={<Link className="secondary" href="/messages">Today’s messages</Link>}
      />
      <RemindersEditor settings={settings} branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </>
  );
}
