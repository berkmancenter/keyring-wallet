#!/usr/bin/env node
// Independent structural comparison: Trust Task hcp/* schemas vs HCP 2.0-draft-3 schemas.
// Usage: node compare.mjs   (writes out/compare-findings.json, out/compare-table.md)
import fs from 'node:fs';
import { makeSide, shapeOf, canonical, key, TT_HCP, HCP_SCHEMAS, OUT } from './lib.mjs';
import { objects } from './mapping.mjs';

const tt = makeSide(TT_HCP);
const hcp = makeSide(HCP_SCHEMAS);

const findings = [];
const seenPairs = new Map(); // pair key -> first object id
const hcpVisited = new Set();
const ttVisited = new Set();
const coveredObjects = [];

const fmt = (set) => [...set].sort().join(', ') || '(none)';
const join = (p, n) => (p ? `${p}.${n}` : n);
const normPattern = (p) => p.replace(/A-Za-z/g, 'a-zA-Z').replace(/0-9A-Fa-f/g, '0-9a-fA-F').replace(/\[\^\\s\]/g, '\\S');
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function describe(side, loc) {
  const s = shapeOf(side, loc);
  const bits = [];
  if (s.types) bits.push(`type ${fmt(s.types)}`);
  if (s.values) bits.push(`enum ${fmt(s.values)}`);
  if (s.format) bits.push(`format ${s.format}`);
  for (const p of s.patterns) bits.push(`pattern ${p}`);
  if (s.props.size) bits.push(`object{${[...s.props.keys()].join(',')}}`);
  return bits.join(' ') || 'any';
}

