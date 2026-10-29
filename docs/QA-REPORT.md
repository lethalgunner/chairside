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

## Production check and Slice 2–3 QA pass — 28 Oct 2026
**Deployed:** `12bb11a` on GitHub `main`; Vercel built it and applied migration 0003 (journal entry 4) to the Mumbai database. **Live checks:** `/api/health` ok; signed-out visits redirect to sign-in; a bad invite link says it has expired or was used; responses come from `bom1`.
**Not run on production:** anything behind sign-in (QA does not hold production credentials). The signed-in pass ran on the same commit as a local production build with the demo seed, at 1366 px and 390 px, with axe on every screen.

### Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| Q24 | S2 | Inviting an email that already has a login renamed that person to whatever name was typed ("Dup Person" renamed Priya); the confirmation showed the typed name, so the owner could not tell | Fixed: the name is never changed on that path; the message names the real person and says whether a role was added or nothing changed. 2 DB tests |
| Q25 | S3 | Team and Price list scrolled sideways on a 390 px phone (144 px and 232 px); Price list's Edit/Deactivate were off-screen | Fixed: both tables stack per row below 600 px. e2e asserts no overflow and Edit in view |
| Q26 | S3 | No browser security headers in production: framing allowed, no nosniff, no referrer policy, `X-Powered-By: Next.js` | Fixed: X-Frame-Options DENY, frame-ancestors 'none', nosniff, Referrer-Policy same-origin (keeps `/setup?token` out of Referer), Permissions-Policy; powered-by off. e2e checks three routes |
| Q27 | S3 | Day close said "Matches" when only the collected amount was entered (bill count blank) | Fixed: "Collected matches; enter the old system's bill count too", not counted as a match. Unit test |
| Q28 | S4 | Bill-count box silently turns "-2" into 2 (digits-only mask) | Accepted: numeric keypad field; no change |

### Clean
Axe: no serious or critical issues on 13 screens at both widths. Desk sees plain "Only the owner can…" on every settings page. Payment amount: "1,000.555", "-100", "0", "1e3" refused with a message; "Rs.1000/-" accepted. Price list: duplicate code, bad price, short HSN refused; "500/-" accepted. Split payment pre-fills ₹3,500 after ₹1,000 of ₹4,500.

### Automated (after fixes, all executed)
169 unit · 65 database · 44 browser · typecheck and build clean.

## Sprint 1 · Pilot-ready (T25–T30) — 28 Oct 2026
**Built by:** four dev agents in parallel worktrees; integrated by the CTO (one migration `0004_sprint1`, ADR-013). **QA:** exploratory sweep on the merged build (production build, demo seed, 1366 and 390 px, owner and front desk), axe on every new screen, plus each ticket's own tests.

### Automated (final tree, all executed)
| Suite | Tests | Pass |
|---|---|---|
| `npx vitest run` | 261 | 261 |
| `npm run test:db` | 94 | 94 |
| `npm run test:e2e` | 70 | 70 |
| typecheck / `next build` | — | clean |

### Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| S1-Q1 | S2 | Paste from Excel rejected the GST treatment names the price list itself shows ("Healthcare service", "Prosthetic / implant", "Retail product"), so a list copied out of Chairside failed on every row | Fixed: those names accepted; unit test |
| S1-Q2 | S3 | Integration: three actions added in parallel used the old redirecting session check, so an expired session would bounce instead of saying "signed out" | Fixed at merge (ADR-013 rule, CLAUDE.md) |
| S1-Q3 | S4 | "Pick a branch in the sidebar" copy on 8 screens; phones have no sidebar | Fixed: "in the branch menu" |
| S1-Q4 | S4 | Scorecard e2e depended on which earlier specs had left activity | Fixed: window pinned to today |

### Checked and clean
- Paste: CRLF lines, "Rs. 1,500", "₹ 18,000", "320/-", "5%", trailing tabs, a non-breaking space, blank lines; missing price and a 7% rate refused per row; Save disabled until clean; all-or-nothing.
- Scorecard: default last 5 days; bad, reversed and >31-day ranges explained; front desk refused; stacks at 390 px.
- Past days: future, garbage and >400-day dates fall back to today; yesterday shows the banner and no create, close, cash-out or reopen controls on dashboard and day close.
- Bills "Today": subtotal matches hand figures (₹10,690 billed; UPI ₹5,000 + Cash ₹2,000 = ₹7,000).
- Cancel: the confirm button stays disabled until a reason and "Was this work done?" are given; "No" keeps the work off Unbilled. Front desk sees no "Not done: remove".
- Signed-out: crafted `next` values sign in to `/`; the expired message shows.
- Axe: no serious or critical issues on any new screen at either width; no sideways scroll at 390 px.

