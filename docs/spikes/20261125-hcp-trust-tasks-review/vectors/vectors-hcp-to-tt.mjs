#!/usr/bin/env node
// Vector test HCP -> TT. Each concrete JSON example in HCP 2.0-draft-3's pages is validated
//   1. against HCP's own schema (the control; pairing as HCP's tools/check_schemas.py makes it), and
//   2. mapped mechanically to the Trust Task payload (path parameter into the payload, the
//      `accessToken` member added, `timestamp` renamed `respondedAt`, a bare result wrapped
//      in its member) and validated against the TT schema.
// Templates (placeholders) cannot be validated; for them every member name the template uses
// is looked up in the mapped TT schema (out/template-members.txt).
// Writes out/vectors-hcp-to-tt.json and .txt.
import fs from 'node:fs';
import { OUT, makeSide, TT_HCP } from './lib.mjs';
import { check } from './validators.mjs';

const EX = JSON.parse(fs.readFileSync(`${OUT}/hcp-examples.json`, 'utf8'));
const byId = new Map(EX.map((e) => [e.id, e]));
const ex = (id) => {
  const e = byId.get(id);
  if (!e) throw new Error(`no example ${id}`);
  return structuredClone(e.json);
};
const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.e30.sig'; // any non-empty string: opaque to the schema
const P = (slug) => `${slug}/0.1/payload.schema.json`;
const R = (slug) => `${P(slug)}#/$defs/Response`;
const renameTs = (o) => {
  const { timestamp, ...rest } = o;
  return { ...rest, respondedAt: timestamp };
};

// [id, label, hcpSchema|null, ttSchema, mapping(json) -> payload, expected-cause note]
const CASES = [
  ['specification:2107', '9.4.1 query request', 'operations/query-request.json', P('entries/query'), (j) => ({ ...j, accessToken: TOKEN })],
  ['specification:2126', '9.4.1 query result', 'operations/query-result.json', R('entries/query'), renameTs],
  ['specification:2156', '9.4.2 get-entry result', 'operations/get-entry-result.json', R('entries/get'), renameTs],
  ['specification:2156', '9.4.2 get-entry result, directives:[] added (Q42 presence)', 'operations/get-entry-result.json', R('entries/get'), (j) => ({ ...renameTs(j), directives: [] })],
  ['specification:2156#entry', '9.4.2 disclosed entry', 'disclosure.json', '_shared/0.1/disclosure.schema.json#/$defs/Disclosure', (j) => j.entry],
  ['specification:2190', '9.4.4 revise request (ref from the path)', 'operations/revise-request.json', P('entries/revise'), (j) => ({ ref: 'r_8Jq2vNw4TzL0', ...j, accessToken: TOKEN })],
  ['specification:2223', '9.4.5 withdraw result (hardDeleted false)', 'operations/withdraw-result.json', R('entries/withdraw'), renameTs],
  // HCP 9.4.5: DELETE answers with the same result, hardDeleted true. The example shows the withdraw; set hardDeleted.
  ['specification:2223', '9.4.5 result with hardDeleted true, as HCP writes it, -> hcp/entries/hard-delete response', 'operations/withdraw-result.json', R('entries/hard-delete'), (j) => renameTs({ ...j, hardDeleted: true }), { hcpMap: (j) => ({ ...j, hardDeleted: true }) }],
  ['specification:2223', '9.4.5 result with hardDeleted true, HCP `status` dropped (Q11 shape) -> hcp/entries/hard-delete response', 'operations/withdraw-result.json', R('entries/hard-delete'), (j) => {
    const { status, ...r } = renameTs({ ...j, hardDeleted: true });
    return r;
  }, { hcpMap: (j) => ({ ...j, hardDeleted: true }) }],
  ['specification:2265', '9.4.9 confirm request (entryId from the path)', null, P('entries/confirm'), (j) => ({ entryId: 'urn:uuid:7d1e4b2a-0c9f-4a61-8e3d-5b6a7c8d9e0f', ...j, accessToken: TOKEN })],
  ['specification:2280', '9.4.10 change categories request', null, P('entries/set-categories'), (j) => ({ entryId: 'urn:uuid:7d1e4b2a-0c9f-4a61-8e3d-5b6a7c8d9e0f', ...j, accessToken: TOKEN })],
  ['specification:2293', '9.4.10 restrict purposes request', null, P('entries/restrict-purposes'), (j) => ({ entryId: 'urn:uuid:7d1e4b2a-0c9f-4a61-8e3d-5b6a7c8d9e0f', ...j, accessToken: TOKEN })],
  ['specification:2308', '9.4.11 import request (export: {})', 'operations/import-request.json', P('import'), (j) => ({ ...j, accessToken: TOKEN })],
  ['specification:2323', '9.4.11 import result', 'operations/import-result.json', R('import'), (j) => j],
  ['specification:2371', '9.4.16 report onward sharing request', 'operations/report-sharing-request.json', P('shares/report'), (j) => ({ ...j, accessToken: TOKEN })],
  ['specification:2463', '9.9 revocation SET -> hcp/grants/revoked (jti as noticeId)', null, P('grants/revoked'), (j) => {
    const ev = j.events['https://hcp.example/spec/events/grant-revoked'];
    return { noticeId: j.jti, grantId: ev.grantId, revokedAt: ev.revokedAt };
  }],
  ['specification:2817', '11.4 General Context entry', 'entry.json', '_shared/0.1/context-entry.schema.json#/$defs/Entry', (j) => j],
  ['specification:2817', '11.4 entry as a Management Client get-entry response', 'operations/get-entry-result.json', R('entries/get'), (j) => ({ entry: j, retrievalId: 'urn:uuid:9a4b6c8d-2e1f-4b3a-8c7d-6e5f4a3b2c1d', minimization: { method: 'none' }, directives: null, respondedAt: '2026-10-27T13:02:12Z' }), { hcpMap: (j) => ({ entry: j, retrievalId: 'urn:uuid:9a4b6c8d-2e1f-4b3a-8c7d-6e5f4a3b2c1d', minimization: { method: 'none' }, timestamp: '2026-10-27T13:02:12Z' }) }],
  ['specification:2817', '11.4 entry turned into a create request (provider-assigned members dropped)', 'operations/create-request.json', P('entries/create'), (j) => ({ ...toCreate(j), accessToken: TOKEN }), { hcpMap: toCreate }],
  ['guides:78', 'G2.2 tutoring entry', 'entry.json', '_shared/0.1/context-entry.schema.json#/$defs/Entry', (j) => j],
  ['guides:78', 'G2.2 entry turned into a create request', 'operations/create-request.json', P('entries/create'), (j) => ({ ...toCreate(j), accessToken: TOKEN }), { hcpMap: toCreate }],
  ['specification:2969', '14.2 VC Evidence content', 'common.json#/$defs/content', '_shared/0.1/context-entry.schema.json#/$defs/Content', (j) => j.content, { hcpMap: (j) => j.content }],
];

