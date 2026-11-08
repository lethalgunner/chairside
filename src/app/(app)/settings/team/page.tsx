import { requireContext } from '@/lib/auth';
import { ALL_CAPABILITIES, CAPABILITY_LABEL, ROLE_CAPABILITIES, ROLE_LABELS, ROLES } from '@/domain/permissions';
import { listStaff, listWithoutLogin, staffBranchOptions } from '@/services/staff';
import { settingsAccess } from '@/services/settings';
import { Card, Empty, PageHead } from '@/components/ui';
import InviteForm from './InviteForm';
import TeamTable from './TeamTable';

function istDateTime(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
}

export default async function TeamPage() {
  const ctx = await requireContext();
  if (!settingsAccess(ctx).team) {
    return (
      <>
        <PageHead eyebrow="Settings" title="Team" />
        <Empty>Only the owner can manage the team.</Empty>
      </>
    );
  }
  const [people, unlinked, branches] = await Promise.all([listStaff(ctx), listWithoutLogin(ctx), staffBranchOptions(ctx)]);
  return (
    <>
      <PageHead eyebrow="Settings" title="Team" sub="Invite links work once, for 72 hours. Nobody else ever sees the password they choose." />
      <Card title="Invite someone">
        <InviteForm roles={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} branches={branches} unlinked={unlinked} />
      </Card>
      <Card title="People" note={`${people.filter((p) => p.active).length} active`} flush>
        {people.length === 0 ? (
          <Empty>No one yet.</Empty>
        ) : (
          <TeamTable
            rows={people.map((p) => ({
              id: p.id,
              fullName: p.fullName,
              email: p.email,
              active: p.active,
              isSelf: p.isSelf,
              access: p.grants.map((g) => ({ id: g.id, label: `${ROLE_LABELS[g.role]}${g.branchName ? ` · ${g.branchName}` : ''}`, removable: !(g.role === 'owner' && p.isSelf) && p.grants.length > 1 })),
              status: p.status,
              inviteUntil: p.inviteExpiresAt ? istDateTime(p.inviteExpiresAt) : null,
            }))}
            roles={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            branches={branches}
          />
        )}
      </Card>
      <details className="card role-table">
        <summary>What each role can do</summary>
        {/* Wide on a phone: focusable so keyboard users can scroll it (axe scrollable-region-focusable). */}
        <div className="tablewrap" tabIndex={0} role="region" aria-label="Access table">
          <table>
            <thead>
              <tr>
                <th scope="col">Can</th>
                {ROLES.map((r) => <th key={r} scope="col" className="small">{ROLE_LABELS[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {ALL_CAPABILITIES.map((c) => (
                <tr key={c}>
                  <td>{CAPABILITY_LABEL[c]}</td>
                  {ROLES.map((r) => <td key={r} className="center" aria-label={ROLE_CAPABILITIES[r].includes(c) ? 'yes' : 'no'}>{ROLE_CAPABILITIES[r].includes(c) ? '✓' : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">A person can hold more than one role, e.g. Owner and Doctor. Changes apply from their next click.</p>
      </details>
    </>
  );
}
