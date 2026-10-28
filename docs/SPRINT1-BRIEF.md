# Sprint 1 · Pilot-ready (CPO call + CTO brief, 28 Oct 2026)

**Goal:** the clinics start the parallel run on a deployed build with real prices and logins, and the week can be scored against the Pilot 0 success criteria without argument.
**Base:** `main` at `201907a` (deployed). **Source of scope:** project doc `chairside-cpo-sprint-1.md`, QA findings Q13/Q18/Q19/Q20 in `docs/QA-REVIEW-2026-10-21.md`, CPO triage `docs/QA-TRIAGE-2026-10-21.md`.
**Out of scope:** Q22 polish; everything G1 (RLS, OTP, appointments, print, import wizard, patient edit).

## Tickets
| ID | Ticket | Who uses it | Size |
|---|---|---|---|
| T25 | Paste the price list from Excel | Owner, once per clinic | S |
| T26 | Pilot scorecard + a small usage log | Owner, KS at the end of the week | M |
| T27 | Past days read-only on dashboard and day close; Bills "Today" filter with totals by mode (Q19) | Owner, front desk | M |
| T28 | Cancelled bill: "Was this work done?"; Unbilled "Not done: remove" with reason (Q20) | Owner, manager | S–M |
| T29 | Session expired mid-form: message and return to the page (Q13) | Everyone | S |
| T30 | Phone: nav wraps; owner's all-branches table and Bills list stack; phone copy (Q18, narrowed) | Owner on a phone | S–M |

## CTO constraints (apply to every ticket)
- Conventions in `CLAUDE.md` hold: integer paise, line tax snapshot, derived balances, org/branch ids, append-only money, capability checks (never role names), audit on every write to a mutable table, thin actions, logic in `src/services` + `src/domain`.
- **No patient data in the usage log** (T26): kind, user id, branch id, duration ms, timestamp only. No names, phones, amounts.
- **Open redirect** (T29): `next` accepts only a same-origin relative path starting with a single `/` (reject `//`, `/\`, schemes, encoded variants); anything else falls back to `/`.
- **Import limits** (T25): at most 500 rows and 200 KB per paste; all-or-nothing in one transaction; owner-only (`catalogue.manage`); each row goes through the existing catalogue validator; existing codes are updated only when the preview says "will update".
- **Read-only past days** (T27): a `?date=` is validated (ISO date, not in the future, within 400 days); every create action stays tied to today; a past day never offers Close, Cash out, Bill or Payment.
- **Dismissing unbilled work** (T28): owner or branch manager only (new capability, not front desk: the leakage figure is the owner's measure), reason required, audited; the procedure row is marked, never deleted.
- New tables get `ENABLE ROW LEVEL SECURITY` in their migration. Migrations are generated with `npm run db:generate` and reviewed; the integrator consolidates parallel migrations into one before merge.
- Every ticket ships its tests (unit for domain, DB for services incl. permission refusals, e2e for the flow) and keeps axe clean at 1366 and 390 px.
