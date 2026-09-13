# Getting this onto GitHub

The archive contains the full repo including `.git`, with one commit already
made. `node_modules` is not included — reinstall it locally.

```bash
# 1. Extract wherever you want the project to live
tar -xzf chairside.tar.gz
cd chairside

# 2. Confirm the history came across
git log --oneline
# dce80bb Domain layer and schema for Phase 0

# 3. Install and check it works
npm install
npm test         # 59 tests, ~1s
npm run typecheck

# 4. Create the private repo and push
#    (with the gh CLI — or create it in the GitHub UI and use the git commands below)
gh repo create chairside --private --source=. --remote=origin --push

#    Without gh: create an empty private repo on github.com, then
git remote add origin git@github.com:<you>/chairside.git
git branch -M main
git push -u origin main
```

## Then connect the folder

So I can work in it directly rather than passing archives back and forth: in the
Claude desktop app, use **Add folder** and pick wherever you extracted this.
Once it's connected I can read, edit and commit in place.

## What to review first

1. `src/domain/slice.test.ts` — the whole vertical slice as one scenario. The
   clearest statement of what currently works.
2. `src/db/schema.ts` — read the header. Four decisions in there are permanent.
3. `docs/DECISIONS.md` — six ADRs covering the choices worth understanding
   before you change anything.
4. `src/domain/money.ts` — the foundation everything financial sits on.

The thing most worth your scepticism is the tax treatment in
`src/domain/tax.ts`. It is encoded from public sources, not from a CA, and it
is the claim most likely to cause damage if it's wrong.
