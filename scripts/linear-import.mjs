#!/usr/bin/env node
/**
 * Push docs/linear-import.csv into Linear via the GraphQL API.
 *
 *   node scripts/linear-import.mjs                 # dry run, changes nothing
 *   node scripts/linear-import.mjs --go            # actually creates issues
 *   node scripts/linear-import.mjs --go --project "Chairside Phase 0"
 *
 * Needs LINEAR_API_KEY in the environment. Create one at
 * Linear → Settings → Security & access → Personal API keys, and revoke it
 * afterwards if you would rather not keep it around.
 *
 * The key stays on your machine. Nothing here sends it anywhere except
 * api.linear.app.
 *
 * Safe to re-run: an issue whose exact title already exists in the team is
 * skipped rather than duplicated.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '..', 'docs', 'linear-import.csv');
const API = 'https://api.linear.app/graphql';

const args = process.argv.slice(2);
const GO = args.includes('--go');
const TEAM_ARG = argValue('--team');
const PROJECT_ARG = argValue('--project');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const KEY = process.env.LINEAR_API_KEY;
if (!KEY) {
  console.error(
    '\nLINEAR_API_KEY is not set.\n\n' +
      '  1. Linear → Settings → Security & access → Personal API keys → New key\n' +
      '  2. export LINEAR_API_KEY="lin_api_..."\n' +
      '  3. node scripts/linear-import.mjs          (dry run first)\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: KEY },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Linear API ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear API error: ${JSON.stringify(json.errors, null, 2)}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// CSV — a real parser, because descriptions contain commas and quotes
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const tickets = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  console.log(`\nRead ${tickets.length} tickets from docs/linear-import.csv`);

  // --- team ---
  const { teams } = await gql(`query { teams { nodes { id key name } } }`);
  const team = TEAM_ARG
    ? teams.nodes.find((t) => t.key === TEAM_ARG || t.name === TEAM_ARG || t.id === TEAM_ARG)
    : teams.nodes[0];
  if (!team) {
    console.error(`No team matched "${TEAM_ARG}". Available: ${teams.nodes.map((t) => `${t.key} (${t.name})`).join(', ')}`);
    process.exit(1);
  }
  if (!TEAM_ARG && teams.nodes.length > 1) {
    console.log(`  Several teams exist; defaulting to "${team.name}". Use --team KEY to pick another.`);
  }
  console.log(`  Team: ${team.name} (${team.key})`);

  // --- labels ---
  const { issueLabels } = await gql(
    `query { issueLabels(first: 250) { nodes { id name team { id } } } }`,
  );
  const labelMap = new Map();
  for (const l of issueLabels.nodes) {
    if (!l.team || l.team.id === team.id) labelMap.set(l.name, l.id);
  }

  const wanted = new Set();
  for (const t of tickets) {
    for (const name of t.Labels.split(',').map((s) => s.trim()).filter(Boolean)) wanted.add(name);
  }
  const missing = [...wanted].filter((n) => !labelMap.has(n));
  console.log(`  Labels: ${wanted.size} referenced, ${missing.length} need creating`);

  // --- workflow states ---
  const { workflowStates } = await gql(
    `query($teamId: ID!) {
       workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name type } }
     }`,
    { teamId: team.id },
  );
  const stateMap = new Map(workflowStates.nodes.map((s) => [s.name.toLowerCase(), s.id]));
  const fallbackState = (type) =>
    workflowStates.nodes.find((s) => s.type === type)?.id ?? workflowStates.nodes[0]?.id;

  function resolveState(name) {
    const hit = stateMap.get((name || '').toLowerCase());
    if (hit) return hit;
    if ((name || '').toLowerCase() === 'done') return fallbackState('completed');
    return fallbackState('unstarted') ?? fallbackState('backlog');
  }

  // --- existing issues, so a re-run does not duplicate ---
  const { issues } = await gql(
    `query($teamId: ID!) {
       issues(filter: { team: { id: { eq: $teamId } } }, first: 250) { nodes { title } }
     }`,
    { teamId: team.id },
  );
  const existing = new Set(issues.nodes.map((i) => i.title));
  const toCreate = tickets.filter((t) => !existing.has(t.Title));
  const skipped = tickets.length - toCreate.length;
  if (skipped) console.log(`  Skipping ${skipped} already present by title`);

  if (!GO) {
    console.log('\n--- DRY RUN — nothing will be created. Add --go to commit. ---\n');
    if (missing.length) console.log(`Would create labels: ${missing.join(', ')}\n`);
    for (const t of toCreate.slice(0, 5)) {
      console.log(`  • ${t.Title}`);
      console.log(`      labels=[${t.Labels}] priority=${t.Priority} estimate=${t.Estimate} status=${t.Status}`);
    }
    if (toCreate.length > 5) console.log(`  … and ${toCreate.length - 5} more`);
    console.log(`\nWould create ${toCreate.length} issues in ${team.name}.`);
    console.log('Re-run with --go when that looks right.\n');
    return;
  }

  // --- create missing labels ---
  for (const name of missing) {
    const data = await gql(
      `mutation($input: IssueLabelCreateInput!) {
         issueLabelCreate(input: $input) { success issueLabel { id name } }
       }`,
      { input: { name, teamId: team.id, color: '#0E5A4E' } },
    );
    labelMap.set(name, data.issueLabelCreate.issueLabel.id);
    console.log(`  + label ${name}`);
  }

  // --- optional project ---
  let projectId;
  if (PROJECT_ARG) {
    const { projects } = await gql(`query { projects(first: 100) { nodes { id name } } }`);
    const found = projects.nodes.find((p) => p.name === PROJECT_ARG);
    if (found) {
      projectId = found.id;
      console.log(`  Project: ${PROJECT_ARG} (existing)`);
    } else {
      const data = await gql(
        `mutation($input: ProjectCreateInput!) {
           projectCreate(input: $input) { success project { id name } }
         }`,
        { input: { name: PROJECT_ARG, teamIds: [team.id] } },
      );
      projectId = data.projectCreate.project.id;
      console.log(`  Project: ${PROJECT_ARG} (created)`);
    }
  }

  // --- create issues ---
  console.log(`\nCreating ${toCreate.length} issues…\n`);
  let ok = 0;
  const failures = [];

  for (const [i, t] of toCreate.entries()) {
    const labelIds = t.Labels.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((n) => labelMap.get(n))
      .filter(Boolean);

    const input = {
      teamId: team.id,
      title: t.Title,
      description: t.Description,
      priority: Number(t.Priority) || 0,
      stateId: resolveState(t.Status),
      labelIds,
    };
    if (t.Estimate) input.estimate = Number(t.Estimate);
    if (projectId) input.projectId = projectId;

    try {
      const data = await gql(
        `mutation($input: IssueCreateInput!) {
           issueCreate(input: $input) { success issue { identifier url } }
         }`,
        { input },
      );
      const issue = data.issueCreate.issue;
      ok += 1;
      console.log(`  ${String(i + 1).padStart(3)}. ${issue.identifier}  ${t.Title.slice(0, 62)}`);
    } catch (err) {
      failures.push({ title: t.Title, error: String(err.message).slice(0, 200) });
      console.log(`  ${String(i + 1).padStart(3)}. FAILED  ${t.Title.slice(0, 55)}`);
    }

    // Linear allows ~1500 requests/hour. 250ms keeps us far under it.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nDone. ${ok} created, ${failures.length} failed.`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.title}\n    ${f.error}`);
    process.exit(1);
  }
  console.log(`\nOpen: https://linear.app/${(await gql(`query { organization { urlKey } }`)).organization.urlKey}/team/${team.key}/all\n`);
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
