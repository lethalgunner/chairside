import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate } from '@/domain/dates';
import { add, formatINR, ZERO, type Paise } from '@/domain/money';
import { remindedLabel } from '@/domain/whatsapp';
import { scopeBranchIds } from '@/services/context';
import { reminderKey, reminderTargets } from '@/services/reminders';
import { receivables } from '@/services/reports';
import { testSeriesEnabled } from '@/services/util';
import { Card, Empty, PageHead, Tile } from '@/components/ui';
import RemindButton from '@/components/RemindButton';

function daysSince(iso: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
}

export default async function ReceivablesPage() {
  const ctx = await requireContext();
  const today = businessDate();
  const { rows, ageing } = await receivables(ctx, scopeBranchIds(ctx), today);
  // One reminder per patient per branch, on that patient's oldest open bill there (T32).
  const due = new Map<string, Paise>();
  const firstRow = new Set<string>();
  for (const r of rows) {
    const k = reminderKey(r.patientId, r.branchId);
    if (!due.has(k)) firstRow.add(r.id);
    due.set(k, add(due.get(k) ?? ZERO, r.duePaise));
  }
  const targets = await reminderTargets(
    ctx,
    [...due].map(([k, amountPaise]) => {
      const [patientId, branchId] = k.split(':') as [string, string];
      return { patientId, branchId, amountPaise };
    }),
  );
  const showRemind = targets.size > 0;
  const confirmOldSystem = testSeriesEnabled();
  return (
    <>
      <PageHead title="Receivables" sub="Open bills, oldest first: the order to follow up." />
      <div className="tiles">
        <Tile k={formatINR(ageing.current, { paise: false })} l="0–30 days" />
        <Tile k={formatINR(ageing.days31to60, { paise: false })} l="31–60 days" />
        <Tile k={formatINR(ageing.days61to90, { paise: false })} l="61–90 days" />
        <Tile k={formatINR(ageing.over90, { paise: false })} l="Over 90 days" tone={ageing.over90 > 0 ? 'alert' : undefined} />
      </div>
      <Card title={`${rows.length} open bill${rows.length === 1 ? '' : 's'} · ${formatINR(ageing.total)}`} flush>
        {rows.length === 0 ? (
          <Empty>No one owes anything.</Empty>
        ) : (
          <div className="tablewrap">
            <table className="stack-table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Bill</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">Days</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Due</th>
                  {showRemind ? <th scope="col">Follow up</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Patient" className="strong"><Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                    <td data-label="Bill"><Link className="link mono" href={`/invoices/${r.id}`}>{r.number}</Link></td>
                    <td data-label="Branch">{r.branchName}</td>
                    <td data-label="Date">{displayDate(r.issuedOn)}</td>
                    <td data-label="Days" className="num">{daysSince(r.issuedOn, today)}</td>
                    <td data-label="Total" className="num">{formatINR(r.totalPaise)}</td>
                    <td data-label="Due" className="num strong due-text">{formatINR(r.duePaise)}</td>
                    {showRemind
                      ? (() => {
                          const t = firstRow.has(r.id) ? targets.get(reminderKey(r.patientId, r.branchId)) : undefined;
                          return (
                            <td data-label={t ? 'Follow up' : undefined} className="follow-up">
                              {t ? (
                                <RemindButton
                                  compact
                                  patientId={t.patientId}
                                  branchId={t.branchId}
                                  href={t.href}
                                  amountLabel={formatINR(t.amountPaise)}
                                  lastLabel={t.lastSentAt ? remindedLabel(t.lastSentAt) : null}
                                  confirmOldSystem={confirmOldSystem}
                                />
                              ) : null}
                            </td>
                          );
                        })()
                      : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
