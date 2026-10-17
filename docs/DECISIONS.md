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

---

## ADR-007 — Clinical artifacts are separate typed tables, not one jsonb column

**Date:** 2026-09-17 · **Status:** accepted (records PRD Q8, settled 2026-09-13)

Each specialty attaches its structured clinical data as its own child tables
referencing `encounter_id` (`dental_chart_entry`, `perio_exam`, later an
aesthetics artifact). `encounters` keeps only what every specialty shares:
`encounter_type`, `specialty_module_id`, a universal `soap_note` and coded
`diagnosis_codes`.

**Why:** real foreign keys, indexes and queries on data a medico-legal dispute
will ask about ("what did tooth 36 look like at visit 4"); consistency with a
domain layer that already prefers explicit types; and no forty nullable
dental-only columns on `encounters`.

**Rejected: one jsonb column with a Zod discriminated union.** Ships a new
specialty faster, but moves integrity from Postgres into application code and
makes cross-patient clinical reporting slow and fragile. A new specialty is
already only one migration plus one registry entry, so jsonb buys little.

---

## ADR-008 — Provider is separate from User

**Date:** 2026-09-17 · **Status:** accepted

A `User` is a login. A `Provider` is a clinician the practice bills and pays
for: org-scoped, carrying council registration number, specialty and
`engagement_type` (`owner_partner | salaried | associate | visiting`), with
branch-scoped `provider_memberships`. `providers.user_id` is nullable.
Clinical and financial foreign keys (`doctor_id` on appointments, encounters,
procedures, price lists, payout rules) point at `providers`, not `users`.

**Why:** a visiting specialist may be billed and paid for without ever having
a login; a practice manager has a login and is not a provider; and a doctor
floating across branches must be one identity so production rolls up without
joining on names. Employment terms belong to the provider, not to access
control (see ADR-009).

**Invariant:** a membership with role `doctor` requires the user to be linked
to an active provider.

---

## ADR-009 — Seven roles, capability-checked, granted per branch

**Date:** 2026-09-17 · **Status:** accepted

Roles: `owner`, `branch_manager`, `doctor`, `clinical_assistant`,
`front_desk`, `accountant`, `auditor`.

A user may hold several grants. A grant with `branch_id = null` is org-wide.
`owner` is only ever org-wide. Code never checks a role name: it checks a
capability (`invoice.issue`, `day.reopen`, `finance.view_branch`,
`payout.view_own`…) against a role→capability matrix held as data in
`src/domain/permissions.ts`, so the role list can change without touching
feature code.

| Capability | owner | branch_manager | doctor | clinical_assistant | front_desk | accountant | auditor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Register / edit patient demographics | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| View clinical record | ✓ | ✓ | ✓ | ✓ | | | |
| Record encounter, diagnosis, prescription (sign) | | | ✓ | | | | |
| Draft clinical notes / chart for a doctor to sign | | | ✓ | ✓ | | | |
| Issue invoice, take receipt | ✓ | ✓ | ✓ | | ✓ | | |
| Discount above threshold, credit note, write-off | ✓ | ✓ | | | | | |
| Close day | ✓ | ✓ | | | ✓ | | |
| Reopen a locked day | ✓ | | | | | | |
| Own production and payout | ✓ | ✓ | ✓ | | | | |
| Branch P&L, all doctors' figures, GST papers | ✓ | ✓ (own branches) | | | | ✓ | ✓ read |
| Exports (Tally, full data) | ✓ | | | | | ✓ | |
| Catalogue and price lists | ✓ | ✓ (branch overrides) | | | | | |
| Manage users | ✓ | ✓ (own branch, not owner) | | | | | |
| Audit log | ✓ | | | | | | ✓ |

An owner who is also a dentist holds `owner` + `doctor`. Clinical signing is
deliberately **not** in `owner`: signing a prescription needs a registered
dentist, not an owner. Accountants and auditors never see clinical data (DPDP
data minimisation). Auditor grants carry an expiry (`memberships.expires_at`).

**Why not the six generic roles in PRD v1.0** (org_admin, branch_admin,
clinician, front_desk, accountant, auditor)? The case for them is real: fewer
roles, and "clinician" sounds specialty-neutral. It fails on one point that
matters: `clinician` puts assistants, hygienists and nurses in the same bucket
as the dentist, so either assistants can sign diagnoses and prescriptions (a
medico-legal problem) or the dentist cannot. That split has to exist.
`org_admin`/`branch_admin` also read like IT roles to a clinic owner, and
`owner`/`branch_manager` already appear in the schema, seed and Phase-0 PRD.

