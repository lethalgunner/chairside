import { requireContext } from '@/lib/auth';
import { ROLE_LABELS, ROLES } from '@/domain/permissions';
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
              access: p.grants.map((g) => `${ROLE_LABELS[g.role]}${g.branchName ? ` · ${g.branchName}` : ''}`),
              status: p.status,
              inviteUntil: p.inviteExpiresAt ? istDateTime(p.inviteExpiresAt) : null,
            }))}
          />
        )}
      </Card>
    </>
  );
}
