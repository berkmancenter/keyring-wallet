#!/usr/bin/env node
// Markdown tables for the notes: every class-(c) difference with both schema paths, and the edge vectors.
import fs from 'node:fs';
import { OUT } from './lib.mjs';
const k = JSON.parse(fs.readFileSync(`${OUT}/classified.json`, 'utf8'));
const e = JSON.parse(fs.readFileSync(`${OUT}/vectors-edge.json`, 'utf8'));
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const S = (p) => p.replace(/^_shared\/0\.1\//, '_shared/');
let md = '';
const groups = [
  ['c1. Lower bounds TT adds that reject a value HCP\'s schema accepts (empty string or empty array)', (r) => r.kind === 'bound'],
  ['c2. HCP schema rules (if/then, contains, oneOf) TT does not check', (r) => r.kind === 'rule'],
  ['c3. Payload roots TT closes where HCP is open', (r) => r.kind === 'additionalProperties'],
  ['c4. Unions merged into one pattern, and a dropped format', (r) => r.kind === 'union' || r.kind === 'format'],
  ['c5. hcp/entries/hard-delete response vs HCP withdraw-result (my pairing; Q11)', (r) => r.object === 'hcp/entries/hard-delete:response' && !['rule', 'additionalProperties'].includes(r.kind)],
];
for (const [title, f] of groups) {
  const list = k.rows.filter((r) => r.cls === 'c' && f(r));
  md += `\n#### ${title} (${list.length})\n\n| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |\n|---|---|---|---|---|---|\n`;
  list.forEach((r, i) => {
    md += `| ${i + 1} | ${esc(r.object.replace(/^hcp\//, ''))} \`${esc(r.path)}\` | ${esc(r.detail).slice(0, 140)} | ${r.documented ? 'yes' : 'no'} | \`${esc(S(r.ttLoc))}\` | \`${esc(r.hcpLoc)}\` |\n`;
  });
}
fs.writeFileSync(`${OUT}/c-items.md`, md);
let et = '| vector | HCP schema | TT schema | HCP | TT | #1381 lists it | note |\n|---|---|---|---|---|---|---|\n';
const yn = (b) => (b === null ? 'n/a' : b ? '**rejects**' : 'accepts');
for (const r of e) {
  et += `| ${esc(r.name)} | \`${esc(r.hcpSchema ?? '-')}\` | \`${esc(S(r.ttSchema))}\` | ${yn(r.hcpRejects)} | ${yn(r.ttRejects)} | ${r.unchecked1381 ? (r.unchecked1381.length ? 'yes' : '**no**') : '-'} | ${esc(r.note)} |\n`;
}
fs.writeFileSync(`${OUT}/edge-table.md`, et);
console.log(`c-items.md: ${k.rows.filter((r) => r.cls === 'c').length} rows; edge-table.md: ${e.length} rows`);
