import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { istTime, shortDay, businessDate } from '@/domain/dates';
import { canDo } from '@/services/context';
import { todaysMessages, type QueueItem } from '@/services/messages';
import { settingsAccess } from '@/services/settings';
import { Card, Empty, PageHead } from '@/components/ui';
import MessageActions from './MessageActions';

/** Today's messages (Sprint 8, Mode 1): what the clinic's reminder rules say is due, one tap each. */
export default async function MessagesPage() {
  const ctx = await requireContext();
  const branch = ctx.activeBranchId === 'all' ? null : ctx.activeBranchId;
  const owner = settingsAccess(ctx).reminders;
  if (!branch) {
    return (
      <>
        <PageHead title="Today’s messages" />
        <div className="callout">Pick a branch in the branch menu: messages go from each branch’s own WhatsApp.</div>
      </>
    );
  }
  if (!canDo(ctx, 'patient.remind', branch)) {
    return (
      <>
        <PageHead title="Today’s messages" />
        <Empty>The front desk or manager sends reminders at this branch.</Empty>
      </>
    );
  }
  const q = await todaysMessages(ctx, branch);
  const today = businessDate();
  const when = (d: Date) => (businessDate(d) === today ? istTime(d) : `${shortDay(businessDate(d))} ${istTime(d)}`);
  const row = (i: QueueItem, later: boolean) => (
    <li key={i.key}>
      <div>
        <Link className="link strong" href={`/patients/${i.patientId}`}>{i.patientName}</Link> <span className="muted small">· {i.about}</span>
        <div className="small">{i.timing}{later ? ` · from ${istTime(i.dueAt)}` : ` · due ${when(i.dueAt)}`}</div>
      </div>
      <MessageActions itemKey={i.key} href={i.href} label={`${i.patientName}, ${i.timing}`} />
      <details>
        <summary className="small">See message</summary>
        <pre className="tpl-body">{i.text}</pre>
      </details>
    </li>
  );
  return (
    <>
      <PageHead
        title="Today’s messages"
        sub={q.configured ? `${q.dueNow.length} to send now${q.laterToday.length ? ` · ${q.laterToday.length} later today` : ''}` : undefined}
        right={owner ? <Link className="secondary" href="/settings/reminders">Reminder settings</Link> : null}
      />
      {!q.configured ? (
        <Empty>
          No reminders are set up yet.{' '}
          {owner ? <Link className="link" href="/settings/reminders">Set them up in Settings → Reminders</Link> : 'The owner sets them up in Settings → Reminders.'}
        </Empty>
      ) : (
        <>
          <Card title="Send now" note="Tap Send: WhatsApp opens with the message ready. Press send there.">
            {q.dueNow.length === 0 ? <p className="muted small">All sent. Nice work.</p> : <ul className="plain msg-list">{q.dueNow.map((i) => row(i, false))}</ul>}
          </Card>
          {q.laterToday.length > 0 ? (
            <Card title="Later today">
              <ul className="plain msg-list">{q.laterToday.map((i) => row(i, true))}</ul>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