### Open (decisions, not defects)
- Scorecard counts only days with activity (a shut day doesn't count against the clinic). CPO to confirm.
- After a real 12-hour timeout the browser has already dropped the cookie, so a plain page load shows no "signed out" message; a form submit always does.
- GST 40% is accepted by paste as by the item form; rates still need a CA.

## Sprint 2 · "Money in, on WhatsApp" (T31–T35) — 29 Oct 2026
**Built:** UPI scan-to-pay QR on the bill and Record payment (T31); WhatsApp dues reminder on Receivables and the patient page, with a reminder log (T32); WhatsApp day summary after close (T33); amount in words, Indian numbering (T34); day-close streak on Today (T35). Migration `0005_sprint2`, ADR-014. **QA:** sweep on the production build at 1366 and 390 px, light and dark, owner and front desk; axe on every new screen; QR decoded from screenshots with OpenCV.

### Automated (final tree, all executed)
| Suite | Tests | Pass |
|---|---|---|
| `npx vitest run` | 293 | 293 |
| `npm run test:db` | 104 | 104 |
| `npm run test:e2e` | 73 | 73 |
| typecheck / `next build` | — | clean |

### Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| S2-Q1 | S3 | Receivables at 390 px: the new Follow up column squeezed the table, and the patient name scrolled off the side | Fixed: Receivables uses the phone stack layout; the tick panel wraps |
| S2-Q2 | S3 | UPI link percent-encoded the `@` in the UPI ID; some UPI apps don't decode `%40` in `pa` (*verify* on real phones) | Fixed: `pa` unencoded and re-validated; test for parameter smuggling |
| S2-Q3 | S4 | One cold-start run timed out waiting for "saved" on Settings → Branches (3 reruns green) | Test waits 15 s for the first save |

### Checked and clean
- QR decodes to `upi://pay?pa=demokanpur@okicici&pn=Demo%20Dental%20Kanpur&am=500.00&cu=INR&tn=DKNT/26-27/00001` (OpenCV, light and dark; white field kept in dark mode).
- A branch without a UPI ID shows no QR; a fully paid bill shows none.
- Reminder text: first name, branch, amount, UPI ID; never the treatment, surname or doctor. The amount is recomputed on the server; nothing due → refused. Accountant, another branch's desk and another organisation are refused.
- Pilot 0 tick blocks "Open WhatsApp" until checked; keyboard reaches the button and the tick.
- Day summary for Demo Pune matches the golden path by hand: ₹10,690 billed, ₹7,000 collected (UPI 5,000, cash 2,000), ₹100 paid out, drawer short by ₹50, "98 bills may be missing".
- Amount in words: lakh and crore, paise, zero (unit tests); "Rupees Five Hundred only" on screen.
- No sideways scroll at 390 px on the bill, patient, receivables or day-close screens.

### Not verified
- Scanning the QR with real UPI apps (GPay, PhonePe, Paytm, BHIM) and paying ₹1. KS to do this once with the clinic's real UPI ID before staff use it.
- `npm audit` reports a high-severity advisory in `zod` < 4.6.6 (memory exhaustion on oversized collections). It predates Sprint 2, and the fix is a breaking major upgrade. Logged for the CTO.

## Sprint 3 · "Front desk, done right" (T36–T41) + QA from scratch — 29 Oct 2026
**Built:** waiting room with tokens and "seen, not billed" (T36); next-visit recalls with a WhatsApp reminder (T37); edit patient details (T38); owner password reset link (T39); owner CSV export (T40); zod 4 (T41). Migration `0006_sprint3`, ADR-015.
**QA from scratch:** every screen (16 routes) as owner, Pune desk and Kanpur desk, at 1366 and 390 px, on the production build. Each screen was checked for server errors, browser console errors, sideways scroll, a single page heading and axe (WCAG 2.1 AA, serious or critical), then the full regression suite ran.

### Automated (final tree, all executed)
| Suite | Tests | Pass |
|---|---|---|
| `npx vitest run` | 302 | 302 |
| `npm run test:db` | 118 | 118 |
| `npm run test:e2e` (incl. `12-sprint3`) | 77 | 77 |
| Whole-app sweep (3 roles × 2 widths × 16 screens) | 6 | 6 |
| typecheck / `next build` / `npm audit --omit=dev` | — | clean / clean / 0 |

### Defects
None open from this pass. All 96 screen checks in the sweep came back clean: no console errors, no sideways scroll, no serious axe issues.

### Checked and clean
- Tokens 1, 2, 3 per branch per day; Kanpur counts its own; a second active visit is refused with its token; finished visits and past days can't change.
- "Seen, not billed" appears when a patient is marked Done with nothing billed, and clears when the bill is issued.
- A recall replaces the open one; overdue, due-today and this-week buckets; the WhatsApp text never names the treatment; Booked closes it.
- Patient edit audits only the changed fields; a new mobile triggers the duplicate warning; the age is re-recorded with today's date.
- Reset link: the old password keeps working until the link is used, then sessions end. A manager, yourself, a person with no password set, and another clinic are all refused.
- Export: CSV with BOM, money from paise, a formula name defused (`'=Evil…`), owner only (the desk gets 403), audited with the count only.

### Not verified
- The real 12-hour session expiry on the live site, and real UPI apps (carried over from Sprint 2).
- Dev-only `npm audit` advisories (vitest, esbuild, tinypool): not in the production bundle; logged for the CTO.
