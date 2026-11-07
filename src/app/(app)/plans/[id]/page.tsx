import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { displayDate, businessDate } from '@/domain/dates';
import { formatINR } from '@/domain/money';
import { PLAN_LABEL, STAGE_LABEL } from '@/domain/plans';
import { listCatalogue } from '@/services/catalogue';
import { canDo } from '@/services/context';
import { getPlan } from '@/services/plans';
import { listProviders } from '@/services/providers';
import { Card, PageHead } from '@/components/ui';
import PlanBuilder from '../PlanBuilder';
import PlanActions, { ItemControls, MarkDone } from './PlanActions';

/** One treatment plan: sittings, what's done and billed, estimate vs actual (LET-168/169). */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const { added } = await searchParams;
  const plan = await getPlan(ctx, id);
  if (!plan) notFound();
  const here = ctx.activeBranchId === plan.branchId;
  const canManage = canDo(ctx, 'plan.manage', plan.branchId);
  const open = plan.status === 'draft' || plan.status === 'accepted';
  const sittings = [...new Set(plan.items.map((i) => i.session))].sort((a, b) => a - b);
  const [catalogue, doctors] = canManage && open && here ? await Promise.all([listCatalogue(ctx, plan.branchId), listProviders(ctx, plan.branchId)]) : [[], []];
  const t = plan.totals;

  return (
    <>
      {added ? <div className="callout good" role="status">Added to the plan.</div> : null}
      <PageHead
        eyebrow={`${plan.ref} · ${plan.branchName} · ${displayDate(businessDate(plan.createdAt))}`}
        title={plan.title}
        sub={`${plan.patientName} · ${plan.doctorName}`}
        right={
          <>
            <span className={`pill${plan.status === 'cancelled' ? ' credit' : plan.status === 'completed' ? ' paid' : ''}`}>{PLAN_LABEL[plan.status]}</span>
            <Link className="cta secondary-cta" href={`/plans/${plan.id}/estimate`}>Print estimate</Link>
            <Link className="link" href={`/patients/${plan.patientId}`}>Patient</Link>
          </>
        }
      />
      {plan.status === 'cancelled' && plan.cancelReason ? <div className="callout warn">Cancelled: {plan.cancelReason}. Work already done can still be billed.</div> : null}
      {!here && canManage && open ? <div className="callout">This plan is at {plan.branchName}. Switch to it in the branch menu to record work.</div> : null}

      <div className="tiles four">
        <div className="tile"><div className="k">{formatINR(t.estimateTotalPaise)}</div><div className="l">Estimate{t.estimateTaxPaise > 0 ? ` incl. ${formatINR(t.estimateTaxPaise)} GST` : ''}</div></div>
        <div className="tile"><div className="k">{formatINR(t.todoPaise)}</div><div className="l">Still to do</div></div>
        <div className={`tile${t.doneUnbilledPaise > 0 ? ' alert' : ''}`}><div className="k">{formatINR(t.doneUnbilledPaise)}</div><div className="l">Done, not billed</div></div>
        <div className="tile"><div className="k">{formatINR(t.billedPaise)}</div><div className="l">Billed ({t.doneCount}/{t.count} done)</div></div>
      </div>
      {t.doneUnbilledPaise > 0 && canDo(ctx, 'invoice.issue', plan.branchId) ? (
        <p><Link className="primary-link" href={`/bills/new?patient=${plan.patientId}`}>Bill the done work →</Link></p>
      ) : null}

      <MarkDone planId={plan.id} enabled={canManage && open && here} doctors={doctors} defaultDoctorId={plan.doctorId}>
        {sittings.map((s) => (
          <Card key={s} title={`Sitting ${s}`} flush>
            <div className="tablewrap">
              <table className="stack-table">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Done</span></th>
                    <th scope="col">Treatment</th>
                    <th scope="col">Tooth</th>
                    <th scope="col" className="num">Agreed</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="sr-only">Change</span></th>
                  </tr>
                </thead>
                <tbody>
                  {plan.items.filter((i) => i.session === s).map((i) => (
                    <tr key={i.id} className={i.stage === 'dropped' ? 'dropped' : undefined}>
                      <td data-label="Done">{i.stage === 'planned' && canManage && open && here ? <input type="checkbox" name="done" value={i.id} aria-label={`Done: ${i.name}${i.toothNumber ? `, tooth ${i.toothNumber}` : ''}`} /> : null}</td>
                      <td data-label="Treatment" className="strong">
                        {i.name}
                        {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                        {i.priceReason ? <div className="muted small">List {formatINR(i.listPricePaise ?? i.unitPricePaise)} · {i.priceReason}</div> : null}
                        {i.dropReason ? <div className="muted small">Dropped: {i.dropReason}</div> : null}
                      </td>
                      <td data-label="Tooth">{i.toothNumber ?? '—'}</td>
                      <td data-label="Agreed" className="num">{formatINR((i.unitPricePaise * i.quantity) as typeof i.unitPricePaise)}</td>
                      <td data-label="Status"><span className={`pill${i.stage === 'billed' ? ' paid' : i.stage === 'done_unbilled' ? ' due' : ''}`}>{STAGE_LABEL[i.stage]}</span></td>
                      <td>{i.stage === 'planned' && canManage && open ? <ItemControls item={{ id: i.id, name: i.name, toothNumber: i.toothNumber ?? '', quantity: i.quantity, price: (i.unitPricePaise / 100).toString(), priceReason: i.priceReason ?? '', session: i.session }} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </MarkDone>

      {canManage ? <PlanActions planId={plan.id} status={plan.status} /> : null}

      {canManage && open && here ? (
        <details className="card add-more">
          <summary>Add more treatment to this plan</summary>
          <PlanBuilder mode="add" patientId={plan.patientId} planId={plan.id} catalogue={catalogue} doctors={doctors} nextSession={(sittings[sittings.length - 1] ?? 0) + 1} />
        </details>
      ) : null}
    </>
  );
}