**Why the schema's `associate_doctor` is dropped:** the case for keeping it is
that associates must not see branch money. But no doctor who is not an owner
or manager should see branch money, salaried or not — so the role grants
nothing `doctor` doesn't. What does differ is how they are paid, which is
`providers.engagement_type` plus `payout_rules`. Keeping pay terms inside
access control means that promoting an associate to partner silently changes
what they can see. Removing a Postgres enum value later is painful; removing
it before the first migration costs nothing.

`assistant` becomes `clinical_assistant` so the same role covers dental
assistants, derma therapists and nurses without renaming later.

**Deferred, not rejected:** an org policy limiting doctors to patients
booked with them, for chains with visiting consultants. It is a policy
setting, not a role.

---

## ADR-010 — Document numbering: 16-character, per-branch, per-FY series

**Date:** 2026-09-17 · **Status:** accepted (format to be seen by the CA
together with PRD Q4)

CGST Rules 46(b) (tax invoice), 49 (bill of supply), 50 (receipt voucher) and
53 (credit note) require a **consecutive serial number of at most 16
characters, using only letters, digits, `-` and `/`, unique for a financial
year**, in one or several series. The format proposed on 2026-09-13
(`KNP/2026-27/000123`, 18 characters) breaks that rule and is withdrawn.

| Series | Format | Example | Length |
| --- | --- | --- | --- |
| Sales documents | `BBB/YY-YY/NNNNN` | `KNP/26-27/00123` | 15 |
| Receipts | `BBBR/YY-YY/NNNNN` | `KNPR/26-27/00123` | 16 |
| Credit notes | `BBBC/YY-YY/NNNNN` | `KNPC/26-27/00012` | 16 |

- `BBB` is the branch code: exactly three uppercase letters or digits, unique
  in the org, **immutable once a document has been issued**.
- `YY-YY` is the Indian financial year (April–March); the counter resets each
  FY. That is standard practice, and carrying the FY keeps numbers unique
  across years, so a patient's two `00123`s never meet.
- Five digits give 99,999 documents per branch per series per year. The
  formatter **throws** past that or past 16 characters, with a test at the
  limit. It never silently widens.
- One sales series covers every sale document. Under GST its title depends on
  what it contains: a **tax invoice** (all taxable), a **bill of supply** (all
  exempt), or an **invoice-cum-bill of supply** (Rule 46A: mixed, to an
  unregistered person — every patient). Title is computed at issue from the
  lines. If each title had its own series, a draft whose lines changed would
  change series. An unregistered branch issues a plain bill from the same
  series with no GST particulars.
- A number is assigned **at issue, never at draft**, inside the issuing
  transaction, from a locked `invoice_series` row. A voided document keeps
  its number and stays visible, so the series has no holes.

**Uniqueness is really per GSTIN.** GST registration is per state, so two
branches in one state share a GSTIN. Branch codes keep their series apart.
This also means registration status is a property of the org in a state, not
a free per-branch flag: the data layer must stop two same-state branches
disagreeing on `gst_registered`/`gstin`.

**Rejected:** one org-wide counter (branches block each other and a branch
cannot be read off the number); separate series per document title (see
above); dropping the FY (legal, but every year repeats numbers).

---

## ADR-011 — Staff sign in with an emailed one-time code

**Date:** 2026-09-17 · **Status:** accepted for Phase 1

Email is the identity. Staff enter their email, receive a **6-digit code**,
and type it in. No passwords in Phase 1. Implemented behind
`src/lib/auth` with a Supabase adapter (`signInWithOtp` / `verifyOtp`, with
the magic-link template changed to send `{{ .Token }}`).

**Why a code, not a magic link:** a reception PC is often not where the staff
member reads email. A link opened on a phone signs in the phone, not the desk.
A code works across devices.

**Why not passwords:** the case for them is speed — no trip to the inbox. But
staff sign in about once a day on long sessions, so the saving is small.
Meanwhile shared reception passwords end up on sticky notes, and shared logins
destroy the audit trail this product sells on. Phone OTP may still fit front
desks better, but it costs per SMS and needs DLT registration in India, so it
waits.

**Conditions before any real clinic uses it:**
- **Custom SMTP** (Resend, Postmark or SES). Supabase's built-in sender
  allows about 2 emails an hour and is for development only.
- **One email per person, no shared accounts.** Onboarding says so
  explicitly.
- Sessions long enough for a clinic day (target: 12-hour idle timeout,
  re-auth at most daily). Sensitive actions such as day reopen and write-off
  re-verify with a fresh code later.
- A rejected email address (not invited) gets a generic response, so the form
  cannot be used to enumerate staff.

**Revisit when:** a design partner's front desk finds the daily code friction
real, or SMS/WhatsApp OTP cost is folded into the model.
