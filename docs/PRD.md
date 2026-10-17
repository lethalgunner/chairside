# Chairside — Build PRD & Handoff for Claude Code

> **Read this whole file before writing code.** It is the single source of truth for continuing the Chairside build. It consolidates every prior thread in the *Dr Vij Dental Center* project: the BRD v0.2, the financial model, the Architecture Blueprint, `PRD.md` v1.0, `docs/PRD-phase0-books.md`, `docs/DECISIONS.md`, the Linear backlog (`linear-import.csv`, 108 tickets) and the actual state of the repository at commit `a7aee00`.
>
> **Version** 1.2 (handoff; roles, numbering and auth decided — ADR‑007…011) · **Date** 17 September 2026 · **Owner** Kshitij Sharma (KS) · **Domain & sales partner** Dr. Anshul Vij
> **Working mode:** Claude writes, KS reviews. Small, reviewable commits. Tests are a deliverable, not an afterthought.

---

## 0. TL;DR for the agent

1. **Product:** Chairside — a multi-tenant practice management + books + EMR system for Indian dental clinics (solo and 1–10 branch chains), built to extend to aesthetics/dermatology and later multi-specialty hospitals.
2. **Wedge:** the books. Clinical record and cash book are the same record. Nobody in this market closes a day book, reconciles UPI, computes associate payouts net of lab cost, or splits exempt treatment from taxable goods correctly. That seam is the product.
3. **Where we are:** a tested domain layer (money/tax/ledger, 59 tests passing, typecheck clean), a full Phase‑0 Drizzle schema (never migrated), and 9 Next.js screens running over an **in-memory seed** hung off `globalThis`. **No database, no auth, no deploy.**
4. **What to build next:** **Phase 1 — Working backend and demo.** The walk-in journey (register → encounter/procedure → mixed exempt/taxable invoice → part payment → ledger → day close) persisted in Postgres, behind auth, deployed at a URL that opens on a phone.
5. **Before Phase 1 feature work:** do **Sprint 0 reconciliation** (§6) — the schema predates PRD v1.0 in several places and those gaps are cheapest to close before the first migration is ever applied.
6. **Never break the five conventions in §3.** They are the product.

---

## 1. Context the agent needs

### 1.1 The business

| Item | Decision |
| --- | --- |
| Segment | Solo clinics **and** chains. Architecture is branch-aware from the first migration; a solo clinic simply has one branch and never sees the feature. |
| Vertical sequence | Dental first → aesthetics/derma → (much later) hospital. Modular from day one. |
| Distribution | Dr. Anshul Vij's doctor network (realistically 50–200 clinics). |
| Price | ₹10,000/clinic/year is the **land price** for a books tier, not the price list. Module ladder: Clinic ≈ ₹24,000, Chain ≈ ₹42,000; blended ARPU must reach ₹18–24k. |
| Unit economics (model v1) | ~78% gross margin; contribution ₹7,909/clinic/yr at ₹10k. Breakeven: 43 clinics (no salaries) · 88 (one support hire) · 400 (an engineer) · 1,111 (full company at ₹10k) · 560 at ₹18k · 408 at ₹24k. |
| GST on our subscription | 18%, and dental clinics make exempt supplies so cannot reclaim it — ₹10k is an ₹11,800 decision. Below ₹20L turnover we need not register. |
| Cost sensitivity | At a ₹10k land price, **WhatsApp per-conversation cost and infra are real unit-economics lines.** Prefer cheap, boring infrastructure. |

### 1.2 The design-partner clinic

Dr. Vij Dental Clinic & Implant Center, two real branches — useful for realistic demo data shapes (never real patient data):

- **Govind Nagar, Kanpur** (Uttar Pradesh)
- **Gahunje, Pune** (Maharashtra) — Shop 107, Nawu Imperio, next to Lodha Belmondo

Doctors: Dr. Anshul Vij (orthodontist, implantologist) and Dr. Richa Vohra Vij (endodontist, paediatric). Two branches in **two different states** means two separate GST registrations/profiles — a real-world case the branch model must handle cleanly. The current seed uses invented branches (Kothrud, Baner) and invented data; real artefacts from the clinic will follow.

> The *Dr. Vij Dental — Website Phase 1* project (single-page marketing site, `dr-vij-dental.html`, Calendly booking) lives in the same folder and Linear workspace but is **a separate product**. Do not mix it into this codebase.

### 1.3 Personas

| Persona | Role | Needs |
| --- | --- | --- |
| Owner / principal dentist | Economic buyer | Which clinic made money last week, and why. The Sunday-evening dashboard. |
| Front desk coordinator | Heaviest daily user | Registration < 40 s, collections worklist, a day that closes in < 6 min. |
| Associate doctor | Paid on revenue share | A payout statement verifiable line by line. |
| Accountant / CA | Gatekeeper | GST working papers and a Tally export that imports without repair. |
| Clinician at the chair (Phase 2) | Clinical user | A chart faster than paper — on a tablet, gloves on. |

In a solo practice one person is all of these. Every screen must work for whoever is looking at it.

---

## 2. Stack & architecture (decided — do not relitigate)

| Layer | Choice | Why / constraint |
| --- | --- | --- |
| Language | **TypeScript end to end** (ADR‑001) | Desktop web, mobile web, future Expo tablet client; Zod schemas shared. |
| App | **Next.js 15 App Router**, React 19, server actions | Already in repo. |
| DB | **Postgres** via **Drizzle ORM** 0.36 + drizzle-kit | `src/db/schema.ts`; migrations out to `./drizzle`. |
| Hosting (DB/auth/storage) | **Supabase, Mumbai region** — "now, portable by design" (ADR‑003) | Data residency (NFR‑04). **No Supabase-specific SQL, no RLS.** Auth only through our own interface (`src/lib/auth`). Moving to plain Postgres must be a weekend, not a rewrite. |
| Tenancy | Enforced in the **application data-access layer** | `org_id` on every row is the safety net. Cross-tenant reads must be structurally impossible and covered by tests. |
| Validation | Zod 3 | Share with future Expo client. |
| Tests | Vitest 2 | Domain code is pure and framework-free. |
| Money | Integer paise, no decimal library (ADR‑002) | See §3. |
| Frontend hosting | Not yet decided — pick something cheap that runs Next.js server actions (e.g. Vercel hobby/pro or a small container). Record the choice as an ADR. | Must open on a phone. |

**Architectural rules**

- Domain logic lives in `src/domain/*` as pure functions with tests. Pages and actions call the domain; they never do arithmetic on money themselves.
- A **data-access layer** (to be built: `src/data/*` or `src/server/repo/*`) is the only code that talks to Drizzle. Every function takes a `TenantContext { orgId, branchIds, userId, roles }` and applies `org_id` filters itself.
- No `if (dental)` anywhere — specialty behaviour resolves through the **specialty module registry** (§5.6), even before a second specialty exists.
- FHIR/ABDM shapes never enter the core schema (§5.10).
- Every mutable table write goes through audit middleware (§5.1).

