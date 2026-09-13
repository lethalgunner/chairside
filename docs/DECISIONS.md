# Architecture decisions

Short records of choices that would be expensive or confusing to revisit
without knowing why they were made. Add to this file rather than rediscovering
an argument six months from now.

---

## ADR-001 — TypeScript end to end

**Date:** 2026-09-13 · **Status:** accepted

The product must work on desktop web and mobile web, with a possible native app
later. A patient app is explicitly out of scope (patients get WhatsApp and a
browser link, no download), so the real native candidate is a chairside tablet
for Phase 1 charting.

An installable PWA covers nearly all of that — full screen, home-screen icon,
service-worker caching for flaky clinic wifi — and the BRD only requires
graceful degradation, not true offline-first. Where a PWA would not be enough is
direct device integration for imaging (RVG sensors, DICOM), which is unknown
until the hardware survey in BRD Q6.

So: one language across every surface, with a clean API boundary so an
Expo client can be added without a rewrite.

**Rejected: Django.** Its strongest argument was Python's `Decimal` for money —
but money is stored as integer paise regardless of language (ADR-002), which
mostly dissolves that advantage. The free Django admin is a real loss; we accept
it and will build a minimal internal ops screen in Phase 0 rather than pretend
we won't need one.

---

## ADR-002 — Money is integer paise, with no decimal library

**Date:** 2026-09-13 · **Status:** accepted

`src/domain/money.ts` is the only place money arithmetic happens. Amounts are
integers of paise. Construction from a float throws. Rates are basis points, not
fractions. Multiplication goes through `BigInt` so large amounts cannot silently
exceed `Number.MAX_SAFE_INTEGER` mid-calculation.

`allocate()` carries a hard guarantee: splitting an amount always sums back
exactly to that amount. Receipt allocation across invoices, CGST/SGST splitting
and ITC apportionment all depend on it.

**Why not a decimal library:** it would be a dependency in the hottest, most
security-relevant path in the system, and it invites the habit of holding
decimal rupees somewhere. Integer paise makes the wrong thing hard to express.

---

## ADR-003 — Supabase now, portable by design

**Date:** 2026-09-13 · **Status:** accepted

Supabase in the Mumbai region gives Postgres, auth and file storage in one, in
an Indian region, which satisfies the data-residency requirement (BRD NFR-04).

Two constraints keep migration cheap:

- **Auth is referenced only through our own interface.** Feature code never
  imports the Supabase client directly. `users.authSubject` is our reference to
  whatever the provider calls the identity.
- **No Supabase-specific SQL.** Tenancy is enforced in the application data
  layer, not through RLS policies. This costs us Supabase's best feature; we
  take that deliberately so that moving to plain Postgres is a weekend rather
  than a rewrite, and so tenancy is enforced exactly as the BRD specifies.

**Revisit when:** the infra bill becomes material, or RLS would materially
reduce the risk of a cross-tenant read.

---

## ADR-004 — CGST and SGST are split, not computed independently

**Date:** 2026-09-13 · **Status:** accepted

Total tax is computed once at the full rate, then divided in two using
`allocate()`. The obvious alternative — computing each half at half the rate —
rounds twice and can drift a paisa, so that CGST + SGST does not equal the tax
actually charged.

A one-paisa discrepancy on a tax return is exactly the sort of thing an auditor
circles, and exactly the sort of thing that destroys a practice owner's
confidence in software they are being asked to trust with their books.

See `tax.test.ts` → "never loses a paisa on an odd tax split".

---

## ADR-005 — Balances are derived, never cached

**Date:** 2026-09-13 · **Status:** accepted

A patient's balance is the sum of their ledger entries, computed on read. There
is no balance column on the patient row, and there should never be one.

A cached total will eventually disagree with the entries behind it. When that
happens in financial software, you have not got a stale cache — you have got a
customer who no longer believes any number the system shows them. If the
derivation becomes slow, the answer is a materialised view that can be rebuilt
from the entries, not a column that is written to.

Same rule for invoice outstanding amounts and day-book totals.

---

## ADR-006 — Rounding conventions

**Date:** 2026-09-13 · **Status:** accepted

- **Tax and rate application:** half away from zero. That is what Indian tax
  practice expects and what a human re-checking the arithmetic will do.
- **`floor` and `ceil`:** mean what `Math.floor` and `Math.ceil` mean — toward
  −∞ and +∞, not toward or away from zero. A negative half-paisa floors to −1.
  Anything wanting truncation-toward-zero must say so explicitly.
- **Invoice totals:** rounded to the nearest whole rupee, with the difference
  recorded on the invoice as `roundingPaise`, so the document reconciles.
