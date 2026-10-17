# Chairside v1 — Build, Test & QA Plan

**Assignment for Claude Code.** v1 = **Sprint 0 (schema reconciliation) + Phase 1 (working backend and demo)** from `docs/PRD.md`.
**Date issued:** 17 Sep 2026 · **Reviewer:** KS · **Starting point:** `main` @ handoff (59 domain tests green, typecheck clean, UI over an in-memory seed, no DB, no auth).

## 1. What "v1 done" means

A person with a login can open a URL on their phone and run the walk-in journey end to end against real Postgres:

> register patient → record encounter + procedures → issue a mixed exempt/taxable invoice → take a part payment (UPI + cash) → see the derived ledger → close the day with a cash variance → owner reopens it (audited)

All of the following hold:
- Every automated suite in §4 is green in CI.
- The QA checklist in §5 has been executed and recorded in `docs/QA-REPORT.md`.
- No open **S1/S2** defects (§6).
- A demo org is seeded idempotently.
- The app is deployed, or, if KS hasn't supplied hosting/secrets yet, deploy-ready with a written runbook (§7).

**Out of scope for v1:** odontogram/perio, treatment plans, inventory, payouts, P&L, Tally, WhatsApp BSP, ABDM, import wizard. Don't build them. Do leave the hooks the PRD asks for (e.g. `specialtyModuleId`, BOM field).

## 2. Local & CI infrastructure (set up first)

| Need | Approach |
| --- | --- |
| Postgres for dev/tests | `docker-compose.yml` with `postgres:16`. If Docker isn't available in your environment, install Postgres natively (e.g. `apt-get install postgresql`). Use `DATABASE_URL` for dev and `DATABASE_URL_TEST` for tests. **Do not use PGlite for integration tests**: numbering concurrency needs real multi-connection Postgres. |
| Migrations | `drizzle-kit generate` → committed SQL in `./drizzle`. Apply with a `db:migrate` script (drizzle-orm migrator), never `db:push`, outside local scratch. |
| Test DB isolation | Each integration test file runs in a fresh schema or truncates between tests. Tests must be order-independent and parallel-safe. |
| Auth in dev/test | `src/lib/auth` defines an `AuthProvider` interface with two adapters: `supabase` (real) and `test` (in-memory; codes readable via a helper). The `test` adapter must be **impossible to enable in production**: guard on `NODE_ENV` and add a unit test for the guard. |
| CI | `.github/workflows/ci.yml`: Postgres service container → `npm ci` → `lint` → `typecheck` → `test` → `test:db` → `build` → `test:e2e` (Playwright, Chromium, desktop + Pixel viewport). Upload the Playwright report on failure. |
| Tooling to add | `@playwright/test`, `fast-check` (property tests), ESLint with a `no-restricted-imports` rule (Drizzle/schema only in the data layer, Supabase only in `src/lib/auth`). |

## 3. Milestones (in order; each ends with a green CI run and a QA-REPORT entry)

### M0 — Foundations & CI
1. Docker/Postgres setup, `.env.example` updated, `db:migrate`, `test:db`, `test:e2e`, `lint` scripts.
2. CI workflow as above. Fix `npm run seed` (currently points at a missing file).
3. ESLint import boundaries.
4. Rename default branch to `main` if not already.

**Accept:** CI green on the untouched 59 domain tests; a deliberately bad import (e.g. Drizzle in a page) fails lint.

### M1 — Sprint 0 schema reconciliation (PRD §6; ADR-007…011)
1. `providers` + `provider_memberships`. Repoint every `doctorId` FK to providers. Move council registration number to providers. Add `engagementType`.
2. Roles → `owner, branch_manager, doctor, clinical_assistant, front_desk, accountant, auditor`. Add `memberships.expiresAt`. Owner grants are org-wide only.
3. `encounters`: `encounterType`, `specialtyModuleId`, `soapNote` (not null), structured `diagnosisCodes` `{system, code, display, freeTextSupplement}[]` + Zod schema in `src/domain/clinical.ts`. `specialty_modules` seed table. `catalogue_items.specialtyModuleId`. `branches.activeSpecialtyModules`.
4. Drop `receipts.unallocatedPaise` (derive it). `invoice_series.documentType` enum `sale | receipt | credit_note`. Branch code: exactly 3 `[A-Z0-9]`, immutable after the first issued document.
5. `src/domain/permissions.ts`: the ADR-009 capability matrix as data + `can(ctx, capability, branchId)`.
6. `src/domain/numbering.ts`: ADR-010 formatter + Indian FY derivation from a date (April start, Asia/Kolkata) + document-title rule (tax invoice / bill of supply / invoice-cum-bill of supply / plain bill).
7. Generate migration `0000`. Review the SQL: no RLS, no Supabase-only constructs.

