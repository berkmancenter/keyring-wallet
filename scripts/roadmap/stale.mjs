#!/usr/bin/env node
// The roadmap's weekly check (docs/plans/public-roadmap-plan.md §8, "Staleness check"). It reads every card on the
// board and reports, never closes or changes anything:
//   - In progress or Testing with no activity for 14 days;
//   - Requested with no maintainer comment within the acknowledgement target;
//   - Under review with no activity for 30 days;
//   - a card whose public layer is missing, or whose "Where it stands" line disagrees with its Status.
// It runs from a maintainer's machine, not as a workflow here: this repository's Actions logs are public, and the
// internal acknowledgement target (§8.1) is never published. That target comes from the environment for the same
// reason; without it the reply check is skipped. The other thresholds are provisional (§8).
//
//   ROADMAP_TOKEN=... ROADMAP_PROJECT_ID=PVT_... ROADMAP_ACK_WORKING_DAYS=N node scripts/roadmap/stale.mjs [--now ISO]
//   Prints a Markdown report; exits 0 whatever it finds, and 1 only when it could not read the board.

import { fileURLToPath } from 'node:url';

export const IDLE_DAYS = { 'In progress': 14, Testing: 14, 'Under review': 30 };
const MAINTAINERS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const DAY = 86400000;

// Whole working days from one date to another: each step of 24 hours that lands on Monday to Friday counts.
export function workingDaysBetween(from, to) {
  let n = 0;
  for (let d = new Date(from.getTime() + DAY); d <= to; d = new Date(d.getTime() + DAY)) if (d.getUTCDay() % 6 !== 0) n++;
  return n;
}

// What a card's "Where it stands" line says, as the Status values it is consistent with; null if it says nothing
// this check knows.
export function standsFor(body) {
  const m = /^\*\*Where it stands:\*\*\s*([^\n]*)/m.exec(body ?? '');
  if (!m) return null;
  const s = m[1].toLowerCase();
  if (s.startsWith('shipped')) return ['Shipped'];
  if (s.startsWith('testing')) return ['Testing'];
  if (s.startsWith('in progress')) return ['In progress', 'Testing'];
  if (s.startsWith('planned') || s.startsWith('proposed')) return ['Requested', 'Under review', 'Planned'];
  return null;
}

// The findings for one card: [{ kind, text }]. `now` is a Date; `ackDays` is the acknowledgement target.
export function checkCard(card, { now, ackDays }) {
  const out = [];
  const idle = Math.floor((now - new Date(card.updatedAt)) / DAY);
  if (IDLE_DAYS[card.status] && idle >= IDLE_DAYS[card.status]) out.push({ kind: 'idle', text: `${card.status}, no activity for ${idle} days` });
  if (card.status === 'Requested' && ackDays != null) {
    const replied = card.comments.some((c) => MAINTAINERS.includes(c.authorAssociation));
    const waited = workingDaysBetween(new Date(card.createdAt), now);
    if (!replied && waited > ackDays) out.push({ kind: 'unacknowledged', text: `Requested, no maintainer reply after ${waited} working days` });
  }
  if (card.state === 'OPEN' || card.status === 'Shipped') {
    if (!/^\*\*What this is:\*\*/m.test(card.body ?? '') || !/^\*\*Where it stands:\*\*/m.test(card.body ?? '')) {
      if (!card.community) out.push({ kind: 'layer', text: 'no "What this is" / "Where it stands" layer' });
    } else {
      const ok = standsFor(card.body);
      if (ok && card.status && !ok.includes(card.status)) out.push({ kind: 'layer', text: `"Where it stands" disagrees with Status ${card.status}` });
    }
  }
  return out;
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

const ITEMS = `query($p:ID!,$after:String){node(id:$p){... on ProjectV2{items(first:50,after:$after){pageInfo{hasNextPage endCursor}
  nodes{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
    content{... on Issue{number title state body createdAt updatedAt url repository{nameWithOwner}
      labels(first:20){nodes{name}} comments(last:50){nodes{authorAssociation}}}}}}}}}`;

export async function readBoard(token, projectId) {
  const cards = [];
  for (let after = null; ; ) {
    const page = (await graphql(token, ITEMS, { p: projectId, after })).node.items;
    for (const n of page.nodes) {
      const c = n.content;
      if (!c?.number) continue; // a draft item or a pull request
      cards.push({
        ref: `${c.repository.nameWithOwner}#${c.number}`, title: c.title, url: c.url, state: c.state, body: c.body,
        createdAt: c.createdAt, updatedAt: c.updatedAt, status: n.fieldValueByName?.name ?? null,
        // A community report is filed through a form, not written to the card standard, until triage rewrites it.
        community: c.labels.nodes.some((l) => l.name === 'community') && n.fieldValueByName?.name === 'Requested',
        comments: c.comments.nodes,
      });
    }
    if (!page.pageInfo.hasNextPage) return cards;
    after = page.pageInfo.endCursor;
  }
}

export function report(cards, opts) {
  const found = cards.map((c) => ({ c, f: checkCard(c, opts) })).filter((x) => x.f.length);
  const lines = [`# Roadmap weekly check, ${opts.now.toISOString().slice(0, 10)}`, '', `${cards.length} cards read, ${found.length} need a look.`, ''];
  for (const kind of ['unacknowledged', 'idle', 'layer']) {
    const rows = found.flatMap(({ c, f }) => f.filter((x) => x.kind === kind).map((x) => `- [${c.ref}](${c.url}) ${c.title}: ${x.text}`));
    if (rows.length) lines.push(`## ${{ unacknowledged: 'Waiting for a first reply', idle: 'No recent activity', layer: 'Card text to fix' }[kind]}`, '', ...rows, '');
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ROADMAP_TOKEN: token, ROADMAP_PROJECT_ID: projectId, ROADMAP_ACK_WORKING_DAYS: ack } = process.env;
  const ni = process.argv.indexOf('--now');
  const now = ni > 0 ? new Date(process.argv[ni + 1]) : new Date();
  if (!token || !projectId) {
    console.error('stale: ROADMAP_TOKEN and ROADMAP_PROJECT_ID are required');
    process.exit(64);
  }
  readBoard(token, projectId)
    .then((cards) => console.log(report(cards, { now, ackDays: ack === undefined ? null : Number(ack) })))
    .catch((e) => {
      console.error(`stale: ${e.message}`);
      process.exit(1);
    });
}
