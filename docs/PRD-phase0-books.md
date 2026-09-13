# PRD — Phase 0: The Books

**Product:** Chairside · **Phase:** 0 · **Status:** in build · **Owner:** Kshitij Sharma
**Last updated:** 13 September 2026

---

## 1. Why this phase exists

The commercial wedge is deliberately not EMR. It is the books.

A practice owner can quantify the pain of not knowing their numbers in rupees on
a first sales call. They cannot do that for a better tooth chart. So Phase 0
sells on financial control, and the clinical product follows once we have earned
the right to it.

**The MVP boundary, stated as one sentence:** a practice owner can run every
rupee of their business through Chairside, close each clinic's day, and hand
their CA a clean month.

If a feature does not appear in that sentence, it is not in Phase 0. Charting
sits deliberately outside it. Holding that line is what makes six months
realistic rather than optimistic.

## 2. Who this is for

| Persona | Role here | What they need from Phase 0 |
| --- | --- | --- |
| Owner / principal dentist | Economic buyer | To know which clinic made money last week, and why |
| Front desk coordinator | Heaviest daily user | Registration under 40 seconds, collections worklist, a day that closes |
| Associate doctor | Paid on revenue share | A payout statement they can verify line by line |
| Accountant / CA | Gatekeeper | An export that lands in Tally without manual repair |

The buyer and the heaviest daily user are different people. Every screen has to
work for whichever one is looking at it — and in a solo practice, one person is
all three at once.

## 3. Scope

### In

- Organisation, branch and chair hierarchy; roles and permissions
- Patient registry with org-level identity and per-branch registration
- Appointments against doctor + chair
- Service catalogue with per-item tax treatment and payout rule
- Encounters and a procedure log (what was done, by whom, for how much)
- Invoicing with line-level GST, discounts and approval thresholds
- Receipts across every payment mode, part payments, advances
- Patient ledger with running balance across branches
- Day-book close with cash reconciliation and variance explanation
- Expenses by branch cost centre
- Doctor payout engine and self-serve statements
- Branch P&L and an owner dashboard
- Tally-compatible export
- Data import from spreadsheets and incumbent products

### Out (deferred to later phases)

Odontogram and periodontal charting · treatment planning · imaging · lab work
orders · inventory · WhatsApp engagement · patient portal · ABDM · online
booking · aesthetics pack

### Out (permanently)

Inpatient and theatre management · a patient-discovery marketplace · insurance
claim adjudication · a full retail pharmacy · on-premise deployment

## 4. Functional requirements

Grouped by module. IDs match the BRD.

### Platform (PLAT)

| ID | Requirement | Priority |
| --- | --- | --- |
| PLAT-01 | Org → branch → chair hierarchy; every record branch-scoped and rolling up to the org | Must |
| PLAT-02 | Role-based access: Owner, Branch Manager, Front Desk, Doctor, Associate, Assistant, Accountant, Auditor — grantable per branch | Must |
| PLAT-03 | Field-level permissions on financial data. An associate sees their own production and payout, never the branch P&L | Must |
| PLAT-04 | Append-only audit log of every financial and clinical write, queryable in-app | Must |
| PLAT-07 | Import from CSV/Excel and incumbent exports, with mapping UI, dry-run preview, duplicate detection and rollback | Must |
| PLAT-08 | Free full data export, advertised openly. Practices stay because the software is good, not because leaving hurts | Must |
| PLAT-10 | Gapless numbering per branch per financial year for invoices, receipts and credit notes | Must |

### Patients (PAT)

| ID | Requirement | Priority |
| --- | --- | --- |
| PAT-01 | Org-level patient master with branch-level registrations. Registered at one branch, found instantly at another | Must |
| PAT-02 | Registration in under 40 seconds. Mandatory fields: name, mobile, sex, age or DOB | Must |
| PAT-03 | Fuzzy duplicate detection at registration, with a guided merge carrying ledger and history across | Must |
| PAT-04 | Household grouping so one payer can settle for dependants | Must |
| PAT-06 | Referral source captured at registration against a configurable taxonomy | Must |

### Billing (BIL)

