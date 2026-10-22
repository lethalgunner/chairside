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

## Pilot 0 · Slice 2 (owner settings) — 21 Oct 2026
**Branch:** `p0/owner-settings` from `pilot0` @ 87a8142 · **Tickets:** T14 team, T15 price list, T16 branches, T17 action timing · **Result:** pass, with Q5 still open (now better understood, below)

### Automated (run locally on Postgres 16 and Chromium, all executed)
| Suite | Tests | Pass | New in slice 2 |
|---|---|---|---|
| `npm test` (domain + run() logging) | 119 | 119 | +41: staff rules and staff.manage (14), price list rules (6), GSTIN/state codes/branch details and branch.manage (15), action timing log (6) |
| `npm run test:db` | 50 | 50 | +24: team (13: invite → redeem, existing login never reset, other-org email/branch refused, doctor record linked, owner only, new link cancels old, deactivate signs out, self and last-owner guards), price list (7: issued bill unchanged after price+rate edit, inactive item neither offered nor billable, code fixed/unique, exempt forced to 0 %, audit, access), branches (4: registration changes only later bills, wrong-state GSTIN refused, deregistering clears GSTIN, owner only) |
| `npm run test:e2e` (production build, `E2E_PORT=3200`) | 35 | 35 on a clean run | +9: `/settings*` in the anonymous sweep (4), front desk refused all settings screens (1), team invite → set password → deactivate signs out, price list item appears in and disappears from the bill builder, Kanpur marked GST-registered (wrong-state GSTIN refused first), axe on the four settings screens |
| `npm run typecheck` / `next build` | — | clean | |

E2E stability on this machine (2 CPUs, a second checkout running its own suite at the same time): 2 of 8 full runs fully green; every failure was a Q5 symptom in a step that waits for the UI after a server action, in old and new specs alike. The unchanged base (`ef24a5f`) failed 1 of 3 runs the same way, so this is not a slice 2 regression.

### Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| Q5 | S2 *(was S3 verify)* | After a server action succeeds, the follow-up client navigation or refresh sometimes never commits: the button stays on "Saving…", or the list does not update. Seen on register patient (router.push), cash paid out, branch switch and the new settings screens. T17's `[action]` lines show the action itself finishing in 1–60 ms every time; a trace shows the RSC request for the next page fired twice and neither applied. Removing `revalidatePath` or switching registration to a server-side `redirect()` did not fix it (6-run loops, 3 and 2 failures). | **Open — needs CTO**: client-side, not database or action time. Next step: reproduce outside Playwright load, then try `useActionState` + server `redirect()` across the board, or test on the current Next 15 patch |
| S2-1 | S4 | `e2e` port was hard-coded (3100), so two checkouts could not run side by side | Fixed: `E2E_PORT` |

### How to read the action log (T17)
Each server action logs one line, e.g. `[action] patient.register 15ms ok`, as a warning above 3000 ms. No arguments, results or error text are logged. Locally: `E2E_SERVER_LOG=1 npm run test:e2e`. In Vercel: function logs, filter `[action]`.

## Pilot 0 · Slice 3 (parallel-run ready) — 22 Oct 2026
**Branch:** `p0/parallel-ready` (on Slice 2) · **Result:** pass. Tickets T18–T24 cover every "before 26 Oct" row in `QA-TRIAGE-2026-10-21.md`.

### Automated (run locally on Postgres 16 and Chromium, all executed on the T24 commit)
| Suite | Tests | Pass |
|---|---|---|
| `npm test` (domain + action wrapper) | 168 | 168 |
| `npm run test:db` (services) | 63 | 63 |
| `npm run test:e2e` (production build) | 42 | 42 |
| `npm run typecheck` / `next build` | — | clean |

### Defects found while building T24
| ID | Sev | Summary | Status |
|---|---|---|---|
| S3-1 | S2 | "Record another payment" first showed ₹690 instead of ₹5,690: the page refreshes its open bills after saving, so the payment was subtracted twice | Fixed: the amount still due is fixed when the payment is sent; the golden path asserts ₹5,690 and the pre-filled box |

### Deploy note
Migration `0003_receipt_cancel` (adds three nullable columns to `receipts` and one ledger entry type) runs automatically on the next production deploy. It adds no table, so no RLS line is needed.
