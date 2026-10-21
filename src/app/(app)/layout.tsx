import { requireContext } from '@/lib/auth';
import { listBranches } from '@/services/branches';
import { canAnywhere } from '@/services/context';
import { hasAnySettings, settingsAccess } from '@/services/settings';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import { RENDER_KEY_ID } from '@/lib/nav/after-action';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const branches = await listBranches(ctx);
  const active = ctx.activeBranchId === 'all' ? null : branches.find((b) => b.id === ctx.activeBranchId) ?? null;
  return (
    <div className="shell">
      {/* Changes on every server render, so a client can tell that a refresh landed (T18). */}
      <span hidden id={RENDER_KEY_ID} data-k={globalThis.crypto.randomUUID()} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        userName={ctx.userName}
        branches={branches.map((b) => ({ id: b.id, name: b.name, gstRegistered: b.gstRegistered }))}
        activeBranchId={ctx.activeBranchId}
        can={{
          patients: canAnywhere(ctx, 'patient.view'),
          bill: canAnywhere(ctx, 'invoice.issue'),
          dayClose: canAnywhere(ctx, 'day.close'),
          reports: canAnywhere(ctx, 'report.branch'),
          gst: canAnywhere(ctx, 'report.gst'),
          settings: hasAnySettings(settingsAccess(ctx)),
        }}
      />
      <div className="content">
        <header className={`topbar${active ? '' : ' all'}`}>
          <div className="branch-banner" aria-live="polite">
            {active ? (
              <>
                <span className="dot" aria-hidden="true" /> Working in <strong>{active.name}</strong>
                {active.gstRegistered ? <span className="pill tax12">GST registered</span> : <span className="pill exempt">Not GST registered</span>}
              </>
            ) : (
              <>Viewing <strong>all branches</strong> · pick one in the sidebar to bill or take payments</>
            )}
          </div>
          {canAnywhere(ctx, 'patient.view') ? <GlobalSearch /> : null}
        </header>
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