---

## 3. Conventions that must never be broken

These are not style preferences. A day book that fails to reconcile is the exact failure this product exists to prevent. Any PR that violates one is wrong regardless of how much else it does.

1. **Money is integer paise.** `Paise` is a branded number. No floats, no decimal library, anywhere. `paise(10.5)` throws; decimal input enters only via `fromRupeeString('10.50')`. Rates are **basis points**. Multiplication goes through `BigInt`. `allocate()` guarantees a split sums back exactly. DB columns are `bigint(..., { mode: 'number' })` named `*_paise`; rates `*_bp`.
2. **Tax is a property of the invoice line**, never the document. Every tax field (category, HSN/SAC, rate, taxable value, CGST/SGST/IGST) is **snapshotted at issue**. A later catalogue or rate change cannot rewrite history. An **unregistered branch charges no GST** whatever the catalogue says.
3. **CGST/SGST are derived by splitting total tax** with `allocate()`, never computed at half-rate each (ADR‑004 — double rounding drifts a paisa).
4. **Balances are derived, never cached** (ADR‑005): patient balance, invoice outstanding, day-book totals, treatment-plan outstanding, stock quantity. If slow → materialised view rebuildable from entries, never a written column.
5. **Tenancy & history:** `orgId` on every row, `branchId` on everything operational, org-level patient master, **gapless per-branch-per-FY numbering** (locked counter row, not a sequence), **append-only financial history** (a correction is a new document — credit note/void — never an UPDATE of a posted row).

Also (ADR‑006) rounding: tax/rate application half-away-from-zero; `floor`/`ceil` mean toward −∞/+∞; invoice totals rounded to the whole rupee with the difference stored as `roundingPaise`.

**GST model encoded in `tax.ts` (from public sources — unverified, see Q4):**

| Tax category | Typical items | Code | Default rate |
| --- | --- | --- | --- |
| `exempt_healthcare` | Consultation, RCT, extraction, scaling, ortho | SAC 9993 | 0% |
| `goods_prosthetic` | Implant components, crowns, bridges, dentures | HSN 9021 | 12% |
| `goods_retail` | Toothpaste, brushes, mouthwash | HSN 3306 | 18% |
| `cosmetic_service` | Aesthetic-only treatment (outside exemption) | — | 18% |
| `other_taxable` | Escape hatch; rate must be explicit | — | explicit |

One invoice routinely mixes these. ITC is apportioned by taxable/exempt proportion (`itcEligibleBp`).

---

## 4. Current state of the repository (verified 17 Sep 2026)

**Repo:** `chairside/` in the *Dr Vij Dental Center* folder (extracted 17 Sep, HEAD `20a92fa`). GitHub remote: private `lethalgunner/chairside` — being created; push from KS's machine.

**Health at HEAD `a7aee00`:** `npm ci` ✓ · `vitest run` → **59/59 passing** (money 23, ledger 20, tax 13, slice 3) · `tsc --noEmit` ✓ clean.

**Commit history**

```
a7aee00 Script the Linear import via the GraphQL API
2b06f0c Expand the backlog to 68 researched tickets, tiered
26fb8ca Pin the Next.js workspace root
786b004 Patient registration: the first write path
5ccee24 Phase 0 UI: dashboard, invoice, day close, ledger, GST papers
14d5126 Add setup instructions for pushing to GitHub
dce80bb Domain layer and schema for Phase 0
```

### 4.1 File map

```
src/domain/money.ts        Paise/BasisPoints brands, paise(), rupees(), fromRupeeString(), add/subtract/multiply,
                           applyRate(rounding), roundToRupee(), allocate(), splitEvenly(), formatINR()
src/domain/tax.ts          TaxCategory, CATEGORY_DEFAULTS, TaxProfile, LineInput → computeInvoice() → ComputedInvoice,
                           summariseByHsn(), itcEligibleBp(), lineFromCategory()
src/domain/ledger.ts       LedgerEntry, patientBalance(), statement(), outstandingOf(),
                           allocateReceipt('oldest-first'|'proportional'), ageReceivables(),
                           reconcileDay(), DENOMINATIONS, countFromDenominations()
src/domain/*.test.ts       59 tests; slice.test.ts walks the whole vertical slice — read it first
src/db/schema.ts           Full Phase-0 schema (796 lines). Never migrated. Read its header.
src/lib/store.ts           globalThis-backed shared arrays (dev scaffold — DELETE when data layer lands)
src/lib/seed.ts            In-memory seed: 2 invented Pune branches (Kothrud GST-registered, Baner unregistered),
                           patients, invoices, receipts, day-close fixture, unbilled list, duplicate finder, addPatient()
src/app/actions.ts         registerPatient server action (validation, Indian mobile rules, duplicate acknowledgement)
src/app/page.tsx           Dashboard (billed/collected/unbilled/outstanding tiles)
src/app/day-close/         Day close (reconciles, cannot lock)
src/app/unbilled/          Unbilled procedures
src/app/patients/          List · [id] ledger · new (NewPatientForm with duplicate-caught flow)
src/app/invoices/          List · [id] invoice with mixed GST lines
src/app/receivables/       Ageing
src/app/gst/               GST working papers (HSN summary)
src/components/ui.tsx      PageHead, Card, Tile, Initials; globals.css incl. dark mode + mobile
docs/DECISIONS.md          ADR-001…006
docs/PRD-phase0-books.md   Phase-0 requirement IDs (PLAT/PAT/BIL/FIN/ANA) — IDs still referenced by tickets
docs/linear-import.csv     68-ticket earlier backlog (superseded by the 109-row CSV in the project folder)
scripts/linear-import.mjs  Linear GraphQL importer
```

Screenshots of the current UI are in `Claude outputs/` (Dashboard, Invoice – mixed GST, Day close, Patient ledger, GST working papers, Dark mode, Mobile, and four Register states).

### 4.2 Schema tables that exist

`organisations` (fyStartMonth=4) · `branches` (gstRegistered, gstin, abdmHipId) · `operatories` (chairs) · `users` (authSubject, registrationNumber) · `memberships` (user × nullable branch × role) · `patients` (org-level, abhaNumber, householdId, mergedIntoId) · `patient_registrations` (branch file number) · `catalogue_items` (taxCategory, hsnSacCode, gstRateBp, isGoods, pack) · `price_list_entries` (branch/doctor overrides, effectiveFrom) · `appointments` · `encounters` (diagnosisCodes jsonb string[]) · `procedures_performed` (toothNumber, surfaces, invoiceLineId) · `invoice_series` (branch × FY × documentType, lastNumber) · `invoices` (tax snapshot, totals, voidedByInvoiceId) · `invoice_lines` (full tax snapshot) · `receipts` · `receipt_allocations` · `ledger_entries` · `day_books` (expected/counted/variance, denominations, close/reopen audit) · `expenses` · `payout_rules` (versioned by effectiveFrom/To) · `audit_log` (before/after jsonb).

