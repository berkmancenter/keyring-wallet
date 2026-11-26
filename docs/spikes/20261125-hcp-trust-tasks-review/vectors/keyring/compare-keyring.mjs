#!/usr/bin/env node
// Gap 3: run every review vector through THREE validators and report each verdict that differs.
//   H  the review harness: ../validators.mjs (Ajv 8.17.1 + ajv-formats), the pr1380 schema FILES
//      registered by file URL (verdict re-run here and checked against the recorded one).
//   K  Keyring: packages/trust-tasks/src/validator.ts reproduced exactly (Ajv2020 from Keyring's own
//      node_modules, 8.20.0, `new Ajv2020({ strict: false })`, one shared instance,
//      `ajv.validate(schema, payload)`, no ajv-formats), fed the INLINED PAYLOAD_SCHEMA /
//      RESPONSE_PAYLOAD_SCHEMA constants of pr1380 trust-tasks-ts/src/hcp.
//   D  the PR demo: examples/hcp-demo-ts/src/validator.ts reproduced (Ajv2020 + ajv-formats from the demo's
//      own node_modules, `{ strict: false, allErrors: true }`, compile cached per schema object), fed the
//      same inlined constants.
// H vs D isolates the inlining (both have formats); D vs K isolates Keyring's missing formats.
// A target that is a _shared $def (not a module payload) is validated two ways under K and D:
//   "def"   a wrapper { $ref: '#/$defs/<Name>/<rest>', $defs: <a module's inlined $defs> }, the same subschema H used;
//   "embed" the value placed into a real module payload (what Keyring would actually receive).
// Writes out/keyring-compare.json and out/keyring-compare.txt under this folder.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { loadInlined } from './load-inlined.mjs';
import { check } from '../validators.mjs';
import { OUT as H_OUT } from '../lib.mjs';
import { V as EDGE } from './edge-vectors-lib.mjs';

