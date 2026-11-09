import { requireContext } from '@/lib/auth';
import { listBranches } from '@/services/branches';
import { canAnywhere } from '@/services/context';
import { hasAnySettings, settingsAccess } from '@/services/settings';
import { getClinicSettings } from '@/services/clinic';
import { remindersConfigured } from '@/services/messages';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import { RENDER_KEY_ID } from '@/lib/nav/after-action';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const [branches, clinic, reminders] = await Promise.all([listBranches(ctx), getClinicSettings(ctx), canAnywhere(ctx, 'patient.remind') ? remindersConfigured(ctx) : Promise.resolve(false)]);
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
          scorecard: canAnywhere(ctx, 'report.branch') && clinic.parallelRun,
          gst: canAnywhere(ctx, 'report.gst'),
          settings: hasAnySettings(settingsAccess(ctx)),
          stock: canAnywhere(ctx, 'stock.manage'),
          messages: reminders,
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
              <span>Viewing <strong>all branches</strong> · pick a branch in the branch menu to bill or take payments</span>
            )}
          </div>
          {canAnywhere(ctx, 'patient.view') ? <GlobalSearch /> : null}
        </header>
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
