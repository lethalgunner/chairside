import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { setupProgress, showsSetup, type SetupStep } from '@/services/onboarding';
import { Empty, PageHead } from '@/components/ui';

const STEPS: Record<SetupStep['key'], { title: string; how: string; href: string; cta: string; optional?: boolean }> = {
  prices: { title: 'Add your treatments and prices', how: 'Paste them from Excel, or add them one by one. GST treatment per item: check with your CA.', href: '/settings/catalogue', cta: 'Open price list' },
  doctors: { title: 'Set up your doctors', how: 'Who treats patients, their registration numbers, and the days and hours they work.', href: '/settings/doctors', cta: 'Open doctors' },
  header: { title: 'Bill header and UPI', how: 'Your logo, address and footer on bills; your UPI ID for scan-to-pay.', href: '/settings/print', cta: 'Open bill header', optional: true },
  team: { title: 'Invite your front desk', how: 'Each person gets their own sign-in, so the records show who did what.', href: '/settings/team', cta: 'Open team', optional: true },
  patient: { title: 'Register your first patient', how: 'Name and mobile is enough to start. Moving from other software? Settings → Bring your data imports all your patients and coming appointments at once.', href: '/patients/new', cta: 'New patient' },
  bill: { title: 'Make your first bill', how: 'From the patient’s page: New bill.', href: '/patients', cta: 'Find a patient' },
};

/** Getting started (Sprint 7): the owner's checklist after sign-up. Worked out from the data. */
export default async function StartPage() {
  const ctx = await requireContext();
  if (!showsSetup(ctx)) {
    return (
      <>
        <PageHead title="Getting started" />
        <Empty>Your clinic owner sets things up. Ask them if something is missing.</Empty>
      </>
    );
  }
  const steps = await setupProgress(ctx);
  const done = steps.filter((s) => s.done).length;
  return (
    <>
      <PageHead title="Getting started" sub={`${done} of ${steps.length} done. Most clinics finish in under 20 minutes.`} />
      <ol className="plain setup-list">
        {steps.map((s, i) => {
          const m = STEPS[s.key];
          return (
            <li key={s.key} className={`card setup-step${s.done ? ' done' : ''}`}>
              <div className="body">
                <div className="strong">
                  {i + 1}. {m.title} {s.done ? <span className="pill paid">Done</span> : m.optional ? <span className="pill">Optional</span> : null}
                </div>
                <p className="muted small">{m.how}</p>
                {!s.done ? <Link className="cta secondary-cta" href={m.href}>{m.cta}</Link> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
