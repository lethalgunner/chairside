# Sprint 2 · "Money in, on WhatsApp" (CPO + CTO, 29 Oct 2026)

**Goal:** turn what Chairside already knows (dues, the day's close) into money collected and an owner who knows his day without opening the app. Every feature runs on what Indian clinics already use, UPI and WhatsApp, with **no paid API, no new vendor and no patient data leaving the clinic's own hands**.
**Base:** `main` at `6bf8f5b` (Sprint 1, committed, not yet pushed). **Research:** competitor features (Dental Intelligence follow-ups and huddle, Dentally lab tracking, Indian tools with WhatsApp recall and a UPI QR on invoices); WhatsApp click-to-chat FAQ; NPCI UPI linking spec. See project doc `chairside-cpo-sprint-2.md`.

## Tickets
| ID | Ticket | Who uses it | Size |
|---|---|---|---|
| T31 | **UPI QR to pay.** Owner sets the branch UPI ID and payee name in Settings → Branches. The bill page and Record payment show a scan-to-pay QR for the exact amount due, labelled with the bill number | Front desk, patient at the desk | M |
| T32 | **WhatsApp dues reminder.** On Receivables and the patient page, "Remind on WhatsApp" opens WhatsApp with a polite, pre-written message (first name, branch, amount, UPI ID). Each reminder is logged, and the list shows "Reminded 2 days ago" | Front desk, owner | M |
| T33 | **Day summary to WhatsApp.** After a day is closed, "Send summary on WhatsApp" opens WhatsApp with the day's numbers for the owner | Front desk → owner | S |
| T34 | **Amount in words** on the bill ("Rupees Ten Thousand Six Hundred Ninety only"), Indian numbering with lakh and crore | Everyone, CA | S |
| T35 | **Day-close streak** on Today: "Closed 6 days in a row" per branch | Owner, front desk | S |

**Cut (CTO):** keyboard shortcuts. They clash with typing in fields and with screen readers, and their value is below the review cost now. **Deferred:** lab work tracker (needs appointments to be useful, G1); promise-to-pay dates (wait for reminder data).

## CTO constraints
- **No external QR service.** QR codes are drawn on the server as inline SVG by a zero-dependency library (`qrcode-generator`). A hosted QR API would see every amount and UPI ID.
- **UPI link** follows the NPCI linking spec: `upi://pay?pa=<vpa>&pn=<payee>&am=<rupees.paise>&cu=INR&tn=<bill no>`. `am` is the exact outstanding amount with 2 decimals, from paise. No `tr`/`mc` (the branch UPI ID may be a personal VPA). `tn` is the bill number only: no patient name, no treatment.
- **UPI ID** is validated (`name@handle`, 3–256 chars, one `@`), owner-only (`branch.manage`), audited via the existing branch update. Settings shows a "scan it yourself with ₹1 first" hint: a wrong UPI ID sends patients' money to the wrong account.
- **QR is not proof of payment.** The payment is still recorded by hand after the desk sees it arrive. Copy says so.
- **WhatsApp is click-to-send `wa.me` only** (standing position). No number is stored for the owner (`wa.me/?text=` lets the sender pick). Patient number = `91` + the stored 10-digit mobile.
- **Message text has no clinical detail** (CLAUDE.md): first name, branch name, amount, UPI ID, branch phone. Never treatments, teeth, doctor names.
- **Pilot 0 guard:** while bills are in the test series, the reminder dialog says "Check this amount in your old software before sending" and needs a tick. A wrong reminder to a real patient is the biggest risk this sprint adds.
- **Reminder log** is a new append-only table `payment_reminders` (org, branch, patient, amount, sent_by, sent_at) with `ENABLE ROW LEVEL SECURITY`. The message text is not stored. New capability `patient.remind`: owner, branch manager, front desk.
- **Streak counts closes, not zero variance.** Rewarding zero variance invites fudged counts; a variance is information. Days without activity are skipped, as in the scorecard.
- The usage log records `reminder.open` and `daysummary.open` (kind, user, branch, time only).
- Conventions hold: paise only, words are generated from paise by a pure domain function with unit tests; every action starts with `getContext()`/`signedOut()` (ADR-013).
