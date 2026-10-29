# Sprint 3 · "Front desk, done right" (CPO + CTO, 29 Oct 2026)

**Goal:** the front desk runs the whole visit in Chairside: the waiting room, a recall for the next visit, fixing a typo in a patient's details. The owner gets the two safety nets every serious clinic system has: resetting a forgotten password and exporting his own data.
**Base:** `main` at `7d958b3` (Sprints 1–2, committed, not yet pushed). **Research:** a token queue and walk-ins (Indian clinic tools; Dental Intelligence's live board of who's arrived, seated and ready); Open Dental's recall list (due date, last reminded, status); "own your data" export. See project doc `chairside-cpo-sprint-3.md`.

## Tickets
| ID | Ticket | Who uses it | Size |
|---|---|---|---|
| T36 | **Waiting room.** Add a patient to today's queue and they get a token (1, 2, 3… per branch per day). Waiting → In chair → Done, or Left. "Seen, not billed" flags patients marked Done with nothing billed or recorded today | Front desk, doctors, owner | M |
| T37 | **Next visit (recall).** Set "Next visit due" on a patient (check-up, cleaning, continue treatment, review). The Recalls page lists overdue and due-this-week, with Remind on WhatsApp, Booked and Change date | Front desk, doctors | M |
| T38 | **Edit patient details** (name, mobile, sex, age, referral), with the duplicate warning and an audit of what changed | Front desk, manager, owner | S |
| T39 | **Reset password link.** For someone who forgot a password they already set, the owner makes a one-time link in Settings → Team. No GitHub step | Owner | S |
| T40 | **Export my data.** Owner downloads patients, bills and payments as CSV files (opens in Excel) | Owner | S |
| T41 | **zod 4** (LET-164, security advisory), only if the whole suite stays green | — | S |

**Cut:** printing bills (Pilot 0 bills must never reach patients; it comes back at G1 with the real series); appointments with time slots (G1; the queue covers walk-ins now); a lab tracker (needs appointments).

## CTO constraints
- **Queue (`visits`)**: org, branch, patient, business date, token, status, timestamps, who. A token is unique per branch per day (unique index; a clash retries once). Today only: past days are read-only. Status moves forward, with one undo (In chair → Waiting). Every change is audited. **No complaint or clinical note** is stored. A patient can be in today's queue at a branch only once while waiting or in the chair.
- **Recalls**: at most one open recall per patient per branch (partial unique index); setting a new one closes the old. Kinds are generic words. The reminder text says "your next visit is due" with no treatment named (CLAUDE.md). Reminding uses `patient.remind`; setting a recall uses the new `recall.manage` (owner, manager, desk, doctors).
- **Patient edit** (`patient.edit`: owner, manager, desk): same validation as registration; changing the mobile runs the duplicate check. The audit keeps the before and after of the changed fields only. **Known limit:** bills don't yet snapshot the patient's name, so an edited name shows on old test-series bills too. Bills must snapshot the name at G1 (recorded in ADR-015).
- **Reset link**: owner only (`staff.manage`); target active, with an email, not yourself. It cancels older links. The old password keeps working until the link is used, and using it ends all sessions (existing invite flow). Audited as `staff.password_reset_link`.
- **Export**: owner only (new `data.export`). GET route handlers that re-check the session and capability, `Cache-Control: no-store`, attachment download. CSV cells starting with `= + - @` or a tab are prefixed with `'` (formula injection). Every export is audited with its kind and row count, never the data. Money is exported as rupees with 2 decimals, built from paise.
- New tables get `ENABLE ROW LEVEL SECURITY`. One migration `0006_sprint3`. Actions follow ADR-013.
