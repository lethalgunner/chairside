# Sprints 4–6 brief (CTO → dev, 8 Nov 2026)

Source: `chairside-cpo-feature-plan-nov.md` and `chairside-cto-feature-architecture-nov.md` (project docs). Linear LET-166…176.
KS approved on 8 Nov: build all of it; defaults D1–D7 apply (15-min slots, one-way calendar feed with no patient names,
owner-only "+ New item", the clinic sells medicines, the garbled note = a complaint/diagnosis line, plan price on the bill).

| Order | Ticket | Rule that must hold |
|---|---|---|
| 1 | LET-166 providers (ADR-017) | doctor_id → providers in one migration; backfilled provider id = user id, so no posted row is updated |
| 2 | LET-167 appointments | no double-booking a doctor, enforced by Postgres; times stored UTC, shown IST |
| 3 | LET-168/169 treatment plans + work card | "done" creates the existing procedure at the agreed price; issueBill unchanged; estimate is not a tax document |
| 4 | LET-170 calendar feed | hashed token, no patient names, no-store |
| 5 | LET-171 owner summary | totals only |
| 6 | LET-172/173 medicines + prescriptions | signed prescriptions are append-only; rx.write + linked provider |
| 7 | LET-174 print + bill header | browser print CSS, logo ≤200 KB in Postgres, "Test, not a tax invoice" |
| 8 | LET-175 roles | capability model unchanged; last owner protected |
| 9 | LET-176 stock-lite | append-only movements, on-hand derived; bill sale writes the movement in the same transaction |

Every ticket: migration reviewed, new tables `ENABLE ROW LEVEL SECURITY`, service tests (permissions, audit, other org refused), one browser test.