/** HCP 9.4.3 / 5.2.3: a create body is the entry without the members the provider assigns. */
function toCreate(e) {
  const p = e.record.provenance;
  const out = {
    schema: e.schema,
    subject: { id: e.subject.id },
    content: e.content,
    classification: { categories: e.classification.categories, ...(e.classification.dimension !== undefined ? { dimension: e.classification.dimension } : {}) },
    assertion: e.assertion,
    record: { provenance: { assertedBy: { id: p.assertedBy.id }, ...(p.assertedAt ? { assertedAt: p.assertedAt } : {}), source: p.source } },
  };
  if (e.evidence?.length) out.evidence = e.evidence;
  return out;
}

const results = [];
for (const [idSpec, label, hcpSchema, ttSchema, map, opts = {}] of CASES) {
  const [id, sub] = idSpec.split('#');
  const raw = ex(id);
  const src = sub ? raw : raw;
  const hcpInst = opts.hcpMap ? opts.hcpMap(structuredClone(src)) : sub ? raw[sub] : src;
  const control = hcpSchema ? check('hcp', hcpSchema, hcpInst) : null;
  const payload = map(structuredClone(src));
  const t = check('tt', ttSchema, payload);
  results.push({ id: idSpec, label, hcpSchema, ttSchema, hcpPass: control ? control.ok : null, hcpErrors: control?.errors ?? '', ttPass: t.ok, ttErrors: t.errors, payload });
}

