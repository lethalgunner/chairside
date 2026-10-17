# Chairside roadmap (CPO-owned)

**Updated:** 17 Oct 2026 · **Owner:** CPO agent · **Decides:** KS
Linear mirror: `docs/linear-import.csv` (run `node scripts/linear-import.mjs --go --project "Chairside"` with `LINEAR_API_KEY`; existing titles are skipped).

## Where we are
**Pilot 0 is built and tested, not yet deployed.** A login-protected web app on Postgres that lets both Dr Vij branches enter bills, payments and the day close alongside their existing software for a few days. 126 automated tests pass (78 unit, 23 database, 25 browser). One money bug (S1) was found by QA and fixed with regression tests.

## Now: Pilot 0 parallel run (target start Mon 26 Oct, latest 2 Nov)
| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Supabase Mumbai + Vercel bom1 accounts, deploy per `docs/DEPLOY.md` | KS | Todo |
| 2 | Real price list and GST status per branch into `seed/pilot0.json` | KS + clinics | Todo |
| 3 | GST rates for prosthetics and oral care confirmed by a CA (GST 2.0) | KS + CA | Todo |
| 4 | One login per staff member; data note to Dr Anshul | KS | Todo |
| 5 | Parallel week at Pune (KS on site), then Kanpur (video) | KS, QA agent | Todo |

**The week must show** (Pilot 0 plan §6): ≥80% of the old system's bills also in Chairside by day 3; under 20 extra minutes a day; day totals match on 4 of 5 days or gaps explained by missed entries; zero calculation bugs; Dr Anshul opens the two-branch view most evenings; a ranked friction list.

## Next: G1, Phase 1 go-live (switch off the incumbent at a branch)
Only after Pilot 0 passes. Scope and gates are in `chairside-cto-cpo-phase1-plan.md`. Items deferred by ADR-012 come back here: row-level security, MFA and PIN switch, append-only audit, PITR and restore drill, CA gate, DPA and consent. New product: appointments-lite, visit notes and prescriptions, estimates-lite, import from the incumbent, print templates, downtime runbook.

## Later
G2 paid beta (subscription billing, entitlements, onboarding wizard, first non-family clinics, pentest) → G3 self-serve → G4 chain pack (payouts, Tally, P&L) → G5 vertical #2 after >100 paying clinics. ABDM demand-led only.

## Demand track (runs in parallel, no engineering)
Dr Anshul: 10 non-family owner conversations by 30 Apr 2027, at least half with 2+ doctors or branches. KS: leakage audits on their exports. Target: 2 paid letters of intent at ≥₹10k/year. Pilot 0 screenshots (synthetic data) are the first sales material.

## Decisions waiting for KS
| # | Decision | Recommendation |
|---|---|---|
| R1 | Hosting accounts (Supabase Pro Mumbai, Vercel) | Create them; ~$45/month plus usage before PITR |
| R2 | Update GST defaults in code after CA confirms | Yes, as a reviewed change with tests |
| R3 | Who owns the Linear mirror going forward | CPO agent drafts the CSV; KS runs the importer (the Linear connector here can't write issues) |
