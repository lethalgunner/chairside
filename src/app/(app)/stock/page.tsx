import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { STOCK_KIND_LABEL, STOCK_KINDS, UNITS, unitLabel } from '@/domain/stock';
import { listCatalogue } from '@/services/catalogue';
import { canAnywhere, canDo } from '@/services/context';
import { listMedicines } from '@/services/rx';
import { listStock } from '@/services/stock';
import { Card, Empty, PageHead } from '@/components/ui';
import { MovementForm, StockItemForm } from './StockForms';

/** Medicines and clinic supplies at this branch (Sprint 6, LET-176). */
export default async function StockPage() {
  const ctx = await requireContext();
  if (!canAnywhere(ctx, 'stock.manage') && !canAnywhere(ctx, 'report.branch')) {
    return (
      <>
        <PageHead title="Stock" />
        <Empty>Stock is kept by the front desk, assistants and managers.</Empty>
      </>
    );
  }
  if (ctx.activeBranchId === 'all') {
    return (
      <>
        <PageHead title="Stock" />
        <div className="callout">Each branch has its own shelf. Pick a branch in the branch menu.</div>
      </>
    );
  }
  const branch = ctx.activeBranchId;
  const canEdit = canDo(ctx, 'stock.manage', branch);
  const [rows, meds, catalogue] = await Promise.all([listStock(ctx, branch), canEdit ? listMedicines(ctx, { activeOnly: true }).catch(() => []) : Promise.resolve([]), canEdit ? listCatalogue(ctx, branch) : Promise.resolve([])]);
  const low = rows.filter((r) => r.active && r.low).length;
  const expiring = rows.filter((r) => r.active && (r.expiring || r.expired)).length;
  return (
    <>
      <PageHead title="Stock" sub={`${rows.filter((r) => r.active).length} items · ${low} low · ${expiring} may expire within 60 days`} />
      {canEdit ? (
        <StockItemForm
          kinds={STOCK_KINDS.map((k) => ({ value: k, label: STOCK_KIND_LABEL[k] }))}
          units={[...UNITS]}
          medicines={meds.filter((m) => !rows.some((r) => r.medicineId === m.id)).map((m) => ({ id: m.id, name: `${m.name}${m.strength ? ` ${m.strength}` : ''}` }))}
          goods={catalogue.filter((c) => c.taxCategory.startsWith('goods') && !rows.some((r) => r.catalogueItemId === c.id)).map((c) => ({ id: c.id, name: c.name }))}
        />
      ) : null}
      {STOCK_KINDS.map((k) => {
        const list = rows.filter((r) => r.kind === k && r.active);
        return (
          <Card key={k} title={`${STOCK_KIND_LABEL[k]} · ${list.length}`} flush>
            {list.length === 0 ? (
              <Empty>{k === 'medicine' ? 'No medicines stocked yet. Add one from your medicine list.' : 'No supplies yet. Add gloves, composite, anaesthetic…'}</Empty>
            ) : (
              <div className="tablewrap">
                <table className="stack-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="num">On hand</th>
                      <th scope="col">Alerts</th>
                      {canEdit ? <th scope="col"><span className="sr-only">Record</span></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Item" className="strong">
                          {r.name}
                          <div className="muted small">{r.reorderLevel > 0 ? `Reorder at ${r.reorderLevel}` : 'No reorder level'}{r.soldAs ? ` · sold as ${r.soldAs}` : ''}</div>
                        </td>
                        <td data-label="On hand" className={`num strong${r.onHand < 0 ? ' due-text' : ''}`}>{r.onHand} {unitLabel(r.unit, r.onHand)}</td>
                        <td data-label="Alerts">
                          {r.low ? <span className="pill due">Low</span> : null}{' '}
                          {r.expired ? <span className="pill credit">Expired {displayDate(r.mayExpireOn!)}</span> : r.expiring ? <span className="pill credit">May expire {displayDate(r.mayExpireOn!)}</span> : null}
                          {r.onHand < 0 ? <div className="muted small">Below zero: record what was received.</div> : null}
                        </td>
                        {canEdit ? <td><MovementForm itemId={r.id} name={r.name} unit={r.unit} isMedicine={r.kind === 'medicine'} /></td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
