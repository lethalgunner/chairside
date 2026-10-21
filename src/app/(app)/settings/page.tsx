import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { hasAnySettings, settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';

const SECTIONS = [
  { key: 'team', href: '/settings/team', title: 'Team', sub: 'Invite staff, send a new link, deactivate someone who has left.' },
  { key: 'catalogue', href: '/settings/catalogue', title: 'Price list', sub: 'Treatments and products, their prices and GST.' },
] as const;

export default async function SettingsPage() {
  const ctx = await requireContext();
  const access = settingsAccess(ctx);
  if (!hasAnySettings(access)) {
    return (
      <>
        <PageHead title="Settings" />
        <Empty>You don’t have access to settings.</Empty>
      </>
    );
  }
  return (
    <>
      <PageHead title="Settings" sub="Changes here are recorded with your name." />
      <ul className="plain settings-list">
        {SECTIONS.filter((s) => access[s.key]).map((s) => (
          <li key={s.key}>
            <Link className="link" href={s.href}>{s.title}</Link>
            <div className="muted small">{s.sub}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