**Tests (unit):**
- Every matrix rule listed in ADR-009's "at minimum" set.
- Formatter at 99,999 and just past it (throws); the 16-character limit for all three series.
- FY boundary: 31 Mar 23:59 IST vs 1 Apr 00:00 IST, including a UTC instant that falls on different dates in UTC and IST.
- Document title for each line mix and for an unregistered branch.
- Diagnosis Zod schema rejects free-text-only entries without `system`/`code` unless explicitly marked uncoded.

### M2 — Data layer, tenancy, audit
1. `src/db/client.ts`. A repository layer (`src/server/repo/*`) whose functions all take `TenantContext`.
2. Audit wrapper: mutable-table writes record `before`/`after`, actor, org, branch.
3. Same-state GST consistency: two branches in one state cannot disagree on registration/GSTIN.
4. Demo seed (`npm run seed`, idempotent): org "Demo Dental Group" with branches **KNP** (Kanpur, UP, GST-registered, invented GSTIN) and **PUN** (Pune, MH, unregistered); providers incl. one visiting associate; users for every role; ~12 invented patients (one intentional near-duplicate pair); a dental catalogue covering all tax categories; one historic invoice with an ageing balance.

**Tests (DB integration):**
- **Tenancy leak suite:** for every repository function, org-B context gets not-found or forbidden for org-A ids (reads *and* writes). Generate the cases from the repository export list so a new function without a leak test fails CI.
- Branch scoping: branch_manager of KNP cannot read PUN operational data; owner can.
- Audit row is written on demographic edit with a correct before/after diff.
- Seed runs twice with no duplicates.

### M3 — Auth & RBAC
1. `AuthProvider` interface: `requestCode(email)`, `verifyCode(email, code)`, `getSession()`, `signOut()`. Supabase adapter (email OTP with a `{{ .Token }}` template) plus the test adapter.
2. Invite-only: unknown emails get the same generic response as known ones (no enumeration). Rate-limit code requests per email and IP.
3. Middleware resolves `TenantContext` from session → user → memberships (ignoring expired grants). A branch switcher for multi-branch users.
4. Field-level financial permissions enforced in repository queries (doctor sees own production only).
5. Login screen and signed-out states; the existing UI style kept.

**Tests:**
- Unit: generic response for known vs unknown email.
- Unit: expired membership ignored.
- Unit: the test adapter refuses to load when `NODE_ENV=production`.
- E2E: login flow with the test adapter.
- E2E: a front_desk user gets 403 or a hidden route for `/gst` and branch financials (verify server-side via direct request, not just UI).

### M4 — Replace the seed: patients, catalogue, encounters
1. Delete `src/lib/store.ts` and the in-memory seed usage. Every page reads through repositories.
2. Patient registration persisted: branch file number, duplicate detection in SQL (normalised phone exact + name similarity via `pg_trgm` or normalised Levenshtein), acknowledgement flow kept, referral source.
3. Service catalogue CRUD (owner/branch_manager) with tax category, HSN/SAC, rate, specialty module, BOM placeholder.
4. Encounter at the chair: type, SOAP note, diagnosis typeahead over a static ICD-10 subset (ship a small JSON of common dental codes, K00–K14) with free-text supplement, procedures attributed to a provider with optional tooth/surfaces.

**Tests:**
- DB: duplicate detection finds same-phone/similar-name and doesn't flag a different person on a shared family number without the name match.
- DB: registration at KNP is findable from PUN.
- E2E: registering a patient takes ≤ 8 user actions (a proxy for the 40-second target; record the timing in QA).

