#!/usr/bin/env node
// Moves roadmap cards forward when a release carries them (docs/plans/public-roadmap-plan.md §8, "PRs and
// releases"). The release flows call it with the PRs a build contains; each PR's `Refs` cards move to Testing,
// and "Shipped in" gets the release number the first time. A card is never moved back, and a card already
// past the target is left alone. A card already at the target keeps its status but still gets a missing "Shipped
// in": it may have been moved by hand, or the text write may have failed on an earlier run. Running it twice
// changes nothing.
//
//   ROADMAP_TOKEN=$(gh auth token) ROADMAP_PROJECT_ID=PVT_... node scripts/roadmap/set-status.mjs \
//     --status Testing --shipped-in 276.2 (--names names.txt | --no-names) [--dry-run] keyring-wallet#791 keyring-bifold#723 ...
//
// Each ref is `repo#N` or `owner/repo#N` (owner defaults to berkmancenter). A pull request stands for the
// cards it names with `Refs`; an issue stands for itself. Every text it writes, and the title of every card it
// moves, goes through the scan first (scan.mjs): a card that isn't clean is skipped and the run exits 1.
// "Shipped" is not offered yet: it waits for a release in the public stores, and closes the issue.

import { fileURLToPath } from 'node:url';
import { parseRefs } from './pr-status.mjs';
import { readNames, scanItem } from './scan.mjs';

export const ORDER = ['Requested', 'Under review', 'Planned', 'In progress', 'Testing', 'Shipped'];
export const TARGETS = ['Testing'];

// What happens to a card in `now` when the release asks for `target`: 'move' or why it is left alone.
export function planMove(now, target) {
  const from = ORDER.indexOf(now);
  if (from < 0) return `${now ?? 'no status'}; left alone`;
  if (from >= ORDER.indexOf(target)) return `already ${now}; left alone`;
  return 'move';
}

export function parseRef(text) {
  const m = /^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/.exec(text);
  return m && { owner: m[1] ?? 'berkmancenter', repo: m[2], number: Number(m[3]) };
}

export async function graphql(token, query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`GraphQL: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body.data;
}

const REF = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issueOrPullRequest(number:$number){
  __typename ... on PullRequest{title body} ... on Issue{title projectItems(first:20){nodes{id project{id}
  status:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
  shippedIn:fieldValueByName(name:"Shipped in"){... on ProjectV2ItemFieldTextValue{text}}}}}}}}`;
const FIELDS = `query($p:ID!){node(id:$p){... on ProjectV2{status:field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}
  shippedIn:field(name:"Shipped in"){... on ProjectV2Field{id}}}}}`;
const SET_STATUS = `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}`;
const SET_TEXT = `mutation($p:ID!,$i:ID!,$f:ID!,$t:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{text:$t}}){projectV2Item{id}}}`;

export async function run({ refs, status, shippedIn, names, projectId, token, dryRun = false, gql = graphql, log = console.log }) {
  if (!TARGETS.includes(status)) throw new Error(`--status must be one of ${TARGETS.join(', ')}`);
  const fields = (await gql(token, FIELDS, { p: projectId })).node;
  const target = fields?.status?.options.find((o) => o.name === status);
  if (!target || (shippedIn && !fields.shippedIn)) {
    throw new Error(`the board has no "${status}" status${shippedIn ? ' or no "Shipped in" field' : ''}; check ROADMAP_PROJECT_ID`);
  }
  let skipped = 0;
  // Every card the refs stand for, once each, in the order given.
  const cards = new Map();
  for (const ref of refs) {
    const node = (await gql(token, REF, ref)).repository?.issueOrPullRequest;
    if (!node) { log(`${ref.owner}/${ref.repo}#${ref.number}: not found; left alone`); continue; }
    if (node.__typename === 'PullRequest') {
      const named = parseRefs(`${node.title}\n${node.body ?? ''}`, ref);
      if (!named.length) log(`${ref.owner}/${ref.repo}#${ref.number}: pull request with no Refs; nothing to move`);
      for (const r of named) cards.set(`${r.owner}/${r.repo}#${r.number}`, r);
    } else cards.set(`${ref.owner}/${ref.repo}#${ref.number}`, { ...ref, issue: node });
  }
  for (const [name, card] of cards) {
    const issue = card.issue ?? (await gql(token, REF, card)).repository?.issueOrPullRequest;
    const item = issue?.projectItems?.nodes.find((n) => n.project.id === projectId);
    if (!item) { log(`${name}: not on the roadmap; left alone`); continue; }
    const now = item.status?.name ?? null;
    const plan = planMove(now, status);
    const writeShippedIn = shippedIn && !item.shippedIn?.text;
    // Past the target is left alone: a Shipped card named again by a later release shipped earlier than this one.
    if (plan !== 'move' && !(now === status && writeShippedIn)) { log(`${name}: ${plan}`); continue; }
    const scan = scanItem({ title: issue.title, ...(writeShippedIn ? { body: shippedIn } : {}) }, { names });
    if (scan.verdict !== 'clean') {
      log(`${name}: the scan says ${scan.verdict} (${scan.findings.map((f) => `${f.rule} in ${f.field}`).join(', ')}); left alone`);
      skipped++;
      continue;
    }
    if (!dryRun) {
      if (plan === 'move') await gql(token, SET_STATUS, { p: projectId, i: item.id, f: fields.status.id, o: target.id });
      if (writeShippedIn) await gql(token, SET_TEXT, { p: projectId, i: item.id, f: fields.shippedIn.id, t: shippedIn });
    }
    log(`${name}: ${plan === 'move' ? `${now} -> ${status}` : `already ${now}`}${writeShippedIn ? `, Shipped in ${shippedIn}` : ''}${dryRun ? ' (dry run)' : ''}`);
  }
  return { skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const has = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && args.splice(i, 1).length > 0;
  };
  const status = take('--status');
  const shippedIn = take('--shipped-in');
  const namesFile = take('--names');
  const noNames = has('--no-names');
  const dryRun = has('--dry-run');
  const refs = args.map(parseRef);
  const { ROADMAP_TOKEN: token, ROADMAP_PROJECT_ID: projectId } = process.env;
  if (!status || !refs.length || refs.includes(null) || (namesFile === undefined) === !noNames || !token || !projectId) {
    console.error('usage: ROADMAP_TOKEN=... ROADMAP_PROJECT_ID=... node scripts/roadmap/set-status.mjs --status Testing [--shipped-in R] (--names names.txt | --no-names) [--dry-run] repo#N ...');
    process.exit(64);
  }
  let names = [];
  if (namesFile !== undefined) {
    names = readNames(namesFile);
    if (!names.length) {
      console.error('set-status: the names list is empty');
      process.exit(3);
    }
  }
  run({ refs, status, shippedIn, names, projectId, token, dryRun })
    .then(({ skipped }) => process.exit(skipped ? 1 : 0))
    .catch((e) => {
      console.error(`set-status: ${e.message}`);
      process.exit(1);
    });
}
