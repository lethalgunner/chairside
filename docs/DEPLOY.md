# Deploying Pilot 0

Target: **Supabase Postgres in Mumbai** + **Vercel functions in Mumbai (`bom1`)**. Any Postgres 16 and any Node 22 host also work; nothing here is Supabase-specific (ADR-003).
Allow about an hour. Steps marked **KS** need an account owner.

## 1. Database (KS)
1. Create a Supabase project on the Pro plan in **South Asia (Mumbai)**. Daily backups are included on Pro; point-in-time recovery stays off for Pilot 0 (ADR-012).
2. Copy two connection strings from *Project Settings → Database*:
   - the **transaction pooler** URL, for the app (`DATABASE_URL`). The app already sets `prepare: false`, which transaction pooling needs;
   - the **direct** (or session) URL, for running migrations.
   *Verify the exact labels and ports in the Supabase dashboard; they have changed over time.*
3. Do not create Supabase Auth users and do not copy the service-role key anywhere. Pilot 0 signs people in itself.

## 2. Schema and data (KS or Claude, from a laptop)
```bash
npm ci
DATABASE_URL="<direct url>" npm run db:migrate
# Fill in seed/pilot0.json first: GST status/GSTIN per branch and the real price list.
DATABASE_URL="<direct url>" npm run seed -- seed/pilot0.json
# One login per person. Passwords are printed once; share them privately.
DATABASE_URL="<direct url>" npm run user:add -- --org "Dr. Vij Dental Clinic & Implant Center" \
  --email anshul@example.com --link-doctor "Dr. Anshul Vij" --role owner
DATABASE_URL="<direct url>" npm run user:add -- --org "Dr. Vij Dental Clinic & Implant Center" \
  --email desk.pune@example.com --name "Front desk, Pune" --role front_desk --branch PUN
DATABASE_URL="<direct url>" npm run user:add -- --org "Dr. Vij Dental Clinic & Implant Center" \
  --email desk.kanpur@example.com --name "Front desk, Kanpur" --role front_desk --branch KNP
```
Never share one login between two people: the audit trail records who did what.

## 3. App (KS)
1. Import the GitHub repo into Vercel (Pro plan; check whether the free plan's terms allow this use).
2. *Settings → Functions → Region*: **Mumbai, India (bom1)**.
3. Environment variables (Production): `DATABASE_URL` = the transaction pooler URL. Optionally `DB_POOL_MAX=3`. Nothing else.
4. Deploy. Check `https://<your-domain>/api/health` returns `{"ok":true}`, then sign in.

## 4. Before staff use it
- [ ] `npm test`, `npm run test:db`, `npm run test:e2e` green on the commit being deployed (CI does this).
- [ ] Every Chairside bill shows the `T` series (e.g. `PUNT/26-27/00001`). Do not set `CHAIRSIDE_TEST_SERIES=0` during Pilot 0.
- [ ] Dr Anshul has the one-page data note (Pilot 0 plan §3 item 6).
- [ ] Staff told: the old software stays the official record; Chairside bills are never handed to patients.
- [ ] Uptime monitor on `/api/health` (any free checker) alerting KS's phone.

## 5. Updating
Push to `main` → CI → Vercel deploys. Schema changes: `npm run db:generate`, review the SQL, commit it, run `npm run db:migrate` against the direct URL **before** the new code goes live, outside clinic hours (after 21:30 IST or Sunday).

## 6. Ending the pilot
Data is disposable (ADR-012). To wipe before a real go-live: create a fresh Supabase project, rather than deleting rows, and keep the old project read-only until Dr Anshul confirms. Deleting a Supabase project also deletes its backups.
