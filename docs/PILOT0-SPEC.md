# Pilot 0 — Build Spec (CTO → Dev → QA)

**Owner:** CTO (how), CPO (what/UX). **Builder:** chairside-dev. **Verifier:** chairside-qa.
**Source plan:** project doc `chairside-cto-cpo-pilot0-parallel-run.md` (17 Oct 2026). **UX input:** `chairside-ux-qa-audit.md`.
**Goal:** a working, login-protected SaaS dashboard that the two Dr Vij branches (Kanpur, Pune) use in parallel with their incumbent software for a few days. The incumbent remains the legal record.

## Posture (ADR-012)
Disposable data, one org, books only. Deferred until their trigger: RLS + composite FKs (before org #2), PITR/downtime runbook/CA gate/DPA (before any clinic switches off the incumbent), MFA/PIN switch/append-only audit (before go-live or any non-family clinic), ADR-008/009 schema refactor (Phase 1). Kept: login on every page and action, invite-only, minimal personal data (name, phone, age, sex, referral), Indian hosting, secrets out of the repo, daily backup, test document series.

## Tickets (build in order; one commit each, tests in the same commit)

| # | Ticket | Acceptance |
|---|---|---|
| T1 | **DB foundation.** `src/db/client.ts`; schema changes (sessions, password hash, idempotency keys, document-type enum, derived receipt unallocated, branch tolerance and float, expense drawer flag, day-book tally fields, age-recorded date); first migration; `db:migrate`; test DB helper | Migration applies to empty Postgres 16; `npm run test:db` resets and runs |
| T2 | **Domain utils.** IST business date and FY; ADR-010 numbering with test series (≤16 chars, throws otherwise); Indian phone normaliser; capability map over the current role enum | Unit tests incl. 31 Mar 23:30 / 1 Apr 00:30 IST and the 16-char limit |
| T3 | **Auth.** `src/lib/auth`: scrypt password hashes, DB sessions (random 256-bit id, httpOnly cookie, 12 h sliding), login rate-limit, invite-only (`npm run user:add`), `requireContext()` + `TenantContext` with active branch; middleware redirect to `/login` | Anonymous request to any page redirects; anonymous server action is refused |
| T4 | **Services.** `src/services/*` — patients (register, search, dupes), catalogue, invoices (issue with row-locked gapless numbering, idempotency, ledger entry, auto-apply same-branch advances, void with reversal), receipts (allocation preview, allocate, advance, idempotency, closed-day guard), day books (reconcile, cash out, close, owner reopen, tally), reports (dashboard, unbilled, receivables, GST), audit writes | DB tests: parallel issues → contiguous numbers; double submit → one document; receipt on closed day rejected; balance = Σ ledger |
| T5 | **Seed.** `npm run seed` from `seed/pilot0.json`: Dr Vij org, Kanpur (UP) + Pune (MH) with GST status, catalogue covering every tax category, staff and doctors | Idempotent re-run |
| T6 | **App shell & states.** Login page; sidebar with branch switcher (multi-branch users may pick "All branches" for viewing only); global patient search; `loading/error/not-found`; dev and sales copy removed; `Link` navigation | No route renders a raw error; no "dev seed" text |
| T7 | **Patients.** Search-first list; registration with phone normalisation, server-returned duplicate matches with override, no visible timer; patient page with ledger, "New bill", "Record payment" | UX F3, F4, F7, F11 closed |
| T8 | **Bill builder.** Doctor + catalogue items (type-to-filter), qty, discount with reason, live totals with exempt/taxable split; "Issue bill" or "Save as unbilled"; confirmation shows branch, patient, number | Golden-path figures match hand calculation |
| T9 | **Receipts.** Mode, reference, amount; allocation sentence before confirm; overpayment kept as advance explicitly | Preview equals saved result |
| T10 | **Day close.** Expected cash, denomination count, cash paid out, variance + reason above tolerance, tally vs old system, lock; owner reopen with reason | Locked day blocks receipts and bills; reopen audited |
| T11 | **Reports.** Dashboard (branch or all), invoices list, invoice page (pay/void), unbilled (bill these), receivables, GST papers labelled "test — not for filing" | All read from DB |
| T12 | **QA.** Playwright golden path against a production build with hand-calculated figures; anonymous-access sweep of every route | Green locally; report in `docs/QA-REPORT.md` |
| T13 | **Deploy readiness.** `docs/DEPLOY.md` (Supabase Mumbai + Vercel bom1), env names, migrate-on-deploy, user creation | KS can deploy in under an hour |

## Not in Pilot 0
Appointments, clinical notes, diagnoses, prescriptions, estimates, attachments, import, WhatsApp, PDFs, payouts, Tally, RLS, MFA, PIN switch, providers table, subscription billing.
