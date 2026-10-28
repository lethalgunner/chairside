# CLAUDE.md — Chairside

Clinic operating system for Indian dental practices. It is books-first, dental-native, and branch-aware from the first migration.
Owner/reviewer: KS (Kshitij Sharma). Domain partner: Dr. Anshul Vij. Working mode: **Claude writes, KS reviews.**

## Read before any work
0. **Current stage: Pilot 0 (parallel run).** `docs/PILOT0-SPEC.md` and ADR-012 override the V1 plan where they differ (no RLS yet, in-app password login, no providers table yet). `docs/QA-REPORT.md` has the latest test status; `docs/DEPLOY.md` the deploy steps.
1. `docs/V1-BUILD-PLAN.md` — the Phase 1 plan that follows Pilot 0.
2. `docs/PRD.md` — full product requirements, current state, backlog, open decisions.
3. `docs/DECISIONS.md` — ADR-001…011. ADR-007…011 change the schema and are not yet implemented.
4. `src/domain/slice.test.ts` — the whole vertical slice as one test. Then the header of `src/db/schema.ts`.

## Commands
```bash
npm ci
npm test            # vitest — must stay green (59 domain tests at handoff)
npm run typecheck   # tsc --noEmit — must stay clean
npm run dev         # next dev
npm run db:generate # drizzle-kit generate → ./drizzle (review the SQL, commit it)
npm run db:migrate  # apply ./drizzle to DATABASE_URL
npm run test:db     # service tests on DATABASE_URL_TEST (wiped each run; name must contain "test")
npm run build && npm run test:e2e   # Playwright on a production build; DB named *e2e* is recreated
npm run seed -- seed/demo.json      # invented demo org (seed/pilot0.json = the real clinic, fill in first)
npm run user:add -- --org "<org>" --email a@b.c --name "Name" --role front_desk --branch PUN
```
Local Postgres 16 is enough; set `PW_CHROMIUM` to a Chromium binary if Playwright can't download one.

## Non-negotiable conventions (a PR that breaks one is wrong, whatever else it does)
1. **Money is integer paise** (`Paise` from `src/domain/money.ts`). No floats and no decimal library. Rates are basis points. `allocate()` for every split. DB columns: `bigint` `*_paise`, rates `*_bp`.
2. **Tax lives on the invoice line**, snapshotted at issue. An unregistered branch charges no GST.
3. **CGST/SGST are a split of total tax** via `allocate()`, never two half-rate calculations.
4. **Balances are derived, never stored**: patient balance, invoice outstanding, receipt unallocated, day totals, stock.
5. **`orgId` on every row, `branchId` on everything operational.** Org-level patients. Gapless per-branch-per-FY numbering from a locked counter row. **Posted financial rows are never UPDATEd**: corrections are new documents.

## Architecture rules
- Domain logic is pure functions in `src/domain/*` with unit tests. Pages and actions never do money arithmetic.
- Only the data-access layer imports Drizzle or the schema. Every repository function requires a `TenantContext`. Feature code never queries raw.
- Only `src/lib/auth/*` handles identity. No Supabase-specific SQL. Row-level security is deferred until a second org exists (ADR-012); until then every query filters by `orgId` and the cross-org tests in `money-flow.db.test.ts` must stay green.
- Server actions start with `const ctx = await getContext(); if (!ctx) return signedOut('<name>');` (ADR-013), never `requireContext()`; any `next` URL goes through `safeNext()`.
- Every new table's migration must `ENABLE ROW LEVEL SECURITY` (no policies). This closes Supabase's public Data API; the app connects as owner and is unaffected (see `drizzle/0002_close_data_api.sql`).
- In `sql` templates, write outer columns of correlated subqueries fully qualified (`invoices.id`), never `${invoices.id}` (see `src/services/util.ts`).
- Permissions are checked by **capability** (`src/domain/permissions.ts`), never by role name (ADR-009).
- Every write to a mutable table goes through the audit wrapper.
- No `if (dental)` branching: use the specialty module registry.
- No FHIR shapes in core tables. No clinical detail in any WhatsApp message text. No real patient data anywhere.

## How to work
- One backlog item ≈ one branch + PR, small enough to review in 15 minutes. Branch names: `v1/<milestone>-<slug>`.
- Commit messages say *why*. Reference requirement IDs (BIL-02, FIN-01…) and ADRs.
- Tests ship in the same PR as the code. Money, tax, numbering, tenancy, permissions and audit changes need tests. No exceptions.
- Record any decision that would confuse someone later as a new ADR in `docs/DECISIONS.md`.
- Update `docs/QA-REPORT.md` at the end of each milestone (template in the build plan).

## Stop and ask KS (do not guess) when
- A change would alter a convention above, a GST treatment or rate, pricing/entitlements, or an accepted ADR.
- You need a secret, a paid account or an external setup: Supabase project, SMTP provider, hosting, Sentry, domain.
- A test reveals a domain-layer bug. Report it with a failing test first. Don't quietly change expected values.
