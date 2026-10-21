# Pilot 0 · Slice 2: owner settings (CTO brief, 21 Oct 2026)

**Why now.** Pilot 0 is live (chairside-pi.vercel.app, Supabase Mumbai). The parallel run starts Mon 26 Oct. Three blockers are still "KS edits JSON or runs a GitHub workflow": staff logins, the real price list, and branch GST status. KS found the workflow hard and the GitHub DB secret is not set. Moving these into the app, owner-only, removes the blockers without new infrastructure.

**Call.** Build three small, owner-facing settings screens plus one observability fix. No schema change is needed for T14–T16. Everything below stays inside ADR-012 (invite links, scrypt passwords, no RLS yet).

## T14 · Team: invite and deactivate staff (`/settings/team`)
- New capability `staff.manage`: owner only (not branch_manager in Pilot 0). Add to `permissions.ts` + unit tests.
- List users of the org: name, email, roles with branch, active, "invite pending / expired / set up".
- Invite form: name, email, role (all 8 roles in the enum, with plain labels), branch (required unless role is owner). Owner grants org-wide only.
- On submit: create or reuse the user (same rules as `scripts/add-user.ts`: email lower-cased, an email in another org is refused), add the membership, `createInvite()`, and show the link **once** with a Copy button and "works once, for 72 hours". Never store or log the raw token.
- "New link" for a user who has not set up, or whose link expired (cancels the old one, as `createInvite` already does).
- Deactivate / reactivate a user: sets `users.active`; deactivating also deletes their sessions. An owner cannot deactivate themself, and the last active owner cannot be deactivated.
- Move the shared logic out of `scripts/add-user.ts` into `src/services/staff.ts`; the script calls the service.
- Audit every change through the audit wrapper.

## T15 · Price list (`/settings/catalogue`)
- Capability `catalogue.manage` (already exists).
- Table of items: code, name, category, price (₹ with paise), tax category, HSN/SAC, GST %, active.
- Add item, edit item, deactivate item (never delete: invoice lines reference items).
- Validation (Zod + a domain function with unit tests): code unique per org, price ≥ 0 as integer paise via the existing `toPaise`, GST rate one of 0, 5, 12, 18, 28, 40 % (stored as bp; GST 2.0 moved most goods to 5/18/40, but the set stays permissive until a CA confirms), `is_goods` derived from tax category as in `scripts/seed.ts`, exempt healthcare forces 0%.
- Banner on the page: "GST rates are not yet confirmed by a CA. Issued bills keep the rate they were issued with." Price and rate changes affect only bills issued afterwards (line snapshot already guarantees this; add a DB test that proves it).
- Bill builder must hide inactive items.

## T16 · Branch details (`/settings/branches`)
- Capability `catalogue.manage` for now (owner and branch manager), or a new `branch.manage` owner-only — your call, but justify it in the PR.
- Edit name, address line, city, state, phone, GST registered, GSTIN, day-close tolerance (₹), default float (₹).
- GSTIN required when registered; validate the 15-character format and that its first two digits match the branch state code (map for at least UP 09 and MH 27, then all states). Unit tests.
- Branch code is read-only (it is in every document number).

## T17 · Action timing log (QA Q5)
- In `src/app/actions/run.ts`, log `[action] <name> <ms>ms ok|error` for every action, with no payload and no patient data. Warn when over 3000 ms. Name comes from a new first argument to `run()`.

## Shared
- Settings entry in the sidebar, shown only to users who can do at least one of the above. Add `/settings` to the access sweep in `e2e/01-access.spec.ts` (anonymous → login; front desk → 403/not shown).
- Business logic in `src/services/`, actions are thin (Zod + `requireContext` + capability + service).
- Tests in the same change: unit tests for validation and permissions, DB tests for the services (invite, deactivate guards, catalogue edit does not change issued bills), and one e2e per screen (owner invites a front desk user and the link sets a password; owner adds an item and it appears in the bill builder; owner marks a branch GST registered with a valid GSTIN).
- Keep each ticket a separate commit with a *why* message. Target under ~400 changed lines per ticket, excluding tests.

## Out of scope
MFA, PIN switch, RLS, email sending, price history per branch/doctor (`price_list_entries`), bulk import of the price list (next slice if the clinics send a spreadsheet).

## Reviewer checklist for KS (fill in at the end)
Five things to check by eye, with file:line.