### M5 — Money: invoice, receipt, ledger, day close
1. **Invoice builder** from unbilled procedures. Line discount + reason code + approval threshold (configurable per branch; above it needs `discount.approve`). Draft editable. **Issue** in one transaction: lock `invoice_series` row `FOR UPDATE` → number → run `computeInvoice()` → snapshot every tax field on lines → document title → ledger entries → link procedures. Issued = immutable. Void = keeps its number, visible, reversing ledger entry.
2. **Receipt** with every payment mode and a live `allocateReceipt()` preview before save. Own series. Receipt + allocations + ledger in one transaction. **A receipt dated on a locked day is rejected.**
3. **Ledger** page derived on read across branches, plus a shareable statement page behind a signed, expiring URL.
4. **Day close** via `reconcileDay()`: denomination count, variance tolerance per branch, reason required above tolerance, lock. **Owner-only reopen** with reason, audited.
5. **Unbilled** and **Receivables** pages on real data. **GST working papers** page on real data, labelled "Draft — not tax advice".
6. WhatsApp share = `wa.me` deep link containing only the signed statement URL and the clinic name. No amounts or clinical text in the message.

**Tests — this is where most QA effort goes:**
- **Property tests (fast-check) over the domain:**
  - For random line mixes, Σ line totals + rounding = invoice total.
  - CGST + SGST = line tax exactly.
  - An unregistered branch has zero tax on every line.
  - Allocation never over-allocates, and Σ allocations + unallocated = receipt amount.
  - Balance from ledger = Σ outstanding − Σ unallocated.
- **DB invariants after every E2E run:** a SQL "reconciliation check" script asserting the same identities over the whole database. Run it in CI after `test:e2e`.
- **Gapless concurrency:** issue 50 invoices in parallel on one branch with ~10% forced rollbacks. Resulting numbers are exactly 1..N-committed, contiguous, no duplicates. Same for receipts. Two branches in parallel don't interfere.
- **Immutability:** attempting to update an issued invoice/line/ledger row through the repository throws. Add a DB trigger or a test that scans for UPDATE paths on posted tables.
- **Snapshot:** change a catalogue rate after issue; the issued invoice and GST papers are unchanged.
- **Day lock:** a receipt posted to a locked date fails. Reopen by a non-owner fails. Reopen by owner writes audit.
- **Permissions:**
  - discount above threshold by front_desk is blocked;
  - doctor cannot view another doctor's production;
  - accountant cannot open a patient's clinical record.
- **E2E golden path (Playwright, desktop + mobile viewport):** the full journey in §1 using seed users for each role, ending with an assertion of the exact rupee figures on the ledger and day-close screens. Use a fixed invoice so expected numbers are known in advance, e.g.:
  - RCT ₹4,500 exempt
  - crown ₹6,000 at 12%
  - toothbrush ₹120 at 18%
  - 10% discount on the crown with a reason
  - part payment ₹5,000 UPI + ₹2,000 cash
  - counted cash ₹50 short with a reason

  **Compute the expected values by hand in the test file's comments** so the test doesn't just echo the engine.

### M6 — Deploy-readiness & hardening
1. Observability: Sentry (or equivalent) behind env; structured request logging; `/api/health` checking DB connectivity.
2. Security pass:
   - OWASP top-10 review of server actions (authz on every action, CSRF posture of server actions, input validation with Zod);
   - secure headers;
   - no secrets in the client bundle (grep the build output);
   - the signed statement URL expires and is unguessable.
3. Performance: seed a large org (e.g. 20k patients, 100k ledger entries) with a script. Ledger and dashboard server response p95 < 400 ms locally. Add indexes where EXPLAIN shows sequential scans.
4. Accessibility and responsiveness: axe check in Playwright on core pages (no serious or critical issues); layouts verified at 360 px, 768 px and 1280 px; dark mode.
5. **Deploy runbook** `docs/DEPLOY.md`: Supabase Mumbai project, custom SMTP, migrations on deploy, env vars, seed demo org, PITR enablement, and a restore drill procedure. **Stop and ask KS for accounts/secrets.** Do not create paid accounts.

## 4. Automated test suites (definition)

| Suite | Tool | Scope | Runs |
| --- | --- | --- | --- |
| `test` | Vitest | Pure domain units + property tests | Every push |
| `test:db` | Vitest + real Postgres | Repositories, tenancy, audit, numbering concurrency, immutability, invariants | Every push (CI service container) |
| `test:e2e` | Playwright | Golden path, auth, permissions, mobile viewport, axe | Every PR |
| `check:reconcile` | SQL script | Whole-DB money identities | After `test:e2e` in CI; also a manual command |
| `lint` / `typecheck` / `build` | ESLint / tsc / next | Import boundaries, types, production build | Every push |