// ---- templates: member names vs the TT schema
const tt = makeSide(TT_HCP);
const TEMPLATES = [
  ['specification:657', '4.2 entry', '_shared/0.1/context-entry.schema.json#/$defs/Entry', null],
  ['specification:694', '4.2 record', '_shared/0.1/context-entry.schema.json#/$defs/Entry', null],
  ['specification:803', '4.2.2 evidence', '_shared/0.1/context-entry.schema.json#/$defs/Entry', null],
  ['specification:876', '4.2.5 basis', '_shared/0.1/context-entry.schema.json#/$defs/Assertion', null],
  ['specification:1066', '4.7.4 proposal', '_shared/0.1/context-entry.schema.json#/$defs/Relationship', null],
  ['specification:1321', '5.4.1 export', '_shared/0.1/export.schema.json#/$defs/Export', null],
  ['specification:1490', '6.1.5 grant', '_shared/0.1/grant.schema.json#/$defs/Grant', null],
  ['specification:1557', '6.1.5.1 narrowed detail', '_shared/0.1/grant.schema.json#/$defs/AccessDetail', null],
  ['specification:1681', '6.3 standing rule', '_shared/0.1/standing-rule.schema.json#/$defs/StandingRule', null],
  ['specification:1719', '6.4 directive', '_shared/0.1/directive.schema.json#/$defs/Directive', null],
  ['specification:1795', '7.4 disclosure', '_shared/0.1/disclosure.schema.json#/$defs/Disclosure', null],
  ['specification:1833', '7.4.1 provenance', '_shared/0.1/disclosure.schema.json#/$defs/Disclosure', null],
  ['specification:1853', '7.5 minimization', 'entries/query/0.1/payload.schema.json#/$defs/Response', null],
  ['specification:1914', '8.2 audit event', '_shared/0.1/audit-event.schema.json#/$defs/AuditEvent', null],
  ['specification:2998', '14.4 VC Evidence entry', '_shared/0.1/context-entry.schema.json#/$defs/Entry', null],
  ['specification:3297', '17.2 delegation', '_shared/0.1/delegation.schema.json#/$defs/Delegation', null],
  ['specification:3363', '17.4 authorizingPrincipal', '_shared/0.1/grant.schema.json#/$defs/Grant', null],
  ['specification:920', '4.3 conversion', '_shared/0.1/context-entry.schema.json#/$defs/Entry', (j) => ({ record: j })],
];
/** Fold a TT node into { props: Map, closed, items, alts }. */
function fold(loc, acc = { props: new Map(), closed: false, items: [], alts: [] }, d = 0) {
  const n = loc.node;
  if (!n || typeof n !== 'object' || d > 40) return acc;
  if (typeof n.$ref === 'string') fold(tt.ref(loc, n.$ref), acc, d + 1);
  if (n.properties) for (const k of Object.keys(n.properties)) if (!acc.props.has(k)) acc.props.set(k, tt.child(loc, 'properties', k));
  if (n.additionalProperties === false) acc.closed = true;
  if (n.items && typeof n.items === 'object') acc.items.push(tt.child(loc, 'items'));
  for (const kw of ['allOf']) if (Array.isArray(n[kw])) n[kw].forEach((_, i) => fold(tt.child(loc, kw, i), acc, d + 1));
  for (const kw of ['anyOf', 'oneOf']) if (Array.isArray(n[kw])) n[kw].forEach((_, i) => acc.alts.push(tt.child(loc, kw, i)));
  return acc;
}
function members(value, loc, path, out) {
  if (Array.isArray(value)) {
    const f = fold(loc);
    const itemLocs = f.items.length ? f.items : f.alts.flatMap((a) => fold(a).items);
    for (const v of value) if (v && typeof v === 'object') for (const il of itemLocs.slice(0, 1)) members(v, il, `${path}[]`, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const f = fold(loc);
  // an anyOf of objects: take the first branch that declares the most of these members
  let cand = [f];
  if (!f.props.size && f.alts.length) cand = f.alts.map((a) => fold(a));
  const best = cand.sort((a, b) => Object.keys(value).filter((k) => b.props.has(k)).length - Object.keys(value).filter((k) => a.props.has(k)).length)[0];
  for (const [k, v] of Object.entries(value)) {
    if (best.props.has(k)) members(v, best.props.get(k), `${path}.${k}`, out);
    else out.push({ path: `${path}.${k}`, closed: best.closed });
  }
}
let tmplTxt = '';
const tmplResults = [];
for (const [id, label, ttSpec, wrap] of TEMPLATES) {
  const e = byId.get(id);
  if (!e) continue;
  const j = wrap ? wrap(e.json) : e.json;
  const out = [];
  members(j, tt.locate(ttSpec), '', out);
  tmplResults.push({ id, label, ttSpec, unknown: out });
  tmplTxt += `${label} (${id}) vs ${ttSpec}: ${out.length ? out.map((o) => `${o.path}${o.closed ? ' [CLOSED: TT would refuse]' : ' [open: accepted, not interpreted]'}`).join('; ') : 'every member declared'}\n`;
}
fs.writeFileSync(`${OUT}/template-members.txt`, tmplTxt);

fs.writeFileSync(`${OUT}/vectors-hcp-to-tt.json`, JSON.stringify({ results, templates: tmplResults }, null, 1));
let txt = `HCP -> TT vectors: ${results.length} concrete cases from ${new Set(results.map((r) => r.id.split('#')[0])).size} HCP examples\n\n`;
for (const r of results) {
  txt += `${r.ttPass ? 'TT PASS' : 'TT FAIL'} | HCP ${r.hcpPass === null ? 'n/a (prose only)' : r.hcpPass ? 'PASS' : 'FAIL'} | ${r.label} [${r.id}]\n`;
  if (r.hcpPass === false) txt += `      HCP errors: ${r.hcpErrors}\n`;
  if (!r.ttPass) txt += `      TT errors:  ${r.ttErrors}\n`;
}
txt += `\nTemplates (member names looked up in the TT schema):\n${tmplTxt}`;
fs.writeFileSync(`${OUT}/vectors-hcp-to-tt.txt`, txt);
console.log(txt);
