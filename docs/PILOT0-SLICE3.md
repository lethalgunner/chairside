# Pilot 0 · Slice 3: parallel-run ready (CTO brief, 21 Oct 2026)

**Input:** CPO triage `docs/QA-TRIAGE-2026-10-21.md` ("before 26 Oct" rows) and QA review `docs/QA-REVIEW-2026-10-21.md` (evidence, file:line, screenshots).
**Branch:** `p0/parallel-ready`, stacked on `p0/owner-settings` (Slice 2, not yet reviewed). One commit per ticket, tests in the same commit.

## T18 · Q5/Q8: actions that never finish on screen (fix first)
Facts: the action returns in 1–60 ms; the follow-up `router.push` / `router.refresh` inside `startTransition` sometimes never commits, so `pending` stays true. Server-side `redirect()` and dropping `revalidatePath` did not cure it in your loops. We are already on the newest Next 15.5 patch (15.5.28).
Call: make every post-action navigation **self-healing**, in one small client helper used by every form:
- `afterAction(router, { to?: string })`: does the soft `router.push(to)` / `router.refresh()`, and if the page has not changed (pathname/search for push; a render key for refresh) within 2.5 s, falls back to a hard `window.location.assign(to ?? location.href)`.
- Move the navigation **out of** the transition callback where possible (await the action inside, set state, then navigate after the transition ends) and keep the button disabled until navigation or fallback happens, so no double submit.
- Log a client-side `console.warn('[nav-fallback] <form>')` when the fallback fires (no data), so we can count it.
- Test: an e2e that forces the stall (e.g. block the RSC request for the target route once with `page.route`) and proves the fallback lands on the right page and the patient exists exactly once. Then run the full e2e suite 10 times in a loop with no other suite running; report the pass count.

## T19 · Q7: cancel a payment, and an honest paid-bill cancel
- Mirror the bill-cancel pattern exactly (`voidInvoice`, `invoices.ts:~395`): new columns on `receipts`: `cancelled_at`, `cancelled_by`, `cancel_reason` (migration via `npm run db:generate`; review the SQL), status marking plus a reversing ledger entry, audited. Do not delete allocations: every derived figure (invoice outstanding, patient balance, advances, day totals by mode, expected drawer cash, receivables, dashboard) must exclude cancelled receipts and their allocations. List every query you touched in the commit message.
- Owner only (new capability `receipt.cancel`), reason required, refused on a closed day ("Reopen the day first").
- Receipt and patient screens show a cancelled payment struck through with its reason.
- Paid bill: instead of hiding Cancel, say "This bill has payments. Cancel them first:" with links to each payment.
- DB tests with hand-calculated figures: cancel one of two split payments → bill outstanding, patient balance, day collected by mode and expected cash all correct; cancel on closed day refused; cancel twice refused; desk refused.

## T20 · Q9: front desk cancels its own unpaid bill, same day
- Front desk can cancel a bill only if they created it, it is unpaid, and its business date is today at that branch; reason required. Everyone else without `invoice.void` sees "Only the owner can cancel this bill" instead of nothing.
- Implement as a rule in the domain/services layer (not role-name checks in the page); unit + DB tests for each condition.

## T21 · Q10: old system vs Chairside, every day
- Day close: after the tally is entered, show a three-row comparison: bills (old count, Chairside count, difference), collected (old ₹, Chairside ₹, difference), and a plain verdict ("Matches", "Chairside is ₹616 short: 1 bill may be missing", "Chairside has 2 more bills than the old system"). Fix the "All N bills entered" copy when counts differ either way.
- Closed day card shows the same comparison.
- Owner dashboard: a "Parallel run" table, last 7 business days × branch: closed?, bills old/new, collected old/new, difference, highlight non-zero differences. Must read on a 390 px phone without sideways scrolling (stack per day/branch below 600 px).
- All amounts from existing columns (`legacy_bill_count`, `legacy_collected_paise`); differences derived, never stored.

## T22 · Input traps (Q11, Q14, Q16, Q17)
- Q11 quantity: keep raw text while typing, validate on blur/submit, min 1, integer; −/+ buttons.
- Q14 search: normalise the query with `domain/phone` (strip +91, leading 0, spaces) before matching digits.
- Q16 amounts: accept "500/-", "Rs 500", "Rs. 500", "₹500", "1,500"; anything else shows an inline error instead of silently disabling the button. One shared parser in `src/domain/money.ts` with unit tests; use it in payments, discounts, cash paid out, day close, price list.
- Q17 discount over price: catch in the builder, message in rupees with the item name; never show paise to staff. Grep for any other user-facing "paise".

## T23 · Q12: a network blip never wipes a form
- Every form's submit catches a failed fetch, keeps its state, and shows "Not sent: check the internet and press again. Nothing was saved." The idempotency keys already make a retry safe; keep the same key on retry. Test with Playwright offline mode on bill issue and payment.

## T24 · Desk speed (Q15, Q21) and owner-only price list
- After a payment, if the bill still has a balance: "Record another payment (₹X still due)" with the amount filled in; remove the numeric placeholder from the amount field; label the fill button "Fill ₹X".
- Bill issued confirmation shows the total. Remember the last doctor picked per branch on this device (localStorage, try/catch); keyboard focus order includes Doctor.
- `catalogue.manage` becomes owner-only (CPO call Dev-1). Update tests.
- Q23: exclude `.claude/**` in vitest configs.

## Rules
Same environment rules as Slice 2 (DBs `chairside_dev_test` / `chairside_dev_e2e`, `E2E_PORT=3200`, no npm install, no network services, no push). Run the whole suite before each commit. Update `docs/QA-REPORT.md` (Slice 3 section) and fill the reviewer checklist below.

## Reviewer checklist for KS
(dev fills in: five things with file:line)
