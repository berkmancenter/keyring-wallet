#!/usr/bin/env node
// Vector test TT -> HCP. Every hcp/* document in the demo transcript
// (examples/hcp-demo-ts/transcript.golden.txt, read-only in ../tt) and every hcp/* example
// document in specs/hcp/**/spec.md is validated
//   1. against its own TT schema (control), then
//   2. with the carriage-only members stripped (accessToken; ext on import), respondedAt
//      renamed timestamp, a wrapped result unwrapped, against HCP's schema for that side.
// Sides HCP publishes no schema for are reported n/a.
// Writes out/vectors-tt-to-hcp.json and .txt.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, BASE, extractFenced } from './lib.mjs';
import { check } from './validators.mjs';

const TT_RO = `${BASE}/tt`; // pr1382 checkout, read-only
const PREFIX = 'https://trusttasks.org/spec/hcp/';

function transcriptDocs() {
  const lines = fs.readFileSync(`${TT_RO}/examples/hcp-demo-ts/transcript.golden.txt`, 'utf8').split('\n');
  const out = [];
  let step = '?';
  for (let i = 0; i < lines.length; i++) {
    const s = /^=== (.*) ===$/.exec(lines[i]);
    if (s) step = s[1];
    const h = /^--> (.*?) \((\w+)\) (\S+)$/.exec(lines[i]);
    if (!h || lines[i + 1] !== '{') continue;
    let j = i + 1;
    const buf = [];
    for (; j < lines.length; j++) {
      buf.push(lines[j]);
      if (lines[j] === '}') break;
    }
    out.push({ src: `transcript.golden.txt:${i + 2}`, step, dir: h[1], doc: JSON.parse(buf.join('\n')) });
    i = j;
  }
  return out;
}
function specDocs() {
  const out = [];
  const root = `${TT_RO}/specs/hcp`;
  for (const f of fs.readdirSync(root, { recursive: true })) {
    if (!f.endsWith('spec.md')) continue;
    for (const b of extractFenced(path.join(root, f))) {
      if (b.lang !== 'json') continue;
      const text = b.text.replace(/^[ \t]*>[ \t]?/gm, '');
      let doc;
      try {
        doc = JSON.parse(text);
      } catch {
        continue;
      }
      if (doc && typeof doc.type === 'string' && doc.type.startsWith(PREFIX) && 'payload' in doc) out.push({ src: `specs/hcp/${f}:${b.line}`, step: b.heading, doc });
    }
  }
  return out;
}

const strip = (o, ...k) => Object.fromEntries(Object.entries(o).filter(([x]) => !k.includes(x)));
const ts = (o) => {
  const { respondedAt, ...r } = o;
  return respondedAt === undefined ? r : { ...r, timestamp: respondedAt };
};
// slug:side -> [ [hcpSchema, (payload) -> instance | instance[] ] ] ; null = no HCP schema
const MAP = {
  'entries/query:request': ['operations/query-request.json', (p) => strip(p, 'accessToken')],
  'entries/query:response': ['operations/query-result.json', ts],
  'entries/get:request': ['operations/get-entry-request.json', (p) => strip(p, 'accessToken')],
  'entries/get:response': ['operations/get-entry-result.json', ts],
  'entries/create:request': ['operations/create-request.json', (p) => strip(p, 'accessToken')],
  'entries/create:response': ['operations/create-result.json', (p) => p.entry],
  'entries/revise:request': ['operations/revise-request.json', (p) => strip(p, 'accessToken')],
  'entries/revise:response': ['operations/revise-result.json', (p) => p.entry],
  'entries/withdraw:request': ['operations/withdraw-request.json', (p) => strip(p, 'accessToken')],
  'entries/withdraw:response': ['operations/withdraw-result.json', ts],
  'entries/hard-delete:response': ['operations/withdraw-result.json', ts],
  'entries/confirm:response': ['entry.json', (p) => p.entry],
  'entries/set-categories:response': ['entry.json', (p) => p.entry],
  'entries/restrict-purposes:response': ['entry.json', (p) => p.entry],
  'import:request': ['operations/import-request.json', (p) => strip(p, 'accessToken')],
  'import:response': ['operations/import-result.json', (p) => strip(p, 'ext')],
  'export:request': ['export.json#/properties/options', (p) => strip(p, 'accessToken')],
  'export:response': ['export.json', (p) => p.export],
  'shares/report:request': ['operations/report-sharing-request.json', (p) => strip(p, 'accessToken')],
  'rules/set:response': ['standing-rule.json', (p) => p.rule],
  'rules/list:response': ['standing-rule.json', (p) => p.rules],
  'directives/set:response': ['directive.json', (p) => p.directive],
  'directives/list:response': ['directive.json', (p) => p.directives],
  'delegations/list:response': ['operations/delegations-result.json', (p) => p],
  'disclosures/summary:response': ['operations/disclosure-summary-result.json', (p) => p],
  'grants/read-own:response': ['operations/read-own-grant-result.json', (p) => p.grant],
  'grants/list:response': ['grant.json', (p) => p.grants],
  'audit/read:response': ['audit-event.json', (p) => p.events],
  'grants/request:request': ['common.json#/$defs/accessDetail', (p) => p.access],
  'grants/request:response': ['grant.json', (p) => p.grant],
};

