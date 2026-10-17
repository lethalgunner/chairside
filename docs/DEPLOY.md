# Deploying Pilot 0 (GitHub → Vercel, database on Supabase Mumbai)

Everything runs from GitHub and the two dashboards; nothing to install on a laptop.
Steps marked **KS** need you because they involve passwords or connection strings. Never paste those into a chat.

## 1. Code on GitHub (KS, once)
Clone the bundle and push it (see `chairside-wip/HOW-TO-USE.md`). Branches: `pilot0` (the app) and `main`. In GitHub, make `pilot0` the default branch, or merge it into `main`.

## 2. Supabase (KS)
1. New project, region **South Asia (Mumbai)**, Pro plan. Save the database password in your password manager.
2. *Connect* → copy two strings, replacing `[YOUR-PASSWORD]` (URL-encode special characters such as `@ # / ?`):
   - **Transaction pooler** (port **6543**) → for the app. Call it `DATABASE_URL`.
   - **Session pooler** (port **5432**) → for migrations and admin tasks. Call it `DATABASE_URL_MIGRATE`.
   Both pooler hosts are IPv4, which Vercel and GitHub Actions need. The "direct connection" is IPv6-only, so don't use it here.
3. Don't create Supabase Auth users or copy the service-role key. Chairside signs people in itself (ADR-012).

## 3. Vercel (KS)
1. *Add New → Project* → import the GitHub repo. Framework: Next.js. Production branch: the one from step 1.
2. *Environment Variables*, **Production only** (untick Preview and Development so preview builds can't reach the live database):
   - `DATABASE_URL` = transaction pooler string
   - `DATABASE_URL_MIGRATE` = session pooler string
3. Deploy. `vercel.json` already sets the Mumbai region (`bom1`) and the build command, which **applies database migrations before building** (production only).
4. Open `https://<project>.vercel.app/api/health` and expect `{"ok":true}`.

## 4. GitHub Actions secrets (KS)
Repo → *Settings → Secrets and variables → Actions → New repository secret*:
- `DATABASE_URL_MIGRATE` = the session pooler string
- `APP_URL` = `https://<project>.vercel.app` (or your custom domain)

## 5. Load the clinic and invite people (anyone with repo access)
1. Edit `seed/pilot0.json` in GitHub's web editor: real prices, service vs goods, GST status and GSTIN per branch. Commit.
2. *Actions → Admin → Run workflow* → task **seed** (file `seed/pilot0.json`). For a dry run first, use `seed/demo.json`.
3. *Actions → Admin → Run workflow* → task **invite**, once per person:
   - Dr Anshul: `link_doctor` = `Dr. Anshul Vij`, roles `owner`, branch blank.
   - Front desk Pune: name, email, roles `front_desk`, branch `PUN`.
   - Front desk Kanpur: name, email, roles `front_desk`, branch `KNP`.
   The run's **Summary** shows a one-time link (valid 72 hours). Send it to that person only. They choose their own password, so nobody else ever knows it.

## 6. Before staff use it
- [ ] CI green on the deployed commit (typecheck, unit, database, dependency audit, build, browser tests).
- [ ] Bills show the `T` test series (e.g. `PUNT/26-27/00001`). Don't set `CHAIRSIDE_TEST_SERIES` during Pilot 0.
- [ ] Dr Anshul has the one-page data note (Pilot 0 plan §3 item 6).
- [ ] Staff know the old software stays the official record and Chairside bills are never handed to patients.
- [ ] An uptime check on `/api/health` alerts your phone.

## 7. Changes after go-live
Push to the production branch → CI runs → Vercel builds, migrates, deploys. For schema changes run `npm run db:generate`, review and commit the SQL, and deploy outside clinic hours (after 21:30 IST or Sunday). *Actions → Admin → migrate* applies migrations by hand if ever needed.

## 8. Ending the pilot
Data is disposable (ADR-012). Before a real go-live, start a fresh Supabase project rather than deleting rows, and keep the old one read-only until Dr Anshul confirms. Deleting a Supabase project also deletes its backups.