const OUT = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// ---- K: Keyring's validator, byte-for-byte the logic of validator.ts:13-25
const KEYRING = process.env.KEYRING_ROOT ?? '../../../../..'; // this repository's root
const kreq = createRequire(`${KEYRING}/packages/trust-tasks/src/validator.ts`);
const kAjvPkg = kreq('ajv/package.json');
const { Ajv2020: KAjv } = kreq('ajv/dist/2020');
const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));
const kajv = new KAjv({ strict: false });
const keyring = {
  validate(schema, payload) {
    const valid = kajv.validate(schema, payload);
    if (valid) return true;
    return { ok: false, errors: (kajv.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`) };
  },
};

// ---- D: the demo's validator (examples/hcp-demo-ts/src/validator.ts:18-29)
const DEMO = `${process.env.HCP_REVIEW_ROOT ?? '.'}/tt/examples/hcp-demo-ts`;
const dreq = createRequire(`${DEMO}/src/validator.ts`);
const dAjvPkg = dreq('ajv/package.json');
const dFmtPkg = dreq('ajv-formats/package.json');
const { Ajv2020: DAjv } = dreq('ajv/dist/2020');
const addFormats = dreq('ajv-formats').default ?? dreq('ajv-formats');
const dajv = addFormats(new DAjv({ strict: false, allErrors: true }));
const dcompiled = new WeakMap();
const demo = (schema, payload) => {
  let v = dcompiled.get(schema);
  if (!v) dcompiled.set(schema, (v = dajv.compile(schema)));
  return v(payload) ? [] : (v.errors ?? []).map((e) => `payload${e.instancePath} ${e.message}`);
};

// ---- schemas
const MODS = loadInlined();
const sch = (slug, side) => {
  const m = MODS.get(slug);
  if (!m) throw new Error(`no module ${slug}`);
  return side === 'response' ? m.response : m.request;
};
const wrappers = new Map();
const defEquality = [];
/** _shared/0.1/<f>.schema.json#/$defs/<Name>[/rest] -> a wrapper over a module's inlined $defs */
function sharedWrapper(target) {
  if (wrappers.has(target)) return wrappers.get(target);
  const m = /#\/\$defs\/([^/]+)(\/.*)?$/.exec(target);
  const name = m[1];
  const holders = [];
  for (const [slug, mod] of MODS) for (const side of ['request', 'response']) if (mod[side].$defs?.[name]) holders.push({ slug, side, def: mod[side].$defs[name], defs: mod[side].$defs });
  if (!holders.length) throw new Error(`no module inlines $defs/${name}`);
  const distinct = holders.filter((h, i) => holders.findIndex((g) => isDeepStrictEqual(g.def, h.def)) === i).length;
  defEquality.push({ name, holders: holders.length, distinctCopies: distinct });
  const h = holders[0];
  const w = { $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: `#/$defs/${name}${m[2] ?? ''}`, $defs: h.defs };
  const r = { schema: w, via: `${h.slug} ${h.side} $defs/${name}${m[2] ?? ''}` };
  wrappers.set(target, r);
  return r;
}
/** a TT target string (as the harness names it) -> { schema, via } for K and D */
function resolveTarget(target) {
  if (target.startsWith('_shared/')) return sharedWrapper(target);
  const m = /^(.+)\/0\.1\/payload\.schema\.json(#\/\$defs\/Response)?$/.exec(target);
  if (!m) throw new Error(`unmapped target ${target}`);
  const side = m[2] ? 'response' : 'request';
  return { schema: sch(m[1], side), via: `${m[1]} ${side === 'response' ? 'RESPONSE_PAYLOAD_SCHEMA' : 'PAYLOAD_SCHEMA'}` };
}

// ---- bases for embedding _shared values into real module payloads
const TT = JSON.parse(fs.readFileSync(`${H_OUT}/vectors-tt-to-hcp.json`, 'utf8'));
const base = (slug, side) => structuredClone(TT.find((d) => d.slug === slug && d.side === side).payload);
const EMBED = [
  [/grant\.schema\.json#\/\$defs\/Grant$/, (x) => ['grants/read-own', 'response', { ...base('grants/read-own', 'response'), grant: x }]],
  [/audit-event\.schema\.json#\/\$defs\/AuditEvent$/, (x) => ['audit/read', 'response', { ...base('audit/read', 'response'), events: [x] }]],
  [/AuditEvent\/properties\/purpose$/, (s) => { const p = base('audit/read', 'response'); p.events[0].purpose = s; return ['audit/read', 'response', p]; }],
  [/context-entry\.schema\.json#\/\$defs\/Entry$/, (x) => ['entries/confirm', 'response', { ...base('entries/confirm', 'response'), entry: x }]],
  [/disclosure\.schema\.json#\/\$defs\/Disclosure$/, (x) => ['entries/query', 'response', { ...base('entries/query', 'response'), entries: [x] }]],
  [/common\.schema\.json#\/\$defs\/Category$/, (s) => ['entries/query', 'request', { ...base('entries/query', 'request'), categories: [s] }]],
  [/common\.schema\.json#\/\$defs\/PurposeCode$/, (s) => ['entries/query', 'request', { ...base('entries/query', 'request'), purpose: s }]],
  [/Directive\/properties\/action$/, (s) => ['directives/set', 'request', { ...base('directives/set', 'request'), action: s }]],
  [/Delegation\/properties\/relationship$/, (s) => { const p = base('delegations/list', 'response'); p.delegations[0].relationship = s; return ['delegations/list', 'response', p]; }],
  [/context-entry\.schema\.json#\/\$defs\/Content$/, (x) => { const p = base('entries/confirm', 'response'); p.entry.content = x; return ['entries/confirm', 'response', p]; }],
];

// ---- run one vector under K and D (and embedded, for _shared targets)
const kErr = (r) => (r === true ? '' : r.errors.slice(0, 3).join('; '));
function runKD(target, value) {
  const out = {};
  try {
    const t = resolveTarget(target);
    out.via = t.via;
    const k = keyring.validate(t.schema, structuredClone(value));
    out.K = k === true;
    out.Kerr = kErr(k);
    const d = demo(t.schema, structuredClone(value));
    out.D = d.length === 0;
    out.Derr = d.slice(0, 3).join('; ');
  } catch (e) {
    out.exception = String(e.message ?? e);
  }
  if (target.startsWith('_shared/')) {
    const em = EMBED.find(([re]) => re.test(target));
    if (em) {
      const [slug, side, payload] = em[1](structuredClone(value));
      const s = sch(slug, side);
      const k = keyring.validate(s, payload);
      const d = demo(s, payload);
      out.embed = { in: `${slug} ${side}`, K: k === true, Kerr: kErr(k), D: d.length === 0, Derr: d.slice(0, 3).join('; ') };
    } else out.embed = null;
  }
  return out;
}

const rows = [];
// 1. TT -> HCP: 72 documents, TT side (payload vs its own module schema)
for (const d of TT) {
  const target = `${d.slug}/0.1/payload.schema.json${d.side === 'response' ? '#/$defs/Response' : ''}`;
  const h = check('tt', target, d.payload);
  if (h.ok !== d.ttPass) throw new Error(`harness re-run differs from recorded for ${d.src}`);
  rows.push({ set: 'tt-to-hcp', name: `hcp/${d.slug} ${d.side} [${d.src}]`, target, H: h.ok, Herr: h.errors, ...runKD(target, d.payload) });
}
// 2. HCP -> TT: 22 mapped HCP examples
const H2T = JSON.parse(fs.readFileSync(`${H_OUT}/vectors-hcp-to-tt.json`, 'utf8')).results;
for (const r of H2T) {
  const h = check('tt', r.ttSchema, r.payload);
  if (h.ok !== r.ttPass) throw new Error(`harness re-run differs from recorded for ${r.label}`);
  rows.push({ set: 'hcp-to-tt', name: `${r.label} [${r.id}]`, target: r.ttSchema, H: h.ok, Herr: h.errors, ...runKD(r.ttSchema, r.payload) });
}
// 3. Edge (40) and string (26) vectors, TT side
const EDGE_REC = JSON.parse(fs.readFileSync(`${H_OUT}/vectors-edge.json`, 'utf8'));
for (const [i, v] of EDGE.entries()) {
  const h = check('tt', v.tt[0], v.tt[1]);
  if (!h.ok !== EDGE_REC[i].ttRejects || EDGE_REC[i].name !== v.name) throw new Error(`harness re-run differs from recorded for ${v.name}`);
  rows.push({ set: v.group === 'edge' || !v.group ? 'edge' : `string:${v.group}`, name: v.name, target: v.tt[0], H: h.ok, Herr: h.errors, hcpRejects: EDGE_REC[i].hcpRejects, ...runKD(v.tt[0], v.tt[1]) });
}

// ---- 4. extra probes (not in the harness): date-time and uri formats, JS undefined, $id reuse
const extra = [];
const probe = (name, slug, side, payload, note = '') => {
  const s = sch(slug, side);
  const k = keyring.validate(s, payload);
  const d = demo(s, payload);
  const wire = JSON.parse(JSON.stringify(payload));
  const kw = keyring.validate(s, wire);
  extra.push({ name, in: `${slug} ${side}`, K: k === true, Kerr: kErr(k), D: d.length === 0, Derr: d.slice(0, 3).join('; '), Kwire: kw === true, note });
};
const revoked = base('grants/revoked', 'request');
for (const s of [revoked.revokedAt, '2026-11-25T10:00:00Z', 'yesterday', '', '2026-13-45T99:99:99Z', '2026-11-25 10:00:00Z', '2026-11-25T10:00:00', '2026-11-25'])
  probe(`grants/revoked revokedAt ${JSON.stringify(s)}`, 'grants/revoked', 'request', { ...revoked, revokedAt: s }, 'Instant: format date-time, no pattern');
const qres = base('entries/query', 'response');
for (const s of ['not a time', '2026-02-30T00:00:00Z']) probe(`query result respondedAt ${JSON.stringify(s)}`, 'entries/query', 'response', { ...qres, respondedAt: s });
const qreq = base('entries/query', 'request');
for (const s of ['urn:x:y', 'https://p.example/a%20b', 'https://p.example/%', 'https://p.example/a b', 'mailto:a@b', 'x:\u00e9'])
  probe(`query purpose ${JSON.stringify(s)}`, 'entries/query', 'request', { ...qreq, purpose: s }, 'PurposeCode: format uri + pattern');
const rp = base('entries/restrict-purposes', 'request');
probe('restrict-purposes, permittedPurposes: undefined (in memory)', 'entries/restrict-purposes', 'request', { ...rp, permittedPurposes: undefined }, 'required-nullable');
probe('restrict-purposes, permittedPurposes: null', 'entries/restrict-purposes', 'request', { ...rp, permittedPurposes: null }, 'required-nullable');
const gres = base('entries/get', 'response');
probe('get result, directives: undefined (in memory)', 'entries/get', 'response', { ...gres, directives: undefined }, 'required-nullable');
const ro = base('grants/read-own', 'response');
probe('read-own grant, expiresAt: undefined (in memory)', 'grants/read-own', 'response', { ...ro, grant: { ...ro.grant, expiresAt: undefined } }, 'required-nullable');
probe('query request, optional categories: undefined (in memory)', 'entries/query', 'request', { ...qreq, categories: undefined }, 'optional member, closed root');
probe('query request, unknown key with value undefined (in memory)', 'entries/query', 'request', { ...qreq, extra: undefined }, 'closed root: for..in sees the key');

// $id: compile every module constant in the one shared instance, then a deep copy of one
const idResults = { compiled: 0, errors: [] };
for (const [slug, m] of MODS) for (const side of ['request', 'response']) {
  try { kajv.compile(m[side]); idResults.compiled++; } catch (e) { idResults.errors.push(`${slug} ${side}: ${e.message}`); }
}
let cloneOutcome;
try { keyring.validate(structuredClone(sch('entries/query', 'request')), qreq); cloneOutcome = 'validated'; } catch (e) { cloneOutcome = `THROWS: ${e.message}`; }
let cloneResp;
try { keyring.validate(structuredClone(sch('entries/query', 'response')), qres); cloneResp = 'validated'; } catch (e) { cloneResp = `THROWS: ${e.message}`; }
let demoClone;
try { demo(structuredClone(sch('entries/query', 'request')), qreq); demoClone = 'validated'; } catch (e) { demoClone = `THROWS: ${e.message}`; }
console.warn = origWarn;

// ---- report
const v = (b) => (b === undefined ? '-' : b ? 'accept' : 'REJECT');
const diff = (r) => r.exception || r.H !== r.K || r.H !== r.D || r.K !== r.D || (r.embed && r.embed.K !== r.embed.D);
let txt = `Gap 3: Keyring's validator vs the harness and the PR demo\n`;
txt += `K = Keyring (ajv ${kAjvPkg.version} from ${KEYRING}/node_modules, strict:false, no formats); D = demo (ajv ${dAjvPkg.version} + ajv-formats ${dFmtPkg.version}); H = harness (../validators.mjs, files)\n`;
txt += `modules loaded: ${MODS.size} (x2 constants). Ajv warnings while running: ${[...new Set(warnings)].join(' | ')}\n\n`;
const sets = [...new Set(rows.map((r) => r.set))];
for (const s of sets) {
  const rs = rows.filter((r) => r.set === s);
  txt += `${s}: ${rs.length} vectors; H accepts ${rs.filter((r) => r.H).length}, K accepts ${rs.filter((r) => r.K).length}, D accepts ${rs.filter((r) => r.D).length}; differing ${rs.filter(diff).length}; exceptions ${rs.filter((r) => r.exception).length}\n`;
}
txt += `\nEvery differing vector:\n`;
for (const r of rows.filter(diff)) {
  txt += `  [${r.set}] ${r.name}\n     H ${v(r.H)}  K ${v(r.K)}  D ${v(r.D)}${r.embed ? ` | embedded in ${r.embed.in}: K ${v(r.embed.K)} D ${v(r.embed.D)}` : ''}${r.exception ? ` | EXCEPTION ${r.exception}` : ''}\n`;
  if (!r.H) txt += `     H: ${r.Herr}\n`;
  if (r.D === false) txt += `     D: ${r.Derr}\n`;
  if (r.K === false) txt += `     K: ${r.Kerr}\n`;
  if (r.embed && !r.embed.D) txt += `     D(embed): ${r.embed.Derr}\n`;
}
const embedRows = rows.filter((r) => r.embed);
txt += `\n_shared targets validated embedded in a module payload: ${embedRows.length}; embed K != def K: ${embedRows.filter((r) => r.embed.K !== r.K).length}; embed D != def D: ${embedRows.filter((r) => r.embed.D !== r.D).length}\n`;
for (const r of embedRows.filter((r) => r.embed.K !== r.K || r.embed.D !== r.D)) txt += `  ${r.name}: def K ${v(r.K)} D ${v(r.D)}; embed (${r.embed.in}) K ${v(r.embed.K)} D ${v(r.embed.D)} | K: ${r.embed.Kerr} | D: ${r.embed.Derr}\n`;
txt += `\nInlined $defs copies used by the wrappers (distinctCopies > 1 means modules inline different shapes under one name):\n`;
for (const d of defEquality) txt += `  ${d.name}: in ${d.holders} module constants, ${d.distinctCopies} distinct\n`;
txt += `\nExtra probes (K in memory, K after a JSON round trip, D in memory):\n`;
for (const e of extra) txt += `  ${e.K === e.D ? '  ' : '!='} K ${v(e.K).padEnd(6)} Kwire ${v(e.Kwire).padEnd(6)} D ${v(e.D).padEnd(6)} | ${e.name}${e.note ? ` | ${e.note}` : ''}${e.K ? '' : ` | K: ${e.Kerr}`}${e.D ? '' : ` | D: ${e.Derr}`}\n`;
txt += `\n$id: ${idResults.compiled}/56 module constants compiled in one shared Keyring instance; errors: ${idResults.errors.length ? idResults.errors.join(' | ') : 'none'}\n`;
txt += `  a deep COPY of entries/query PAYLOAD_SCHEMA (same $id, new object) through Keyring's validate: ${cloneOutcome}\n`;
txt += `  a deep COPY of entries/query RESPONSE_PAYLOAD_SCHEMA (no $id): ${cloneResp}\n`;
txt += `  the same copy through the demo's validator: ${demoClone}\n`;
fs.writeFileSync(`${OUT}/keyring-compare.json`, JSON.stringify({ rows, extra, idResults, cloneOutcome, cloneResp, demoClone, defEquality, warnings: [...new Set(warnings)] }, null, 1));
fs.writeFileSync(`${OUT}/keyring-compare.txt`, txt);
console.log(txt);