| ID | Requirement | Priority |
| --- | --- | --- |
| BIL-01 | Service catalogue: code, price, duration, tax treatment, payout rule reference | Must |
| BIL-02 | Invoice from performed procedures, line-level discount with reason code and an approval threshold | Must |
| BIL-03 | **Line-level tax classification** separating exempt healthcare (SAC 9993) from taxable prosthetics (HSN 9021), retail (HSN 3306) and cosmetic procedures. Each line prints its own code, base, rate and amount | Must |
| BIL-04 | Both GST-registered and unregistered branch profiles within one organisation | Must |
| BIL-05 | Receipts across cash, UPI, card, bank transfer, cheque and financing, with part payment across invoices | Must |
| BIL-06 | Patient ledger with running balance across all branches, shareable as a document | Must |
| BIL-07 | Advances held as unearned revenue and drawn down as treatment is delivered | Must |
| BIL-08 | Instalment schedules with overdue flagging and a collections worklist sorted by ageing | Must |
| BIL-09 | Credit notes, refunds and write-offs, each requiring a reason code and role-gated approval | Must |
| BIL-10 | Unbilled-procedure exception report: completed procedures with no invoice line after 24 hours | Must |

### Books (FIN)

| ID | Requirement | Priority |
| --- | --- | --- |
| FIN-01 | **Day-book close.** Expected vs counted cash, denomination breakdown, mandatory variance explanation above threshold, lock, audited reopen | Must |
| FIN-03 | **Payout engine.** Percentage of collection or billing, flat per session or day, per procedure, minimum guarantee. Net of lab, consumables or discount. Versioned by effective date | Must |
| FIN-04 | Payout statements a doctor can self-serve and verify line by line | Must |
| FIN-06 | Expense capture by branch cost centre with vendor master and approval workflow | Must |
| FIN-07 | Branch P&L with drill-through to underlying transactions | Must |
| FIN-09 | GST working papers: outward supply register split exempt/taxable, HSN/SAC summary, ITC apportionment | Must |
| FIN-10 | Tally-compatible export mapped to a configurable chart of accounts | Must |

### Analytics (ANA)

| ID | Requirement | Priority |
| --- | --- | --- |
| ANA-01 | Owner dashboard: collections, billings, new vs returning, receivables ageing, contribution — all branches side by side | Must |
| ANA-02 | Branch manager dashboard: today's schedule, arrivals, unbilled exceptions, cash position, collections worklist | Must |
| ANA-06 | Every figure drills through to the transactions behind it. Numbers a user cannot audit are numbers they will not trust | Must |

## 5. Non-functional

- Median interactive response under 400 ms, p95 under 1.2 s on 4G from a tier-2 city. Clinic internet is not office internet.
- 99.5% availability during clinic hours, 09:00–21:00 IST
- All data in Indian regions; encryption in transit and at rest
- Tenant isolation enforced in the data-access layer, not left to query discipline, and covered by automated tests
- Point-in-time recovery, max 15 minutes data loss, restore under 4 hours, tested quarterly
- Responsive from a 10-inch tablet upward

## 6. Success measures

| Metric | Target |
| --- | --- |
| Day-book close rate | >95% of branch-days |
| Time to close a day | <6 minutes median |
| Unbilled procedure rate | <1% after 24 hours |
| Receivables aged >60 days | <10% |
| Payout statements disputed after issue | <2% |
| Time to onboard a branch | <5 working days |

## 7. What is built as of today

- `money.ts` — integer paise, no floats, no decimal library. Allocation guaranteed to sum back exactly.
- `tax.ts` — line-level GST, mixed exempt/taxable invoices, unregistered-branch handling, HSN summary, ITC proportion.
- `ledger.ts` — derived balances, oldest-first and proportional allocation, ageing buckets, day close with variance.
- `schema.ts` — full Phase 0 schema with the four permanent decisions baked in.
- 59 tests. `slice.test.ts` walks the whole vertical slice.

Not yet built: auth and RBAC, the catalogue CRUD, any UI beyond the first screens, payout engine, expenses, P&L, Tally export, import tooling.

## 8. Risks specific to this phase

| Risk | Mitigation |
| --- | --- |
| **The GST treatment is wrong.** Encoded from public sources, not from a CA | Confirm with a practising CA before any customer-facing claim. This is the single highest-damage error available to us |
| **Migration goes wrong and loses a reference account** | Import is a first-class module with dry-run and rollback. Never migrate financial history without a parallel-run period |
| **Numbers are subtly wrong and nobody notices** | The money engine is pure, tested and framework-free. Tests are the deliverable as much as the code |
| **Front desk finds it slower than what they have** | 40-second registration is an acceptance criterion, not an aspiration |