Coverage goal: ≥ 95% lines on `src/domain/*`, and every repository function covered by at least one tenancy test. Coverage is a floor, not the target: the invariants are the target.

## 5. Manual QA checklist (execute before declaring v1; record results)

Run against the seeded demo org, on a desktop browser and on a real phone or mobile emulation.

**Registration & patients**
- [ ] New patient registered in < 40 s by a first-time user (time it)
- [ ] Invalid mobile numbers rejected with clear messages (9 digits, starts with 5, letters)
- [ ] Near-duplicate shown, acknowledged, created. An exact family-number case handled sensibly
- [ ] Patient registered at KNP found from PUN

**Clinical**
- [ ] Encounter with coded diagnosis + free text, two procedures, tooth numbers
- [ ] Clinical assistant can draft but not sign

**Invoice**
- [ ] Mixed invoice shows the correct document title, HSN/SAC per line, CGST/SGST split, rounding line
- [ ] Unregistered-branch invoice shows no GST
- [ ] Discount above threshold requires approval
- [ ] Issued invoice cannot be edited. Void keeps the number
- [ ] Numbers match ADR-010 format and are contiguous

**Receipts, ledger, day**
- [ ] Allocation preview matches the saved result
- [ ] Ledger balance matches hand calculation; statement link opens signed-out and expires
- [ ] Day close with a variance requires a reason; lock blocks new receipts; owner reopen audited

**Security & roles**
- [ ] Each seeded role logs in and sees only what ADR-009 allows. Try direct URLs, not just menus
- [ ] Cross-org id in a URL returns not-found

**UX**
- [ ] 360 px phone: every golden-path screen usable, no horizontal scroll
- [ ] Dark mode legible
- [ ] Slow 4G throttle: pages usable, no double-submit on issue/receipt (idempotency or disabled buttons)

**Resilience**
- [ ] Double-click "Issue" produces one invoice
- [ ] Refresh mid-flow does not duplicate a receipt
- [ ] DB restart during use: app recovers, health endpoint reflects it

## 6. Defect severity

| Sev | Meaning | Examples | v1 gate |
| --- | --- | --- | --- |
| S1 | Money, tax, tenancy, or data-loss error | Paisa drift, gap in numbering, cross-org read, posted row mutated | Must be zero |
| S2 | Core journey blocked or permission wrong | Can't close day, front desk sees P&L | Must be zero |
| S3 | Degraded but workaround exists | Confusing error, slow page | Listed with plan |
| S4 | Cosmetic | Alignment, copy | Listed |

**An S1 found in the domain layer:** write the failing test, stop, and report to KS before changing expected values.

## 7. External dependencies that need KS

| Item | Needed for | Until then |
| --- | --- | --- |
| Supabase project (Mumbai) + keys | Real auth, hosted DB | Local Postgres + test auth adapter |
| SMTP provider (Resend/Postmark/SES) + domain | Emailed codes beyond ~2/hour | Test adapter |
| Hosting choice (ADR-012) | Public URL | `next build` + `next start` verified locally; runbook written |
| Sentry DSN | Error tracking | No-op when unset |
| Practising CA review (Q4) | Any customer-facing GST claim | GST screens labelled draft |

## 8. `docs/QA-REPORT.md` template (append one section per milestone)

```markdown
## M<n> — <name> — <date>
**Commit:** <sha> · **CI:** <link> · **Result:** pass / pass with issues / fail

### Automated
| Suite | Tests | Pass | Fail | Notes |
### Manual checks executed
- [x] … (evidence: screenshot path or note)
### Defects
| ID | Sev | Summary | Status |
### Invariants
check:reconcile output: <pasted>
### Decisions / ADRs added
### Questions for KS
```

## 9. Final hand-back to KS

A PR (or a tagged `v1.0.0-rc1` if working on `main`) containing:
- a summary of what shipped against §1;
- `docs/QA-REPORT.md` complete;
- screenshots of the golden path at desktop and 360 px;
- the list of open S3/S4 items;
- the exact steps KS must do to go live (§7).
