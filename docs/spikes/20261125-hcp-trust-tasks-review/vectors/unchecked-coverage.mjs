#!/usr/bin/env node
// Does #1381's uncheckedRules list cover every place a TT payload embeds a shared object that
// carries one of HCP's own schema rules (if/then, contains, not) the TT schema leaves out?
// Walks each payload's request root and $defs/Response, following $refs, and records the
// payload-schema pointer of each landing (the form #1381 writes `member` in).
// Writes out/unchecked-coverage.json.
import fs from 'node:fs';
import path from 'node:path';
import { makeSide, OUT, TT_HCP } from './lib.mjs';

const tt = makeSide(TT_HCP);
const unchecked = JSON.parse(fs.readFileSync(`${OUT}/unchecked-rules-1381.json`, 'utf8'));
const S = '_shared/0.1/';
// TT def -> the HCP schema rules that apply to it: [topic, member suffix, rule-text regex]
const TRIGGERS = {
  [`${S}context-entry.schema.json#/$defs/Content`]: [['general-context value', '', /General Context profile/], ['vc-evidence no value', '', /VC Evidence profile/]],
  [`${S}context-entry.schema.json#/$defs/Assertion`]: [['model-inferred confidence', '/properties/confidence', /confidence/]],
  [`${S}context-entry.schema.json#/$defs/EvidenceItem`]: [['vc credential', '/properties/credential', /verifiable-credential/]],
  [`${S}context-entry.schema.json#/$defs/Entry`]: [['type has ContextEntry', '/properties/type', /ContextEntry/], ['one content evidence', '/properties/evidence', /role` `content/]],
  [`${S}context-entry.schema.json#/$defs/Relationship`]: [['proposal only on contradicts', '/properties/proposal', /contradicts/]],
  [`${S}grant.schema.json#/$defs/Grant`]: [['expiresAt by grantType', '/properties/expiresAt', /temporary/]],
  [`${S}delegation.schema.json#/$defs/DelegationBasis`]: [['evidence when method evidence', '/properties/evidence', /method` is `evidence/], ['parent iff delegated', '/properties/parent', /`parent` is present/]],
  [`${S}standing-rule.schema.json#/$defs/StandingRule`]: [['operators or requires', '', /operators`, `requires`/]],
  ['import/0.1/payload.schema.json#/$defs/Outcome']: [['rejected has reason', '/properties/reason', /rejected/]],
  // HCP's create-request.json and revise-request.json carry the evidence `contains` rule on the request itself
  ['entries/create/0.1/payload.schema.json#/properties/evidence']: [['one content evidence (request)', '', /role` `content/]],
  ['entries/revise/0.1/payload.schema.json#/properties/evidence']: [['one content evidence (request)', '', /role` `content/]],
};

const sites = [];
function walk(slug, loc, ptr, seen) {
  const n = loc.node;
  if (!n || typeof n !== 'object') return;
  const k = `${loc.file}#${loc.pointer}`;
  if (seen.has(k)) return;
  seen = new Set(seen).add(k);
  if (TRIGGERS[k]) for (const [topic, suffix, re] of TRIGGERS[k]) sites.push({ slug, def: k, topic, member: ptr + suffix, re });
  if (typeof n.$ref === 'string') walk(slug, tt.ref(loc, n.$ref), ptr, seen);
  if (n.properties) for (const p of Object.keys(n.properties)) walk(slug, tt.child(loc, 'properties', p), `${ptr}/properties/${p}`, seen);
  if (n.items && typeof n.items === 'object') walk(slug, tt.child(loc, 'items'), `${ptr}/items`, seen);
  for (const kw of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(n[kw])) n[kw].forEach((_, i) => walk(slug, tt.child(loc, kw, i), `${ptr}/${kw}/${i}`, seen));
  if (n.additionalProperties && typeof n.additionalProperties === 'object') walk(slug, tt.child(loc, 'additionalProperties'), `${ptr}/additionalProperties`, seen);
}

for (const dir of fs.readdirSync(TT_HCP, { recursive: true })) {
  if (!dir.endsWith('payload.schema.json')) continue;
  const file = dir.split(path.sep).join('/');
  const slug = `hcp/${file.replace('/0.1/payload.schema.json', '')}`;
  const doc = tt.doc(file);
  walk(slug, tt.locate(`${file}#`), '', new Set());
  if (doc.$defs?.Response) walk(slug, tt.locate(`${file}#/$defs/Response`), '/$defs/Response', new Set());
}

const res = sites.map((s) => {
  const exact = unchecked.find((u) => u.slug === s.slug && u.member === s.member && s.re.test(u.rule));
  const near = exact ? null : unchecked.find((u) => u.slug === s.slug && s.re.test(u.rule) && (u.member.startsWith(s.member) || s.member.startsWith(u.member)));
  return { slug: s.slug, topic: s.topic, member: s.member, def: s.def, covered: exact ? 'exact' : near ? `near (${near.member})` : 'MISSING' };
});
fs.writeFileSync(`${OUT}/unchecked-coverage.json`, JSON.stringify(res, null, 1));
const miss = res.filter((r) => r.covered === 'MISSING');
console.log(`${res.length} sites where a TT payload embeds a shared object carrying an HCP schema rule; covered exactly ${res.filter((r) => r.covered === 'exact').length}, near ${res.filter((r) => r.covered.startsWith('near')).length}, missing ${miss.length}`);
for (const m of miss) console.log('  MISSING', m.slug.padEnd(30), m.topic.padEnd(32), m.member);
for (const m of res.filter((r) => r.covered.startsWith('near'))) console.log('  near   ', m.slug.padEnd(30), m.topic.padEnd(32), m.member, '->', m.covered);
// #1381 entries no site accounts for (rules from HCP prose, not HCP's schema)
const used = new Set(res.filter((r) => r.covered === 'exact').map((r) => `${r.slug}|${r.member}`));
const extra = unchecked.filter((u) => !used.has(`${u.slug}|${u.member}`));
console.log(`#1381 entries this walk does not pair with an HCP schema rule (HCP prose rules, carriage rules, ref/entryId one-of): ${extra.length}`);
for (const u of extra) console.log('  extra  ', u.slug.padEnd(30), u.member, '::', u.rule.slice(0, 110));
