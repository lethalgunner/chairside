import { requireContext } from '@/lib/auth';
import { businessDate, displayDate } from '@/domain/dates';
import { DEFINITIONS, parseWindow, type Label } from '@/domain/scorecard';
import { canAnywhere, ForbiddenError, scopeBranchIds } from '@/services/context';
import { pilotScorecard, SCORECARD_REFUSED, type Scorecard } from '@/services/scorecard';
import { Card, Empty, PageHead } from '@/components/ui';

// The label is always text; the colour only repeats it.
const LABEL_CLASS: Record<Label, string> = { Pass: 'paid', 'Not yet': 'due', 'No data': 'exempt', 'For information': 'exempt' };

/** Pilot 0 scorecard (T26): the five measures the parallel run is judged on. */
export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireContext();
  if (!canAnywhere(ctx, 'report.branch')) {
    return (
      <>
        <PageHead title="Pilot scorecard" />
        <Empty>{SCORECARD_REFUSED}</Empty>
      </>
    );
  }
  const today = businessDate();
  const win = parseWindow(await searchParams, today);
  let card: Scorecard | null = null;
  try {
    card = await pilotScorecard(ctx, scopeBranchIds(ctx), win.from, win.to);
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
  }
  const range = win.from === win.to ? displayDate(win.from) : `${displayDate(win.from)} to ${displayDate(win.to)}`;

  return (
    <>
      <PageHead title="Pilot scorecard" sub="The parallel run measured against its pass marks. Figures come from bills, payments, day closes and a small usage log." />
      <form className="search-row scorecard-range" action="/scorecard">
        <label htmlFor="sc-from">From</label>
        <input id="sc-from" name="from" type="date" defaultValue={win.from} max={today} required />
        <label htmlFor="sc-to">To</label>
        <input id="sc-to" name="to" type="date" defaultValue={win.to} max={today} required />
        <button className="secondary-btn" type="submit">
          Show
        </button>
        <span className="muted small">Up to 31 days. Opens on the last 5 days.</span>
      </form>
      {win.error ? (
        <div className="callout warn" role="status">
          {win.error}
        </div>
      ) : null}

      {card === null ? (
        <Empty>{SCORECARD_REFUSED} Pick a branch you report on in the branch menu.</Empty>
      ) : (
        card.scopes.map((s) => (
          <Card key={s.id} title={s.name} note={range} flush>
            <div className="tablewrap">
              <table className="stack-table scorecard">
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">Measured</th>
                    <th scope="col">Pass mark</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {s.criteria.map((c) => (
                    <tr key={c.key}>
                      <td className="strong">{c.title}</td>
                      <td data-label="Measured">{c.measured}</td>
                      <td data-label="Pass mark" className="muted">{c.threshold}</td>
                      <td data-label="Result">
                        <span className={`pill ${LABEL_CLASS[c.label]}`}>{c.label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <Card title="How each measure is worked out">
        <ul className="plain scorecard-defs">
          {Object.entries(DEFINITIONS).map(([k, line]) => (
            <li key={k}>{line}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
