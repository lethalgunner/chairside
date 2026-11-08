import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate } from '@/domain/dates';
import { formatINR, type Paise } from '@/domain/money';
import { getPrintHeader } from '@/services/branches';
import { getPlan } from '@/services/plans';
import PrintHead, { PrintBar } from '@/components/PrintHead';

/**
 * The patient's estimate (LET-168), printed or saved as PDF by the browser.
 * An estimate, not a bill: prices can change if the treatment changes.
 */
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const plan = await getPlan(ctx, id);
  if (!plan) notFound();
  const head = await getPrintHeader(ctx, plan.branchId);
  const live = plan.items.filter((i) => i.stage !== 'dropped');
  const sittings = [...new Set(live.map((i) => i.session))].sort((a, b) => a - b);
  const t = plan.totals;
  return (
    <>
      <PrintBar title={`Estimate ${plan.ref}`} back={{ href: `/plans/${plan.id}`, label: 'Back to plan' }} />
      <article className="print-doc">
        <PrintHead {...head} />
        <h1>Treatment estimate {plan.ref}</h1>
        <div className="meta">
          <div>
            <strong>{plan.patientName}</strong>
            <div>{plan.title}</div>
          </div>
          <div>
            <div>Date {displayDate(businessDate(plan.createdAt))}</div>
            <div>Doctor {plan.doctorName}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Sitting</th>
              <th>Treatment</th>
              <th>Tooth</th>
              <th className="num">Qty</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sittings.flatMap((s) =>
              live.filter((i) => i.session === s).map((i, n) => (
                <tr key={i.id}>
                  <td>{n === 0 ? s : ''}</td>
                  <td>{i.name}</td>
                  <td>{i.toothNumber ?? ''}</td>
                  <td className="num">{i.quantity}</td>
                  <td className="num">{formatINR((i.unitPricePaise * i.quantity) as Paise)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <div className="totals">
          {t.estimateTaxPaise ? <div><span>GST (on crowns and other goods)</span><span>{formatINR(t.estimateTaxPaise)}</span></div> : null}
          <div><strong>Estimated total</strong><strong>{formatINR(t.estimateTotalPaise)}</strong></div>
        </div>
        <p className="small">This is an estimate, not a bill. Each sitting is billed when it is done, and the final amount can change if the treatment changes.</p>
        <div className="sign">{plan.doctorName}</div>
        {head.footer ? <div className="print-foot">{head.footer}</div> : null}
      </article>
    </>
  );
}