function compare(ctx, tLoc, hLoc, p) {
  const ct = canonical(tt, tLoc);
  const ch = canonical(hcp, hLoc);
  hcpVisited.add(key(ch));
  hcpVisited.add(key(hLoc));
  ttVisited.add(key(ct));
  const pk = `${key(ct)}|${key(ch)}`;
  if (seenPairs.has(pk)) {
    if (p === '') coveredObjects.push({ object: ctx.object, by: seenPairs.get(pk) });
    return;
  }
  seenPairs.set(pk, ctx.object);
  const a = shapeOf(tt, tLoc);
  const b = shapeOf(hcp, hLoc);
  const add = (kind, path, detail, dir = '') => findings.push({ object: ctx.object, path: path || '(root)', kind, detail, dir, ttLoc: key(tLoc), hcpLoc: key(hLoc) });

  // types and nullability
  if (a.types && b.types && a.types.size && b.types.size) {
    if (!eq(a.types, b.types)) add('type', p, `TT ${fmt(a.types)}, HCP ${fmt(b.types)}`);
  } else if ((a.types?.size || 0) !== (b.types?.size || 0)) {
    const [who, t] = a.types?.size ? ['TT', a.types] : ['HCP', b.types];
    if (!(a.alts || b.alts)) add('type-declared', p, `${who} declares type ${fmt(t)}; the other side declares none`, who === 'TT' ? 'tt-stricter' : 'tt-looser');
  }
  if (a.nullable !== b.nullable) add('nullable', p, a.nullable ? 'null allowed in TT only' : 'null allowed in HCP only', a.nullable ? 'tt-looser' : 'tt-stricter');
  // enums
  if (a.values && b.values) {
    if (!eq(a.values, b.values)) add('enum', p, `TT only: ${fmt(new Set([...a.values].filter((v) => !b.values.has(v))))}; HCP only: ${fmt(new Set([...b.values].filter((v) => !a.values.has(v))))}`);
  } else if (a.values || b.values) {
    if (!(a.alts || b.alts)) add('enum', p, a.values ? `closed in TT only (${fmt(a.values)})` : `closed in HCP only (${fmt(b.values)})`, a.values ? 'tt-stricter' : 'tt-looser');
  }
  // format, pattern
  if ((a.format || null) !== (b.format || null)) add('format', p, `TT ${a.format ?? '(none)'}, HCP ${b.format ?? '(none)'}`, a.format ? 'tt-stricter' : 'tt-looser');
  const pa = new Set(a.patterns.map(normPattern));
  const pb = new Set(b.patterns.map(normPattern));
  if (!eq(pa, pb) && !(a.alts || b.alts)) add('pattern', p, `TT ${fmt(pa)}; HCP ${fmt(pb)}`, pa.size > pb.size ? 'tt-stricter' : pb.size > pa.size ? 'tt-looser' : '');
  // bounds
  for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'minProperties', 'maxProperties']) {
    const av = a.bounds[k];
    const bv = b.bounds[k];
    if (av === bv) continue;
    const isMin = k.startsWith('min');
    let dir;
    if (av === undefined) dir = 'tt-looser';
    else if (bv === undefined) dir = 'tt-stricter';
    else dir = (isMin ? av > bv : av < bv) ? 'tt-stricter' : 'tt-looser';
    add('bound', p, `${k}: TT ${av ?? '(none)'}, HCP ${bv ?? '(none)'}`, dir);
  }
  if (a.uniqueItems !== b.uniqueItems) add('bound', p, `uniqueItems: TT ${a.uniqueItems}, HCP ${b.uniqueItems}`, a.uniqueItems ? 'tt-stricter' : 'tt-looser');
  // conditionals and cross-member rules
  const ra = new Set(a.rules);
  const rb = new Set(b.rules);
  for (const r of rb) if (!ra.has(r)) add('rule', p, `HCP schema rule not in the TT schema: ${r}`, 'tt-looser');
  for (const r of ra) if (!rb.has(r)) add('rule', p, `TT schema rule not in the HCP schema: ${r}`, 'tt-stricter');
  // unions
  if (a.alts && b.alts) {
    if (a.alts.length !== b.alts.length) add('union', p, `TT has ${a.alts.length} alternatives, HCP ${b.alts.length}`);
    else a.alts.forEach((al, i) => compare(ctx, al, b.alts[i], `${p}|${i}`));
  } else if (a.alts || b.alts) {
    const [who, side, alts, other, oside, oloc] = a.alts ? ['TT', tt, a.alts, 'HCP', hcp, hLoc] : ['HCP', hcp, b.alts, 'TT', tt, tLoc];
    add('union', p, `${who} is a choice of [${alts.map((l) => describe(side, l)).join(' | ')}]; ${other} is a single shape [${describe(oside, oloc)}]`);
  }
  // objects
  const aObj = a.props.size || a.required.size || a.condProps.size;
  const bObj = b.props.size || b.required.size || b.condProps.size;
  if (aObj || bObj) {
    if (aObj && bObj) {
      const tNames = new Set([...a.props.keys(), ...a.condProps.keys(), ...a.required]);
      const hNames = new Set([...b.props.keys(), ...b.condProps.keys(), ...b.required]);
      const matched = new Set();
      for (const n of [...tNames].sort()) {
        const hn = ctx.renames[join(p, n)] ?? n;
        const mp = join(p, n);
        if (!hNames.has(hn)) {
          add('only-tt', mp, `${a.required.has(n) ? 'required' : 'optional'} in TT; HCP does not declare it`, a.required.has(n) ? 'tt-stricter' : '');
          continue;
        }
        matched.add(hn);
        const ar = a.required.has(n);
        const br = b.required.has(hn);
        if (ar !== br) add('required', mp, `${ar ? 'required' : 'optional'} in TT, ${br ? 'required' : 'optional'} in HCP${hn === n ? '' : ` (HCP \`${hn}\`)`}`, ar ? 'tt-stricter' : 'tt-looser');
        const tl = a.props.get(n) ?? a.condProps.get(n);
        const hl = b.props.get(hn) ?? b.condProps.get(hn);
        if (tl && hl) compare(ctx, tl, hl, mp);
      }
      for (const hn of [...hNames].sort()) {
        if (!matched.has(hn)) add('only-hcp', join(p, hn), `${b.required.has(hn) ? 'required' : 'optional'} in HCP; TT does not declare it`, a.additional === false ? 'tt-stricter' : '');
      }
    } else {
      const [who, d] = aObj ? ['TT', a] : ['HCP', b];
      for (const n of [...new Set([...d.props.keys(), ...d.required])].sort()) {
        add(aObj ? 'only-tt' : 'only-hcp', join(p, n), `${d.required.has(n) ? 'required' : 'optional'} in ${who}; the other side declares this value without members`, aObj && d.required.has(n) ? 'tt-stricter' : '');
      }
    }
  }
  // additionalProperties
  const aAdd = a.additional;
  const bAdd = b.additional;
  const cls = (x) => (x === false ? 'closed' : x === true || x === undefined ? 'open' : 'schema');
  if (cls(aAdd) !== cls(bAdd)) {
    add('additionalProperties', p, `TT ${cls(aAdd)}, HCP ${cls(bAdd)}`, cls(aAdd) === 'closed' ? 'tt-stricter' : cls(bAdd) === 'closed' ? 'tt-looser' : '');
  } else if (cls(aAdd) === 'schema') compare(ctx, aAdd, bAdd, `${p}{}`);
  // arrays
  if (a.items && b.items) compare(ctx, a.items, b.items, `${p}[]`);
  else if (a.items || b.items) add('items', p, `${a.items ? 'TT' : 'HCP'} constrains the items; the other side does not`, a.items ? 'tt-stricter' : 'tt-looser');
}

for (const o of objects) {
  const ctx = { object: o.id, renames: o.renames ?? {} };
  compare(ctx, tt.locate(o.tt), hcp.locate(o.hcp), '');
}

// ---- coverage of HCP's schema set
const hcpFiles = [];
(function walk(d, rel = '') {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${d}/${e.name}`, `${rel}${e.name}/`);
    else if (e.name.endsWith('.json')) hcpFiles.push(`${rel}${e.name}`);
  }
})(HCP_SCHEMAS);
const hcpUnits = [];
for (const f of hcpFiles.sort()) {
  if (f === 'common.json') for (const d of Object.keys(hcp.doc(f).$defs)) hcpUnits.push(`common.json#/$defs/${d}`);
  else hcpUnits.push(`${f}#`);
}
const hcpUncovered = hcpUnits.filter((u) => !hcpVisited.has(u));