Enums: `role` (owner, branch_manager, front_desk, doctor, associate_doctor, assistant, accountant, auditor) · `tax_category` · `appointment_status` · `invoice_status` (draft/issued/void) · `payment_mode` · `ledger_entry_type` · `day_book_status` · `payout_basis`.

### 4.3 What does NOT exist yet

No DB client/connection module · no `drizzle/` migrations · no `src/lib/auth` (referenced by `.env.example`) · no Supabase client dependency · no data-access layer · no tests touching a database · `npm run seed` points at `src/db/seed.ts`, which does not exist · no deploy config · no error tracking · no CI.

### 4.4 Known inconsistencies to fix (found during this handoff review)

| # | Inconsistency | Resolution |
| --- | --- | --- |
| I‑1 | PRD v1.0 requires an **org-scoped `Provider`** separate from login `User`, with branch-scoped `ProviderMembership`. Schema has only `users` + `memberships`, and all `doctorId` FKs point at `users`. | Sprint 0 — see S0‑2. |
| I‑2 | **Role names disagree.** Schema: 8 roles. PRD v1.0/Linear: 6. | **Decided — ADR‑009:** seven roles `owner, branch_manager, doctor, clinical_assistant, front_desk, accountant, auditor`. Drop `associate_doctor` (pay terms move to `providers.engagement_type`), rename `assistant` → `clinical_assistant`. Checks are by capability, never role name. |
| I‑3 | `encounters` lacks `encounter_type`, `specialty_module_id`, `soap_note`; `diagnosisCodes` is `string[]`, not structured codes. | Sprint 0 — S0‑3. |
| I‑4 | PRD v1.0 referenced ADR‑007, which did not exist. | **Done:** ADR‑007 written. |
| I‑5 | `receipts.unallocatedPaise` is a stored derived value — conflicts with ADR‑005 if later allocations update it. | Remove the column and derive it (amount − Σ allocations), or make it strictly write-once at receipt creation with allocations only ever created in the same transaction. Prefer derive. |
| I‑6 | `audit_log` uses `entityType/entityId/before/after`; PRD v1.0 specifies `(table_name, row_id, actor_user_id, action, diff_jsonb, occurred_at)`. | Keep existing columns (before/after is strictly richer); document as equivalent. Don't churn. |
| I‑7 | README says "There is no UI yet", cites the GST question as "Q5" and ABDM as "Phase 2". | Update README to the phase numbering and Q-numbers in this document. |
| I‑8 | ADR‑001 says an internal ops screen is built "in Phase 0"; Linear places it in Phase 6. | Treat a **minimal** ops view as Phase 1-adjacent (you'll need it to support the demo); the full console stays Phase 6. |
| I‑9 | Two phase schemes exist: BRD v0.2 (P0 books / P1 dental / P2 engagement+ABDM / P3 aesthetics) and PRD v1.0 (Phases 1–6). | **PRD v1.0 phases (1–6) are canonical.** `PRD-phase0-books.md` remains valid as the requirement-ID reference (PLAT‑xx, BIL‑xx…); its scope spreads across Phases 1 and 3. |
| I‑10 | `invoice_series.documentType` is free text. | Constrain to an enum (`invoice`, `receipt`, `credit_note`, `refund`) — PLAT‑10 requires gapless series for all three. |

---

## 5. Product requirements (target system)

Requirement IDs (PLAT/PAT/BIL/FIN/ANA/CLIN/DEN/TXP/SCH/INV/COM/PORT/AES/NFR) come from the BRD and are referenced in Linear tickets. Keep them in commit messages and test names.

### 5.1 Platform (PLAT)

| ID | Requirement | Phase |
| --- | --- | --- |
| PLAT‑01 | Org → branch → chair hierarchy; every operational record branch-scoped and rolling up to the org. | 1 |
| PLAT‑02 | RBAC, grantable **per branch** (a user can be doctor at one branch and owner across all). `memberships.branchId = null` means org-wide. | 1 |
| PLAT‑03 | Field-level permissions on financial data, **enforced in the data layer**, not by hiding UI. An associate sees own production/payout only. | 1 |
| PLAT‑04 | Audit log over every mutable table via Drizzle-level middleware/wrapper so a new route cannot forget it. Ledger and chart are already append-only. | 1 |
| PLAT‑07 | Import wizard (CSV/Excel, Practo Ray, Bestosys exports): mapping UI, dry-run preview, duplicate detection, rollback. | 3 |
| PLAT‑08 | Free full data export, advertised openly. | 3 |
| PLAT‑10 | Gapless numbering per branch per FY for invoices, receipts, credit notes — locked counter row (`SELECT … FOR UPDATE` inside the issuing transaction). Concurrency-tested. | 1 |

**Tenancy detail.** `org_id` is denormalised onto every table (redundant by design) so a missing `branch_id` filter cannot leak across orgs and so cross-branch reports are one indexed filter. The data layer must make an unscoped query hard to write (e.g. repository functions that require `TenantContext`; lint/grep test that no feature code imports `drizzle` or `schema` directly).

### 5.2 Patients (PAT)

| ID | Requirement | Phase |
| --- | --- | --- |
| PAT‑01 | Org-level master + per-branch `patient_registrations` with branch file numbers. Registered at one branch, found instantly at another. | 1 |
| PAT‑02 | Registration **< 40 s**. Mandatory: name, 10-digit Indian mobile (starts 6–9), sex, age or DOB. Everything else later. | 1 |
| PAT‑03 | Fuzzy duplicate detection (phone + name similarity) — shown and acknowledged, never silently created or blocked (families share numbers). Guided merge carries ledger and history (`mergedIntoId`). | 1 (detect), 1–3 (merge) |
| PAT‑04 | Household grouping — one payer settles for dependants. | 3 |
| PAT‑05 | Medical alerts surfaced everywhere the patient appears. | 2 |
| PAT‑06 | Referral source against a configurable taxonomy. | 1 |
| PAT‑07 | ABHA creation/verification. | 5 |
| PAT‑08 | Consent register per channel and purpose. | 4 |

### 5.3 Billing (BIL)

| ID | Requirement | Phase |
| --- | --- | --- |
| BIL‑01 | Service catalogue: code, name, duration, price, tax category, HSN/SAC, GST rate, payout-rule reference, **BOM field reserved** for Phase 3, `specialty_module_id` with `general` fallback. Adding a specialty = data import, not release. | 1 |
| BIL‑02 | Invoice builder from performed procedures; line discount with reason code; approval threshold. | 1 |
| BIL‑03 | Line-level tax classification; each line prints its own code, base, rate, amount. | 1 (engine done) |
| BIL‑04 | GST-registered and unregistered branch profiles in one org. | 1 |
| BIL‑05 | Receipts: cash, UPI (VPA), card (per terminal), bank transfer, cheque, financing. Part payment across invoices with **live allocation preview** before save. | 1 |
| BIL‑06 | Patient ledger, running balance across branches, derived on read; shareable. | 1 |
| BIL‑07 | Advances as unearned revenue, drawn down on delivery. | 3 |
| BIL‑08 | Instalment schedules, overdue flags, collections worklist by ageing. | 3 |
| BIL‑09 | Credit notes, refunds, write-offs — reason code + role-gated approval, permanent in ledger and audit. | 3 |
| BIL‑10 | Unbilled-procedure exception: completed procedures with no invoice line after 24 h. | 1 (screen exists) / 3 (daily job) |
| BIL‑12 | Invoice PDF with branding, registration numbers, doctor council registration, payment QR. | 3 |

### 5.4 Books (FIN) & Analytics (ANA)

| ID | Requirement | Phase |
| --- | --- | --- |
| FIN‑01 | **Day-book close:** expected vs counted cash, denomination breakdown, mandatory variance reason above tolerance, **lock**, owner-only audited reopen. After lock, no receipts can post to that business date. | 1 |
| FIN‑02 | UPI/card settlement auto-reconciliation incl. MDR and timing. | 3 |
| FIN‑03 | Payout engine: % of collection or billing, flat per session/day, per procedure, minimum guarantee; net of lab/consumables/discount; rules versioned by effective date; each run an immutable snapshot. | 3 |
| FIN‑04 | Self-serve payout statements, verifiable line by line. | 3 |
| FIN‑06 | Expenses by branch cost centre; vendor master; bill photo; approval. | 3 |
| FIN‑07 | Branch P&L with drill-through. | 3 |
| FIN‑08 | Chair-hour and doctor profitability. | 3 |
| FIN‑09 | GST working papers: exempt/taxable outward register, HSN/SAC summary, ITC apportionment. | 1 (screen) / 3 (full pack) |
| FIN‑10 | Tally export against a mapped chart of accounts. | 3 |
| FIN‑13 | Financial-year close pack. | 3 |
| ANA‑01 | Owner dashboard across branches. | 3 |
| ANA‑02 | Branch manager dashboard (today's schedule, unbilled, cash, worklist). | 1 (current dashboard) |
| ANA‑03 | Leakage panel. | 3 |
| ANA‑06 | Every figure drills through to its transactions. | all |

### 5.5 Domain model extensions (from PRD v1.0 / Blueprint)

**Tenancy**

```
Org (tenant)
 └─ Branch[]                 own GSTIN or unregistered, own invoice series, own HFR/HIP id later
     └─ Operatory[]          chairs — modelled as a resource (enables chair-hour profitability)
Provider (person, org-scoped; optional link to a User login; council registration no.)
 └─ ProviderMembership[]     provider × branch (a dentist floating across branches = 1 provider, N memberships)
User (login identity, authSubject)
 └─ Membership[]             user × branch|null × role
```

**Patient spine with pluggable clinical modules**

```
Patient (org-level)
 ├─ PatientRegistration[]    per branch
 └─ Encounter[]              branch-scoped, one per visit
     ├─ encounter_type       consultation | procedure | follow_up | emergency
     ├─ specialty_module_id  dental | dermat_aesthetic | general_opd
     ├─ soap_note (jsonb)    universal, always present
     ├─ diagnosis_codes      [{system, code, display, free_text_supplement}]  ← coded from day one
     ├─ ProcedurePerformed[] attributed to a provider
     └─ ClinicalArtifact     separate strongly-typed child tables per specialty (ADR-007), FK encounter_id
```

**Treatment plans (Phase 2)** — `TreatmentPlan (patient, branch, created_by_provider, status: draft|estimated|approved|in_progress|completed|cancelled)` → `TreatmentPlanStage (sequence_no, description, linked_tooth_ref?, status: planned|ready|in_progress|done|skipped, estimated_amount_paise, invoice_line_id?, encounter_id?)`.
Lifecycle is an **explicit state machine**: Draft → Estimated → Approved → StageInProgress → StageBilled → PartialPayment → (next stage) → FinalSettlement → Completed; Cancel allowed throughout.
Rules: outstanding balance is **derived**; a stage's invoice line is created **when the stage starts**, never on plan approval (keeps tax snapshots true to issue date; numbering stays per invoice event).

**Dental chart (Phase 2)** — append-only `dental_chart_entry (patient, encounter, tooth_number FDI 11–48 adult / 51–85 primary, surface: mesial|distal|occlusal|buccal|lingual|incisal|whole_tooth, entry_type: finding|planned_treatment|completed_treatment|existing_restoration, condition_code, treatment_code, status: active|superseded|resolved, recorded_at, recorded_by_provider)`. Current view = latest non-superseded per (tooth, surface). SVG odontogram, dentition chosen by age at load; three layers (existing/planned/completed). **Perio charting in its own table** (six-point depths, recession, attachment, bleeding, mobility, furcation; previous exam alongside).
**Speed is an acceptance criterion:** full mouth < 3 min, quadrant < 30 s, tablet, gloves on — benchmark in CI.

**Inventory (Phase 3)** — `InventoryItem (org; category: consumable|implant|biomaterial|aligner_kit|instrument; tracking_mode: batch_serial|quantity_only)` → `StockLot (branch; batch_number, expiry_date, unit_cost_paise)` → append-only `StockMovement (receipt|consumption|transfer_out|transfer_in|adjustment|wastage; linked_treatment_plan_stage_id; transfer_id)`. Quantity = signed sum of movements. Inter-branch transfer = paired rows sharing `transfer_id`. **Consumption is prompted** from the catalogue BOM at stage completion (confirm/adjust, never type from scratch). Expiry/low-stock scheduled job.

### 5.6 Specialty module registry

```
SpecialtyModule (seed data)            dental | dermat_aesthetic | general_opd
 ├─ chart_component_key                ToothChart | FacialAestheticMap | GenericSOAP
 ├─ default_service_catalog_ref
 └─ consent_template_set_id
Branch.active_specialty_modules[]      a branch can run more than one
ServiceCatalogItem.specialty_module_id 'general' fallback
ConsentTemplate.specialty_module_id
```

Frontend registry maps `specialty_module_id` → React component + Zod schema. Adding dermatology = one `ClinicalArtifact` subtype table + catalogue namespace + consent templates + registered component. Nothing in Org/Branch/Patient/TreatmentPlan/ledger/invoicing changes. Aesthetics packages = a treatment plan with N identical stages (no new entity). Introduce `specialty_module_id` columns in Sprint 0 even though the registry UI is Phase 6.

### 5.7 Clinical (CLIN / DEN / TXP / SCH) — Phase 2 summary

Coded diagnosis typeahead over a static ICD‑10 subset + free text (Phase 1) · digital consent with versioned templates, on-screen signature, witness, immutable stored document (CLIN‑05, DEN‑10) · prescriptions with formulary presets, allergy check, prescriber council registration (CLIN‑04) · implant register with batch traceability (DEN‑05) · imaging capture/comparison — **blocked on Q9 hardware survey** (DEN‑07) · treatment plan as a WhatsApp document with one-tap accept/decline/defer per line (TXP‑03) · estimate-vs-actual variance report · appointment calendar by doctor and chair with cross-branch double-booking structurally impossible (SCH‑01–03) · recurring series linked to plan stages (SCH‑06).

### 5.8 Operations & money control — Phase 3 summary

Inventory (§5.5) · lab work orders (tooth, prosthesis, shade, material; dispatch/receipt/try-in/fit; promised vs actual — DEN‑08) · lab bill reconciliation · block a fit appointment when the lab case hasn't arrived (DEN‑09) · payout engine + statements · expenses · branch P&L · chair-hour/doctor profitability · consolidated org P&L alongside per-branch GST · Tally export · GST returns pack · instalments & collections worklist · credit notes/refunds/write-offs · unbilled exception job · owner dashboard · leakage panel · UPI/card settlement reconciliation · invoice PDF with QR · FY close pack · import wizard · free data export.

### 5.9 Engagement & DPDP (COM / PORT) — Phase 4 summary

`NotificationTemplate (category: utility|authentication|marketing|service; requires_consent_flag)` · `OutboundMessageQueue` (durable, branch-scoped, queued→sent→delivered→read|failed) · `InboundWebhook` (idempotent, keyed by provider message id) · `PatientConsent` (per channel & purpose, notice version, capture channel, revocation). Use a **BSP**, not the Cloud API directly; keep queue/templates in our schema so switching BSP is config (**blocked on Q7**). **Lint at template registration:** no diagnosis, treatment specifics or amounts in marketing templates. Reports/statements only as **short-lived signed links**, optionally OTP-gated. Per-tenant messaging wallet + cost meter with monthly cap (COM‑03). Three-touch confirmations writing back to appointment status (COM‑05) · clinical-event-driven recall engine (COM‑06) · missed-call → WhatsApp callback · QR pre-visit intake (PORT‑03) · pre/post-op instruction links · reactivation campaigns (marketing-consent gated) · clinic-branded patient portal, OTP, no app (PORT‑01/05) · booking widget (SCH‑07) · DPDP data-principal rights workflow (PORT‑04; substantive obligations ~May 2027) · retention policy per record class (3-year statutory floor vs erasure).

### 5.10 ABDM — Phase 5 summary

| Milestone | Scope | Plan |
| --- | --- | --- |
| M1 Identity | ABHA creation (Aadhaar/mobile OTP), HFR registration per branch, QR scan-and-share, sync discovery | Ship standalone first |
| M2 HIP | Consent callbacks, Fidelius ECDH encryption, FHIR R4 bundles (OPConsultNote, Prescription, DiagnosticReport, ImagingStudy) per NRCeS profiles | Budget a quarter; **build vs buy = Q6** |
| M3 HIU | Consent initiation, normalising others' bundles | Low priority |
| M4 NHCX | Claims | Hospital phase only |

Isolated `abdm-bridge` module that **projects** FHIR from `Encounter` + `ClinicalArtifact` at the edge. Own tables: `patient_abha_link` (keep the HIP-initiated linking token), `care_context` (scoped to the consented visit window), callback inbox as a **durable idempotent queue** for the six public endpoints (discovery, link-init, link-confirm, add-contexts, data-push-request, consent-revocation). CERT‑In/STQC security assessment before production (NFR‑10).

### 5.11 Non-functional requirements

- Median interactive response < 400 ms, p95 < 1.2 s on 4G from a tier‑2 city.
- 99.5% availability 09:00–21:00 IST.
- All data in Indian regions (NFR‑04); encryption in transit and at rest.
- Tenant isolation in the data layer with automated leak tests (NFR‑05).
- PITR: ≤ 15 min data loss, restore < 4 h, **tested quarterly** (NFR‑06).
- Responsive from phone and 10-inch tablet upward; installable PWA later; offline tolerance for front desk (cache lookups, queue receipts) — full offline-first is **not** a goal (NFR‑02).

### 5.12 Explicitly not building

Insurance claims automation / payer integrations · voice-AI phone reception · diagnostic AI on radiographs · inpatient/theatre management before Phase 6 · patient-discovery marketplace · full retail pharmacy · on-premise deployment.

### 5.13 Success measures (Phase 1–3 books)

Day-book close rate > 95% of branch-days · median close < 6 min · unbilled after 24 h < 1% · receivables > 60 days < 10% · disputed payout statements < 2% · branch onboarding < 5 working days · registration < 40 s.

---

## 6. Sprint 0 — reconcile before the first migration

No data exists yet, so every change here is free now and a migration later. Do these first, as separate commits, each with tests where applicable.

| # | Task | Acceptance |
| --- | --- | --- |
| S0‑1 | Confirm repo location with KS (GitHub remote / connected folder). Add CI (GitHub Actions: `npm ci`, `typecheck`, `test`). | CI green on 59 tests. |
| S0‑2 | Per ADR‑008, add `providers` (org-scoped: fullName, councilRegistrationNumber, specialty, `engagementType` owner_partner/salaried/associate/visiting, optional `userId`) and `provider_memberships` (provider × branch). Repoint `appointments.doctorId`, `encounters.doctorId`, `procedures_performed.doctorId`, `price_list_entries.doctorId`, `payout_rules.doctorId` to `providers`. Move `users.registrationNumber` to providers. | Schema compiles; seed updated; a `doctor` membership requires a linked active provider (test). |
| S0‑3 | `encounters`: add `encounterType` enum, `specialtyModuleId`, `soapNote jsonb` (not null, default `{}`); change `diagnosisCodes` to `{system, code, display, freeTextSupplement}[]` with a Zod schema in `src/domain/clinical.ts`. Add `specialtyModuleId` to `catalogue_items` and `active_specialty_modules` to `branches`; seed `specialty_modules` table (dental, dermat_aesthetic, general_opd). | Zod schema tests; no dental-specific column on `encounters`. |
| S0‑4 | Remove `receipts.unallocatedPaise` (derive) — or document write-once semantics (I‑5). Constrain `invoice_series.documentType` to enum (I‑10). Add receipt and credit-note series usage. | Derived function + test. |
| S0‑5 | Implement ADR‑009: change `roleEnum` to the seven roles; add `memberships.expiresAt`; enforce `owner` grants are org-wide; encode the ADR‑009 capability matrix as data in `src/domain/permissions.ts`. | One test per matrix cell that matters (at minimum: assistant cannot sign; accountant/auditor cannot read clinical data; doctor sees own payout only; only owner reopens a day; branch_manager scoped to own branches). |
| S0‑6 | ADR‑007…011 are written. Add ADR‑012 (frontend hosting) when chosen. Update README (I‑7), fix `npm run seed`. Add branch-code constraint (exactly 3 uppercase alphanumerics, immutable after first issued document) and a same-state GST consistency check (ADR‑010). `invoice_series.documentType` enum = `sale | receipt | credit_note`. | Docs consistent with this PRD. |
| S0‑7 | Generate the **first migration** from the reconciled schema; review the SQL for any Supabase-specific or RLS constructs (there must be none). | `drizzle/0000_*.sql` committed. |

---

## 7. Phase 1 — Working backend and demo (next build target)

**Outcome:** the walk-in journey runs end to end on real infrastructure.
**Definition of done:** register a patient → record a procedure → raise a mixed exempt/taxable invoice → take a part payment → see the ledger → close the day — **persisted in Postgres, behind auth, at a URL that opens on a phone** that Dr. Anshul can open in a clinic.

### 7.1 Build order (dependency-sorted)

1. **Provision Postgres & wire Drizzle** — Supabase Mumbai; `src/db/client.ts` using `postgres` driver; migrations applied on deploy; local dev via Docker Postgres or a Supabase dev project. No RLS, no Supabase SQL. *(P1, 3 pts)*
2. **Org / Branch / Provider / ProviderMembership** persisted with CRUD for an org admin. *(P1, 5)*
3. **Auth behind our own interface (ADR‑011)** — `src/lib/auth/index.ts` exports `getSession()`, `requireUser()`, `requestCode(email)`, `verifyCode(email, code)`, `signOut()`; a Supabase adapter is the only file importing Supabase. **Email + 6‑digit one-time code, no passwords, invite-only** (unknown emails get a generic response). Magic-link template changed to send `{{ .Token }}`. Custom SMTP (Resend/Postmark/SES) configured before any real clinic — built-in Supabase email allows ~2/hour. 12‑hour idle session. `users.authSubject` maps identities. *(P1, 8)*
4. **RBAC with per-branch grants** — middleware resolves `TenantContext`; server actions call `authorize(ctx, capability, branchId)`. *(P1, 5)*
5. **Tenancy enforcement in the data layer** — repository functions only; automated tests that attempt cross-org reads/writes and assert failure. *(P1, 5)*
6. **Field-level financial permissions** — associate sees own production/payout only; enforced in queries. *(P1, 3)*
7. **Generic audit log** via a write wrapper around mutable tables. *(P1, 5)*
8. **Replace the in-memory seed with real queries** — delete `src/lib/store.ts`; every page reads through repositories. Keep domain calls unchanged. *(P1, 8)*
9. **Patient registry persisted** — duplicate detection in SQL (phone exact + name trigram/normalised similarity), acknowledgement flow retained, branch file number generated. < 40 s. *(P1, 5)*
10. **Service catalogue** with tax treatment, HSN/SAC, GST rate, BOM placeholder, specialty module. Seed a realistic dental catalogue. *(P1, 5)*
11. **Record an encounter and its procedures at the chair** — encounter type, SOAP note, procedures attributed to provider, tooth/surface optional. *(P1, 8)*
12. **Coded diagnosis capture** — typeahead over a static ICD‑10 subset + free text. *(P1, 5)*
13. **Interactive invoice builder** — from unbilled procedures; line discount + reason + approval threshold; uses `computeInvoice()`; issue = transaction that locks `invoice_series`, snapshots tax on every line, writes `ledger_entries`, links `procedures_performed.invoiceLineId`. Drafts are editable; issued invoices never are (void → new document). *(P1, 5)*
14. **Gapless numbering under real concurrency** — counter row `FOR UPDATE`; test issuing N invoices in parallel yields 1..N with no gaps and no duplicates, including when one transaction rolls back. Format per **ADR‑010** (GST rules cap serials at 16 chars): sales `KNP/26-27/00123`, receipts `KNPR/26-27/00123`, credit notes `KNPC/26-27/00012`; formatter throws past 16 chars or 99,999; number assigned at issue, never draft; voids keep their number. Document title computed at issue: tax invoice (all taxable) · bill of supply (all exempt) · invoice-cum-bill of supply (mixed, Rule 46A) · plain bill (unregistered branch). *(P1, 3)*
15. **Take a payment with live allocation preview** — all payment modes; `allocateReceipt()` preview shown before save; receipt numbered from its own series; allocations + ledger entry in one transaction. *(P1, 5)*
16. **Patient ledger from real entries** — running balance derived on read, across branches; shareable statement. *(P1, 3)*
17. **Close the day for real** — `reconcileDay()`; denomination count; variance reason mandatory above tolerance (configurable per branch); lock; owner-only reopen with reason, audited; posting to a locked date is rejected. *(P1, 5)*
18. **Seed a realistic demo organisation** — two branches (one GST-registered, one not; consider modelling on Kanpur UP + Pune MH), a dozen invented patients, a mixed invoice, an ageing balance, a cash variance. Idempotent `npm run seed`. *(P2, 3)*
19. **Share receipt and ledger statement on WhatsApp** — Phase-1 version may be a `wa.me` deep link with a signed, short-lived statement URL (no BSP yet); no clinical detail in the message text. *(P2, 3)*
20. **Deploy to a URL that opens on a phone** — env config, migrations on deploy, preview deployments. *(P1, 3)*
21. **Error tracking & observability** — Sentry (or equivalent), request logging, `/api/health`. *(P2, 3)*
22. **PITR, tested** — document and perform a restore drill. *(P1, 3)*
23. **Confirm GST treatment with a practising CA — BLOCKING any customer-facing claim** (Q4). Not code; track it. *(P1, 2)*

### 7.2 Phase 1 acceptance tests (must exist and pass)

- **Vertical slice E2E** (Playwright): login as front desk → register patient → login as doctor → record encounter with RCT (exempt) + crown (12%) + toothbrush (18%) → front desk issues invoice → takes part payment by UPI + cash → ledger shows correct derived balance → branch manager closes day with a variance and reason → reopen as owner is audited.
- **Money invariants against the DB:** Σ invoice lines = invoice total − rounding; CGST + SGST = line tax exactly; Σ allocations ≤ receipt amount; patient balance from ledger = Σ outstanding invoices − unallocated receipts.
- **Unregistered branch** invoice contains zero tax on every line.
- **Tenancy leak tests:** user of org A cannot read or mutate any row of org B through any repository function or server action.
- **Gapless concurrency test** (parallel issuance with a forced rollback).
- **Locked day** rejects new receipts for that date.
- **Audit:** editing patient demographics writes an audit row with before/after.
- **Associate** cannot fetch branch P&L or another doctor's figures.
- Existing 59 domain tests still pass; typecheck clean.

---

## 8. Roadmap beyond Phase 1

| Phase | Outcome | Definition of done | Blockers |
| --- | --- | --- | --- |
| 2 · Dental clinical pack | A dentist uses it instead of paper | Odontogram at speed target, perio, treatment plans with stage billing, coded diagnoses, consent, prescriptions | Q5 design partner; Q9 imaging hardware |
| 3 · Operations & money control | An owner runs the practice from it | Inventory with BOM consumption, lab orders + bill reconciliation, payout engine, branch P&L, Tally export | — |
| 4 · Engagement & DPDP | Patients hear from the clinic without anyone remembering | WhatsApp engine with consent register and cost meter, recalls, confirmations, missed-call capture | Q7 BSP |
| 5 · ABDM | Compliance becomes a switching trigger | M1 standalone, then M2; bridge isolated | Q6 build vs buy |
| 6 · Second specialty | Modular claim proven | Aesthetics pack live at a real clinic; registry doing real work | — |

Each phase is a precondition for the next: payouts need procedure records; procedure records are one field short of a chart.

---

## 9. Linear backlog (project "Chairside")

Source: `linear-import.csv` in the project folder (108 tickets), imported via `linear-import.mjs` (issues) and `linear-project.mjs` (description, project doc, milestones; idempotent, matched by title/name; needs `LINEAR_API_KEY`; dry run without `--go`). Workspace: **Lethalgunner**. Labels: `Chairside: Now | Platform | Books | Dental Pack | Compliance | Engagement | Edge`. Priority 1 = urgent … 3 = medium. All tickets were `Todo` at export.

> ⚠️ The Linear connector available in this handoff session could not list issues, so live ticket status was **not** re-verified. Before starting, run `node linear-project.mjs` (dry run) or check Linear to see whether the import ran and whether anything has moved. If Linear and this file disagree on status, Linear wins; on scope, this file wins until KS says otherwise.

### Phase 1 · Working backend and demo (23)

| Ticket | Pri | Est | Refs |
| --- | --- | --- | --- |
| Provision Postgres and wire Drizzle migrations | 1 | 3 | NFR‑04, ADR‑003 |
| Org, Branch, Provider and ProviderMembership | 1 | 5 | |
| Auth behind our own interface | 1 | 8 | ADR‑003 |
| RBAC with per-branch role grants | 1 | 5 | PLAT‑02 |
| Tenancy enforcement in the data-access layer | 1 | 5 | NFR‑05 |
| Field-level permissions on financial data | 1 | 3 | PLAT‑03 |
| Replace the in-memory seed with real queries | 1 | 8 | |
| Patient registry persisted | 1 | 5 | PAT‑01–03 |
| Service catalogue with tax treatment and BOM hook | 1 | 5 | BIL‑01 |
| Record an encounter and its procedures at the chair | 1 | 8 | CLIN‑01/02 |
| Coded diagnosis capture from day one | 1 | 5 | |
| Interactive invoice builder | 1 | 5 | BIL‑02 |
| Take a payment with live allocation preview | 1 | 5 | BIL‑05 |
| Patient ledger from real entries | 1 | 3 | ADR‑005, BIL‑06 |
| Close the day for real | 1 | 5 | FIN‑01 |
| Gapless invoice numbering under real concurrency | 1 | 3 | PLAT‑10 |
| Generic audit log via Drizzle middleware | 1 | 5 | PLAT‑04 |
| Share receipt and ledger statement on WhatsApp | 2 | 3 | |
| Deploy to a URL that opens on a phone | 1 | 3 | |
| Seed a realistic demo organisation | 2 | 3 | |
| Error tracking and basic observability | 2 | 3 | |
| Point-in-time recovery, tested quarterly | 1 | 3 | NFR‑06 |
| Confirm the GST treatment with a practising CA | 1 | 2 | Q4 — blocking |

### Phase 2 · Dental clinical pack (17)

Dental chart as an append-only entry log (1/8) · SVG odontogram, adult and primary by age (1/13, DEN‑01/02) · Charting speed benchmark enforced in CI (1/5, DEN‑11) · Periodontal charting in its own table (2/8, DEN‑03) · Treatment plan and stage schema (1/5) · Treatment plan state machine (1/8) · Stage-level billing, never plan-level (1/5) · Outstanding balance derived, never stored (1/3) · Estimate versus actual variance report (2/5) · Treatment plan as a WhatsApp document with one-tap acceptance (1/5, TXP‑03) · Digital consent with versioned templates (1/5, CLIN‑05, DEN‑10) · Prescriptions with formulary and allergy checking (2/5, CLIN‑04) · Implant register with batch traceability (1/5, DEN‑05) · Imaging capture and comparison (1/13, DEN‑07, blocked Q9) · Medical alerts surfaced everywhere (1/3, PAT‑05) · Appointment calendar against doctor and chair (1/8, SCH‑01–03) · Recurring and series appointments (2/5, SCH‑06).

### Phase 3 · Operations and money control (26)

Inventory item catalogue and stock lots (1/5) · Stock movements, append-only (1/5) · Prompted consumption at stage completion (1/8) · Inter-branch transfer as paired movements (2/3) · Expiry and low-stock alerts (2/3, INV‑05) · Lab work orders (1/8, DEN‑08) · Lab bill reconciliation (1/5) · Block a fit appointment when the lab case has not arrived (2/3, DEN‑09) · Doctor payout engine (1/8, FIN‑03) · Self-serve payout statements (1/5, FIN‑04) · Expense capture by branch cost centre (2/5, FIN‑06) · Branch P&L with drill-through (1/5, FIN‑07, ANA‑06) · Chair-hour and doctor profitability (2/5, FIN‑08) · Consolidated org P&L alongside per-branch GST (1/5) · Tally export (1/5, FIN‑10) · GST working papers and returns pack (1/8, FIN‑09) · Instalment schedules and collections worklist (1/5, BIL‑08) · Credit notes, refunds and write-offs (2/5, BIL‑09) · Unbilled procedure exception report (1/3, BIL‑10) · Owner dashboard across all branches (1/5, ANA‑01) · Leakage panel (1/5, ANA‑03) · UPI and card settlement auto-reconciliation (1/8, FIN‑02) · Invoice PDF with branding and payment QR (2/3, BIL‑12) · Financial-year close pack (2/5, FIN‑13) · Import wizard with dry-run and rollback (1/13, PLAT‑07) · Free full data export (2/3, PLAT‑08).

### Phase 4 · Engagement and DPDP (19)

Notification template registry (1/5) · Durable outbound message queue (1/5) · WhatsApp BSP integration (1/8, COM‑01, blocked Q7) · Inbound webhook handling (2/5) · Patient consent register per channel and purpose (1/5, PAT‑08, COM‑09) · Lint marketing templates for clinical content (1/3) · Reports and statements as short-lived signed links (1/5) · Per-tenant messaging wallet and cost meter (1/5, COM‑03) · Three-touchpoint confirmation with one-tap reply (1/5, COM‑05) · Recall engine driven by clinical events (1/8, COM‑06) · Missed-call capture to WhatsApp callback (1/8) · Pre-visit digital intake by QR (1/5, PORT‑03) · Pre/post-op instructions as templated links (2/3) · Inactive patient reactivation campaigns (2/5, COM‑07) · Patient portal, clinic-branded (2/8, PORT‑01/05) · Online booking widget (2/5, SCH‑07) · DPDP data-principal rights workflow (2/8, PORT‑04) · Record retention policy per record class (2/3) · Referral attribution through to revenue (2/5, ANA‑04).

### Phase 5 · ABDM (8)

Decide: build FHIR conversion or use an accelerator (1/3, Q6) · ABDM bridge module isolated from core schema (1/8) · `patient_abha_link` and `care_context` tables (1/5) · Callback inbox as a durable idempotent queue (1/8) · ABDM M1: ABHA creation and verification (1/8, PAT‑07) · HFR registration per branch (1/3) · ABDM M2: serve records as FHIR bundles (1/21) · Security assessment for ABDM production access (1/3, NFR‑10).

### Phase 6 · Second specialty (15)

Specialty module registry, backend (1/8) · Specialty module registry, frontend (1/5) · Aesthetics clinical artifact and before-after imaging (2/13, AES‑03) · Aesthetics packages reuse treatment plans unchanged (2/5, AES‑01) · Injectable batch tracking and patch-test intervals (2/5, AES‑04/05) · Cosmetic GST treatment on mixed invoices (1/3, AES‑07) · Internal ops console for support (2/8, ADR‑001) · Public REST API and webhooks (3/13) · Installable PWA (2/5) · Offline tolerance for the front desk (2/8, NFR‑02) · Hospital readiness spike (3/5) · Conversational analytics (3/8) · Ambient voice charting in Indian English and Hindi (3/13) · Predictive no-show scoring (3/8) · Free leakage audit as the sales motion (1/8).

---

## 10. Open decisions

| # | Question | Needed by | Agent behaviour until resolved |
| --- | --- | --- | --- |
| Q1 | Is ₹10,000 the entry tier or the whole price list? (Model says entry tier.) | Before pricing is quoted | Build feature flags/module entitlements per org so tiers are data, not code. |
| Q2 | Partnership structure with Dr. Anshul | Before build scale-up | n/a |
| Q3 | Who builds, at what velocity | Before build scale-up | Assume Claude + KS review. |
| **Q4** | **GST treatment confirmed by a practising CA** (implant/cosmetic boundaries, ITC apportionment) | Before any customer-facing claim | Keep all rates as data; mark GST screens "draft — not tax advice" in the demo. |
| Q5 | Design partner commitment (a named person, an hour a week) | Before Phase 2 | — |
| Q6 | ABDM FHIR: build vs accelerator | Before Phase 5 | Don't start M2. |
| Q7 | WhatsApp BSP + cost per conversation in the model | Before Phase 4 | Phase 1 WhatsApp = deep links only. |
| Q8 | ClinicalArtifact tables vs jsonb | **Settled: separate typed tables** (write ADR‑007) | — |
| Q9 | Imaging hardware at target clinics (DICOM vs bridge; PWA sufficiency) | Before Phase 2 imaging | Don't build imaging. |
| Q10 | Frontend hosting provider | Phase 1 deploy | Pick cheapest viable option; ADR‑012; keep portable. |
| Q11 | Invoice number format and branch codes | **Settled — ADR‑010** (show the CA alongside Q4) | — |
| Q12 | Staff auth method | **Settled — ADR‑011:** email + one-time code for now | — |
| Q13 | Roles | **Settled — ADR‑009** | — |

---

## 11. Working agreement for Claude Code

- **Start of every session:** `npm ci && npm test && npm run typecheck`; read `src/domain/slice.test.ts`, the `schema.ts` header, `docs/DECISIONS.md`, and this file.
- **One ticket ≈ one PR/commit series.** Reference the Linear title and requirement ID. Commit messages explain *why*.
- **Tests with every change** that touches money, tax, ledger, numbering, tenancy, permissions or audit. Prefer domain unit tests + a few DB integration tests (throwaway Postgres) + one E2E slice.
- **Read ADR‑007…011 before Sprint 0** — they change the schema (providers, roles, memberships.expiresAt, document series).
- **Add an ADR** for any decision that would be confusing to revisit.
- **Never:** use floats for money · compute tax at document level · cache a balance or stock quantity · UPDATE a posted financial row · write Supabase-specific SQL or RLS · import the auth provider outside `src/lib/auth` · let feature code query without `TenantContext` · put FHIR shapes in core tables · put clinical detail in a WhatsApp message body · use real patient data in seeds.
- **Stop and ask KS** when: a change would alter a §3 convention, a GST treatment, pricing/entitlement logic, or anything in §10 that isn't settled.
- **UI tone:** calm, dense, numbers first; every figure drills through; works on a phone and a 10-inch tablet; dark mode already supported in `globals.css`. Keep the existing component style (`PageHead`, `Card`, `Tile`).

---

## 12. Source artefacts (all in the *Dr Vij Dental Center* folder unless noted)

| Artefact | What it is |
| --- | --- |
| `chairside.tar.gz` (root, 13 Sep 13:51) | The repo, HEAD `a7aee00` — **use this one** |
| `PRD.md` | PRD v1.0 (13 Sep) — domain model, dental specifics, ABDM/WhatsApp/GST, phases, competition |
| `Chairside - Architecture Blueprint.md` | ERD, chart/plan/inventory schemas, ABDM & WhatsApp architecture, registry pattern, moat |
| `Chairside - Concept Brief.pdf` | Early concept brief (9 Sep) |
| `Chairside Financial Model v1.xlsx` | 7 sheets, formula-driven from Assumptions |
| "Chairside Clinic OS BRD" (claude.ai artifact, v0.2) | Requirement IDs, 16 sections + open questions |
| `linear-import.csv`, `linear-import.mjs`, `linear-project.mjs` | Current 108-ticket backlog and Linear setup scripts |
| `chairside-linear-import.csv` | Earlier backlog export (superseded) |
| `Claude outputs/*.png` | Screenshots of the current UI |
| `dr-vij-dental.html` | Separate clinic marketing website prototype — not part of Chairside |

> **Not legal or tax advice.** GST treatment, ABDM milestone requirements and DPDP obligations here are drawn from public sources as of September 2026 for planning. Confirm with a practising CA and a healthcare-regulatory lawyer before any of it is represented to a customer.
