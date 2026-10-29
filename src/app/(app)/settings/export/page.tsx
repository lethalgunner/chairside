import { requireContext } from '@/lib/auth';
import { settingsAccess } from '@/services/settings';
import { Card, Empty, PageHead } from '@/components/ui';

const FILES = [
  { kind: 'patients', title: 'Patients', sub: 'Name, mobile, file numbers, age, how they heard about you.' },
  { kind: 'bills', title: 'Bills', sub: 'One row per bill: totals, tax, paid and due, cancelled bills included.' },
  { kind: 'bill-lines', title: 'Bill lines', sub: 'Every treatment and item on every bill, with HSN/SAC and tax. For your CA.' },
  { kind: 'payments', title: 'Payments', sub: 'Every payment with its mode and reference, cancelled ones marked.' },
] as const;

/** Export my data (Sprint 3, T40). Owner only. */
export default async function ExportPage() {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).export) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Export my data" />
        <Empty>Only the owner can export the clinic’s data.</Empty>
      </>
    );
  }
  return (
    <>
      <PageHead eyebrow="Settings" title="Export my data" sub="Your data is yours. Each file covers every branch and opens in Excel or Google Sheets." />
      <Card title="Download">
        <ul className="plain settings-list">
          {FILES.map((f) => (
            <li key={f.kind}>
              <a className="link" href={`/export/${f.kind}`} download>
                {f.title} (CSV)
              </a>
              <div className="muted small">{f.sub}</div>
            </li>
          ))}
        </ul>
        <p className="muted small">The files hold patients’ names and mobile numbers. Keep them on the clinic’s computer, don’t forward them, and delete copies you no longer need. Every download is recorded with your name.</p>
      </Card>
    </>
  );
}