// ---- coverage of the TT family's defs
const ttUnits = [];
(function walk(d, rel = '') {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${d}/${e.name}`, `${rel}${e.name}/`);
    else if (e.name.endsWith('.schema.json')) {
      const f = `${rel}${e.name}`;
      const doc = tt.doc(f);
      if (e.name === 'payload.schema.json') ttUnits.push(`${f}#`);
      for (const k of Object.keys(doc.$defs ?? {})) ttUnits.push(`${f}#/$defs/${k}`);
    }
  }
})(TT_HCP);
const ttUncovered = ttUnits.filter((u) => !ttVisited.has(u));

// ---- line up with the PR's own 38
const theirs = [];
{
  const txt = fs.readFileSync(`${OUT}/their-drift-verbose.txt`, 'utf8').split('\n');
  let obj = null;
  for (const line of txt) {
    if (/^hcp\//.test(line)) obj = line.trim();
    const m = /^\s{4}(ours-only|hcp-only|required|type|nullable|enum|alternatives)\s+(\S+): (.*?)\s+\[allowlisted: (.*)\]$/.exec(line);
    if (m && obj) theirs.push({ object: obj, kind: m[1], path: m[2], detail: m[3], ref: m[4] });
  }
}
const kindToTheirs = (f) =>
  f.kind === 'only-tt' ? 'ours-only' : f.kind === 'only-hcp' ? 'hcp-only' : f.kind === 'rule' && /one of \(/.test(f.detail) ? 'alternatives' : f.kind;
const theirKey = (t) => `${t.object}|${t.path}|${t.kind}`;
const theirKeys = new Map(theirs.map((t) => [theirKey(t), t]));
const matchedTheirs = new Set();
for (const f of findings) {
  const k = `${f.object}|${f.path}|${kindToTheirs(f)}`;
  if (theirKeys.has(k)) {
    f.inTheirs = true;
    matchedTheirs.add(k);
  } else f.inTheirs = false;
}
const theirsUnmatched = theirs.filter((t) => !matchedTheirs.has(theirKey(t)));

fs.writeFileSync(
  `${OUT}/compare-findings.json`,
  JSON.stringify({ objects: objects.length, comparedPairs: seenPairs.size, coveredObjects, findings, theirs, theirsUnmatched, hcpUnits, hcpUncovered, ttUnits, ttUncovered }, null, 1),
);

// ---- table
const byObj = new Map();
for (const f of findings) {
  if (!byObj.has(f.object)) byObj.set(f.object, []);
  byObj.get(f.object).push(f);
}
const esc = (s) => String(s).replace(/\|/g, '\\|');
let md = '| TT object | HCP schema | only in HCP | only in TT | type / required / enum / nullable | bounds, format, pattern | rules, unions, closedness |\n|---|---|---|---|---|---|---|\n';
for (const o of objects) {
  const l = byObj.get(o.id) ?? [];
  const cov = coveredObjects.find((c) => c.object === o.id);
  const pick = (...kinds) => l.filter((f) => kinds.includes(f.kind)).map((f) => `${f.inTheirs ? '' : '**'}${f.path}${f.inTheirs ? '' : '**'}${['only-hcp', 'only-tt'].includes(f.kind) ? '' : ` (${f.kind}: ${f.detail})`}`).join('; ');
  md += `| ${o.id}${o.extra ? ' †' : ''} | ${o.hcp} | ${cov ? `_same pair as ${cov.by}_` : esc(pick('only-hcp'))} | ${esc(pick('only-tt'))} | ${esc(pick('type', 'type-declared', 'required', 'enum', 'nullable'))} | ${esc(pick('bound', 'format', 'pattern', 'items'))} | ${esc(pick('rule', 'union', 'additionalProperties'))} |\n`;
}
fs.writeFileSync(`${OUT}/compare-table.md`, md);

// ---- summary
const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
const newOnes = findings.filter((f) => !f.inTheirs);
const newByKind = {};
for (const f of newOnes) newByKind[f.kind] = (newByKind[f.kind] ?? 0) + 1;
console.log(`objects mapped: ${objects.length}; distinct node pairs compared: ${seenPairs.size}; objects that are the same pair as an earlier one: ${coveredObjects.length}`);
console.log(`findings: ${findings.length}`, byKind);
console.log(`matching the PR's 38: ${findings.filter((f) => f.inTheirs).length}; PR findings I did not reproduce: ${theirsUnmatched.length}`);
for (const t of theirsUnmatched) console.log('   not reproduced:', t.object, t.path, t.kind, '-', t.detail);
console.log(`not in the PR's list: ${newOnes.length}`, newByKind);
console.log(`HCP units (files + common $defs): ${hcpUnits.length}; never reached: ${hcpUncovered.length}`);
for (const u of hcpUncovered) console.log('   HCP not reached:', u);
console.log(`TT units (payload roots + $defs): ${ttUnits.length}; never reached: ${ttUncovered.length}`);
for (const u of ttUncovered) console.log('   TT not reached:', u);