const docs = [...transcriptDocs().map((d) => ({ ...d, from: 'transcript' })), ...specDocs().map((d) => ({ ...d, from: 'spec.md' }))];
const results = [];
for (const d of docs) {
  const m = /^https:\/\/trusttasks\.org\/spec\/hcp\/(.+)\/(\d+\.\d+)(#request|#response)?$/.exec(d.doc.type);
  if (!m) continue;
  const slug = m[1];
  const side = m[3] === '#response' ? 'response' : 'request';
  const ttSchema = `${slug}/0.1/payload.schema.json${side === 'response' ? '#/$defs/Response' : ''}`;
  const t = check('tt', ttSchema, d.doc.payload);
  const map = MAP[`${slug}:${side}`];
  const r = { from: d.from, src: d.src, step: d.step, slug, side, ttPass: t.ok, ttErrors: t.errors, hcpSchema: map?.[0] ?? null, hcp: [], payload: d.doc.payload };
  if (map) {
    let inst = map[1](structuredClone(d.doc.payload));
    const list = Array.isArray(inst) && !['entries/query:response'].includes(`${slug}:${side}`) && map[0] !== 'operations/query-result.json' ? inst : [inst];
    for (const [i, x] of list.entries()) {
      const h = check('hcp', map[0], x);
      r.hcp.push({ i, ok: h.ok, errors: h.errors });
    }
  }
  results.push(r);
}
fs.writeFileSync(`${OUT}/vectors-tt-to-hcp.json`, JSON.stringify(results, null, 1));
const count = (f) => results.filter(f).length;
let txt = `TT -> HCP vectors: ${results.length} hcp/* documents (${count((r) => r.from === 'transcript')} from the demo transcript, ${count((r) => r.from === 'spec.md')} from spec.md examples)\n`;
txt += `TT control: ${count((r) => r.ttPass)} pass, ${count((r) => !r.ttPass)} fail\n`;
txt += `HCP: ${count((r) => r.hcp.length && r.hcp.every((h) => h.ok))} pass, ${count((r) => r.hcp.some((h) => !h.ok))} fail, ${count((r) => !r.hcp.length)} n/a (no HCP schema for that side, or an empty list)\n\n`;
for (const r of results) {
  const hs = !r.hcpSchema ? 'HCP n/a' : !r.hcp.length ? 'HCP n/a (empty list)' : r.hcp.every((h) => h.ok) ? `HCP PASS (${r.hcp.length})` : 'HCP FAIL';
  txt += `${r.ttPass ? 'TT PASS' : 'TT FAIL'} | ${hs.padEnd(20)} | hcp/${r.slug} ${r.side} [${r.src}] ${r.from === 'transcript' ? `(${r.step})` : ''}\n`;
  if (!r.ttPass) txt += `      TT errors:  ${r.ttErrors}\n`;
  for (const h of r.hcp.filter((h) => !h.ok)) txt += `      HCP errors${r.hcp.length > 1 ? ` [${h.i}]` : ''}: ${h.errors}\n`;
}
fs.writeFileSync(`${OUT}/vectors-tt-to-hcp.txt`, txt);
console.log(txt);
