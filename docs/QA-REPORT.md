# QA report

## Pilot 0 build — 17 Oct 2026
**Branch:** `pilot0` · **Result:** pass, with the open items below

### Automated (run locally, all executed)
| Suite | Tests | Pass | Notes |
|---|---|---|---|
| `npm test` (domain, incl. IST dates, FY boundary, 16-char numbering, phone, capabilities) | 78 | 78 | |
| `npm run test:db` (services on Postgres 16) | 23 | 23 | Golden path figures hand-calculated; 25 concurrent issues gapless; rollback returns a number; idempotent bill and receipt; advances; void; ledger identity; cross-org isolation; branch scoping |
| `npm run test:e2e` (Playwright, production build, Chromium) | 25 | 25 | Access sweep, roles, golden path to locked day, double-click, duplicates, a11y (axe: no serious/critical), 390px layout |
| `npm run typecheck` / `next build` | — | clean | |

### Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| Q1 | S1 | Correlated subqueries bound to the wrong `id` (Drizzle renders single-table columns unqualified): dashboard "patients owe" ignored payments; partly paid bills and advances could be over-allocated | **Fixed**, 3 regression tests |
| Q2 | S3 | Bill line "Remove" clipped at 1366px | Fixed |
| Q3 | S3 | Phones: full nav stacked above the numbers | Fixed (compact nav row) |
| Q4 | S4 | Same-day receivables not in creation order; phone unformatted in bill header; dashboard CTA wording | Fixed |
| Q5 | S3 *verify* | Twice in early full e2e runs, patient registration stayed on "Saving…" past 5 s; not reproduced in 4 later full runs or in isolation, and no waiting transaction was seen in Postgres | Watch in the parallel run; log action durations if it recurs |
| Q6 | S2 (policy) | GST defaults in `src/domain/tax.ts` (prosthetics 12%, oral care 18%) predate GST 2.0; secondary sources report 5% from 22 Sep 2025. Pilot seed uses 5%. | **Needs KS/CA** |

### UX audit status (chairside-ux-qa-audit.md)
F1 day-close write path ✔ · F2 invoice dead end ✔ · F3 duplicate dead end ✔ · F3b fields wiped ✔ (controlled) · F4 phone paste ✔ · F5 age goes stale ✔ (age + recorded date; guardian link deferred) · F6 states ✔ (loading/error/not-found/empty) · F7 search ✔ · F8 stale invoice ✔ (all dynamic) · F9 dev copy ✔ · F10 hard-coded status ✔ · F11 stopwatch ✔ removed · F12 a11y ✔ (axe clean; contrast raised) · F13 Link nav ✔ · F14 coin labels ✔.
Not done (out of Pilot 0): PIN switch, print templates, Hindi/Marathi, thermal receipts, request-reopen flow.

### Parallel-run checklist (for the clinic week)
- Daily: Chairside day totals vs the old system's report (billed, collected by mode), via the day-close tally.
- Friction log template: time · who · screen · what happened · S1–S4.
- Watch: Q5; time to bill a returning patient; whether staff reach for the old system mid-task.
