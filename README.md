# Chairside

A clinic operating system for Indian dental practices — books-first, dental-native, and branch-aware whether a customer has one clinic or fifteen.

**Status:** Phase 0, early. The domain layer and schema exist and are tested. There is no UI yet.

---

## What's here so far

```
src/domain/money.ts     Integer-paise money. No floats, anywhere, ever.
src/domain/tax.ts       Line-level GST. The mixed exempt/taxable invoice.
src/domain/ledger.ts    Patient ledger, receipt allocation, ageing, day close.
src/db/schema.ts        The schema. Read its header before changing it.
```

59 tests, all passing. `src/domain/slice.test.ts` is the one to read first — it
walks the whole vertical slice as a single scenario and is the clearest
statement of what the system currently does.

## Running it

```bash
npm install
npm test          # 59 tests, ~1s
npm run typecheck
```

Database work needs a `DATABASE_URL` (see `.env.example`):

```bash
npm run db:generate   # generate migrations from schema.ts
npm run db:push       # apply to the database
```

## The four decisions that are effectively permanent

These are in the schema from the first migration, deliberately, because the BRD
is right that retrofitting them is a rewrite rather than a refactor:

1. **Every row carries `orgId`**, and everything operational also carries
   `branchId`. A single-clinic practice has exactly one branch. We do not add
   branch-awareness later.
2. **`patients` is org-level.** A patient seen at two branches is one patient
   with two registrations, never two records.
3. **Invoice numbering is per branch, per financial year, gapless.** It is a
   table rather than a sequence because sequences leak numbers on rollback, and
   a gap in an invoice series is a question from an auditor.
4. **Financial history is append-only.** A correction is a new document, never
   an edit.

A fifth, cheap now and expensive later: `encounters.diagnosisCodes` exists but
is unused in Phase 0. ABDM certification (Phase 2) requires coded diagnoses, and
retrofitting them across a live patient database is the most commonly reported
failure in that process.

## Money

Every rupee amount in this system is an integer number of paise. There are no
floating-point amounts and no decimal library. You cannot construct money from a
float — `paise(10.5)` throws, and `fromRupeeString('10.50')` is how decimal
input gets in.

This is not fastidiousness. `0.1 + 0.2 !== 0.3` in a clinic's day book is the
exact failure this product exists to prevent.

## Tax

The healthcare exemption attaches to the **service**, not to the goods. One
invoice routinely mixes an exempt root canal (SAC 9993, 0%), a taxable
lab-made crown (HSN 9021, 12%) and a taxable toothbrush (HSN 3306, 18%). Tax is
a property of the line, never of the document, and every tax field is
snapshotted at issue so a rate change tomorrow cannot rewrite what was charged
yesterday.

> **Not legal advice.** `src/domain/tax.ts` encodes a planning summary from
> public sources as of September 2026. A practising CA must confirm the
> treatment — particularly the implant and cosmetic boundaries — before any of
> it is represented to a customer. This is open question Q5 in the BRD.

## What's next

- Auth, users and RBAC behind our own interface
- Service catalogue and price lists
- The thin UI for the vertical slice
- Day-book close screen
- Payout engine
- Expenses, branch P&L, Tally export
- Import tooling — a first-class feature, not a services task

## License

Private and unpublished.
