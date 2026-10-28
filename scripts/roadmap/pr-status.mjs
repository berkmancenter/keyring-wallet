#!/usr/bin/env node
// Moves a roadmap card to "In progress" when a pull request that refers to it opens
// (docs/plans/public-roadmap-plan.md §8, "PRs and releases"). A PR names its cards with `Refs #N` or
// `Refs owner/repo#N`, never `Closes`. Only a card in Requested, Under review or Planned moves: one already in
// progress, testing or shipped is never moved back. It writes no text anywhere, so nothing here needs the scan.
//
//   ROADMAP_TOKEN=... ROADMAP_PROJECT_ID=PVT_... node scripts/roadmap/pr-status.mjs   (reads $GITHUB_EVENT_PATH)
//   Without ROADMAP_TOKEN it moves nothing and exits 0.
//   ROADMAP_DRY_RUN=1 prints what it would change and changes nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MOVES_FROM = ['Requested', 'Under review', 'Planned'];
export const MOVES_TO = 'In progress';

// Every card a PR refers to, as { owner, repo, number }. `Refs #1, #2 and other/repo#3` names three; a bare
// `#5` elsewhere in the text names none, so a passing mention never moves a card.
export function parseRefs(text, { owner, repo }) {
  const refs = new Map();
  for (const m of String(text ?? '').matchAll(/\bRefs:?[ \t]+((?:(?:[\w.-]+\/[\w.-]+)?#\d+(?:[ \t]*(?:,|\band\b)[ \t]*)?)+)/gi)) {
    for (const r of m[1].matchAll(/(?:([\w.-]+)\/([\w.-]+))?#(\d+)/g)) {
      const ref = { owner: r[1] ?? owner, repo: r[2] ?? repo, number: Number(r[3]) };
      refs.set(`${ref.owner}/${ref.repo}#${ref.number}`, ref);
    }
  }
  return [...refs.values()];
}

async function graphql(token, query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`GraphQL: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body.data;
}

const CARD = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){
  projectItems(first:20){nodes{id project{id} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`;
const FIELDS = `query($p:ID!){node(id:$p){... on ProjectV2{field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}`;
const SET = `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}`;

export async function run({ event, token, projectId, dryRun = false, log = console.log }) {
  const pr = event.pull_request;
  const [owner, repo] = event.repository.full_name.split('/');
  const refs = parseRefs(`${pr.title}\n${pr.body ?? ''}`, { owner, repo });
  if (!refs.length) return log('no Refs in this pull request; nothing to move');
  const status = (await graphql(token, FIELDS, { p: projectId })).node.field;
  const target = status.options.find((o) => o.name === MOVES_TO);
  for (const ref of refs) {
    const name = `${ref.owner}/${ref.repo}#${ref.number}`;
    const issue = (await graphql(token, CARD, ref)).repository?.issue;
    const item = issue?.projectItems.nodes.find((n) => n.project.id === projectId);
    if (!item) { log(`${name}: not on the roadmap; left alone`); continue; }
    const now = item.fieldValueByName?.name ?? null;
    if (!MOVES_FROM.includes(now)) { log(`${name}: ${now ?? 'no status'}; left alone`); continue; }
    if (!dryRun) await graphql(token, SET, { p: projectId, i: item.id, f: status.id, o: target.id });
    log(`${name}: ${now} -> ${MOVES_TO}${dryRun ? ' (dry run)' : ''}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ROADMAP_TOKEN: token, ROADMAP_PROJECT_ID: projectId, GITHUB_EVENT_PATH: eventPath, ROADMAP_DRY_RUN } = process.env;
  if (!projectId || !eventPath) {
    console.error('pr-status: ROADMAP_PROJECT_ID and GITHUB_EVENT_PATH are required');
    process.exit(64);
  }
  // Until the roadmap's automation account has a token here, the workflow is wired but idle: no secret means
  // nothing moves, and the pull request's checks stay green.
  if (!token) {
    console.log('pr-status: no ROADMAP_TOKEN in this repository yet; nothing moved');
    process.exit(0);
  }
  run({ event: JSON.parse(readFileSync(eventPath, 'utf8')), token, projectId, dryRun: ROADMAP_DRY_RUN === '1' }).catch((e) => {
    console.error(`pr-status: ${e.message}`);
    process.exit(1);
  });
}
