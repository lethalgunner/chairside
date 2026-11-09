import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { listBranches } from '@/services/branches';
import { settingsAccess } from '@/services/settings';
import { Empty, PageHead } from '@/components/ui';
import DataImport from './DataImport';

/** Settings → Bring your data (Sprint 9): patients and coming appointments from the old software. */
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).import) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Bring your data" />
        <Empty>Only the owner can import data.</Empty>
      </>
    );
  }
  const kind = (await searchParams).kind === 'appointments' ? 'appointments' : 'patients';
  const branches = await listBranches(ctx);
  const active = ctx.activeBranchId === 'all' ? null : branches.find((b) => b.id === ctx.activeBranchId);
  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="Bring your data"
        sub="Move patients and coming appointments from your old software. Export them to Excel or CSV there, then paste or pick the file here. Check shows what will happen; nothing is saved until you press Import."
      />
      <p className="small"><Link className="link" href="/help#import">How importing works</Link></p>
      <nav className="tabs" aria-label="What to import">
        <Link className={kind === 'patients' ? 'tab on' : 'tab'} aria-current={kind === 'patients' ? 'page' : undefined} href="/settings/import?kind=patients">1. Patients</Link>
        <Link className={kind === 'appointments' ? 'tab on' : 'tab'} aria-current={kind === 'appointments' ? 'page' : undefined} href="/settings/import?kind=appointments">2. Coming appointments</Link>
      </nav>
      {!active ? (
        <div className="callout">Pick the branch these belong to in the branch menu first. Patients get that branch’s file numbers; appointments are booked there.</div>
      ) : (
        <DataImport key={kind} kind={kind} branchName={active.name} />
      )}
      <p className="muted small">Money owed from the old software isn’t brought in yet: we’ll add it once your CA agrees how opening balances should go into the books.</p>
    </>
  );
}
