#!/usr/bin/env node
// Classify the differences compare.mjs found that are NOT in the PR's drift list.
//   a  intentional and documented (a framework bound the TT description names, a carriage member,
//      a rule the TT description or #1381's uncheckedRules states)
//   b  intentional but undocumented (a framework-style bound with no word about it)
//   c  meaning-changing: TT accepts what HCP rejects, or rejects what HCP accepts, for a value
//      that is not just "over a size cap" (required, enum, union/type, closedness, format, a
//      lower bound that rejects a value HCP's schema accepts, a schema rule TT does not check)
//   ok redundant: the TT keyword rejects nothing HCP's schema accepts (proved by a vector)
// Every lower bound, closedness, union and format case is decided by running both validators.
// Writes out/classified.json and out/classified.md.
import fs from 'node:fs';
import { makeSide, OUT, TT_HCP, HCP_SCHEMAS } from './lib.mjs';
import { check } from './validators.mjs';

const tt = makeSide(TT_HCP);
const hcp = makeSide(HCP_SCHEMAS);
const all = JSON.parse(fs.readFileSync(`${OUT}/compare-findings.json`, 'utf8'));
const unchecked = JSON.parse(fs.readFileSync(`${OUT}/unchecked-rules-1381.json`, 'utf8'));
const fresh = all.findings.filter((f) => !f.inTheirs);

const parseLoc = (k) => {
  const [file, pointer = ''] = k.split('#');
  return { file, pointer };
};
const nodeAt = (side, k) => side.locate(k).node;

/** Descriptions on a TT node, its $ref chain, and its parent property (for items/allOf). */
function ttDescriptions(k) {
  const out = [];
  let loc = tt.locate(k);
  for (let i = 0; i < 12 && loc; i++) {
    const n = loc.node;
    if (n && typeof n === 'object') {
      if (n.description) out.push(n.description);
      if (typeof n.$ref === 'string') loc = tt.ref(loc, n.$ref);
      else loc = null;
    } else loc = null;
  }
  const { file, pointer } = parseLoc(k);
  const up = pointer.replace(/\/(items|allOf\/\d+|anyOf\/\d+)$/, '');
  if (up !== pointer) {
    try {
      const p = tt.locate(`${file}#${up}`).node;
      if (p?.description) out.push(p.description);
    } catch {}
  }
  return out;
}

const boundWords = /framework bound|framework bounds|a bound of|the bound of|bounds? (?:of|is|are) .*framework|not an HCP requirement|HCP sets no/i;

// Which object ids have a TT spec slug, for matching #1381.
const slugOf = (obj) => obj.split(':')[0];

const rows = [];
for (const f of fresh) {
  const r = { ...f, cls: null, why: '', vector: null };
  const tK = f.ttLoc;
  const hK = f.hcpLoc;
  if (f.kind === 'bound') {
    const m = /^(\w+): TT (\S+), HCP (.*)$/.exec(f.detail);
    const kw = m[1];
    r.keyword = kw;
    r.ttValue = Number(m[2]);
    if (kw.startsWith('max')) {
      const descs = ttDescriptions(tK);
      const doc = descs.find((d) => boundWords.test(d));
      // over-the-cap vector, to show the TT side rejects and HCP accepts
      let probe;
      if (kw === 'maxLength') probe = 'x'.repeat(r.ttValue + 1);
      else if (kw === 'maxItems') probe = null; // items must be valid; not built per member
      if (probe !== undefined && probe !== null) {
        const a = check('tt', tK, probe);
        const b = check('hcp', hK, probe);
        r.vector = { value: `"x" x ${r.ttValue + 1}`, tt: a.ok, hcp: b.ok, ttErr: a.errors, hcpErr: b.errors };
      }
      // implied: a unique array of an n-value enum can hold at most n items anyway
      const tn = nodeAt(tt, tK);
      let itemEnum = null;
      if (kw === 'maxItems' && tn?.uniqueItems && tn.items) {
        let it = tt.child(tt.locate(tK), 'items');
        for (let i = 0; i < 6 && it.node?.$ref; i++) it = tt.ref(it, it.node.$ref);
        itemEnum = Array.isArray(it.node?.enum) ? it.node.enum.length : null;
      }
      const hcpDerived = descs.find((d) => new RegExp(`(at most|up to|no more than)\\s+${r.ttValue}\\b[^.]*\\(HCP [0-9]`, 'i').test(d));
      if (itemEnum !== null && itemEnum <= r.ttValue) {
        r.cls = 'ok';
        r.why = `implied: unique items drawn from a ${itemEnum}-value enum cannot exceed ${itemEnum}`;
      } else if (hcpDerived) {
        r.cls = 'a';
        r.why = `HCP-derived bound, TT description: "${hcpDerived.match(new RegExp(`[^.]*${r.ttValue}[^.]*`))?.[0]?.trim().slice(0, 160)}"`;
      } else {
        r.cls = doc ? 'a' : 'b';
        r.why = doc ? `TT description: "${doc.match(/[^.]*(framework bound|bound|HCP sets no)[^.]*\.?/i)?.[0]?.trim().slice(0, 160)}"` : 'no description on the member, its $ref chain or its parent says why this bound exists';
      }
    } else {
      // a lower bound: does HCP's own schema already refuse the empty value?
      const probe = kw === 'minLength' ? '' : kw === 'minItems' ? [] : kw === 'minProperties' ? {} : undefined;
      const a = check('tt', tK, probe);
      const b = check('hcp', hK, probe);
      r.vector = { value: JSON.stringify(probe), tt: a.ok, hcp: b.ok, ttErr: a.errors, hcpErr: b.errors };
      if (!a.ok && !b.ok) {
        r.cls = 'ok';
        r.why = `HCP's schema already refuses ${JSON.stringify(probe)} (${b.errors.split(';')[0]}), so the TT ${kw} narrows nothing`;
      } else if (!a.ok && b.ok) {
        const descs = ttDescriptions(tK);
        const doc = descs.find((d) => /never empty|non-empty|not empty|at least one|at least 1|Question 42|question 42/i.test(d) || (/min(Length|Items)/.test(d) && boundWords.test(d)));
        r.cls = 'c';
        r.documented = Boolean(doc);
        r.why = `TT refuses ${JSON.stringify(probe)}, HCP's schema accepts it${doc ? ` (documented: "${doc.slice(0, 140)}")` : ''}`;
      } else {
        r.cls = 'ok';
        r.why = `neither side refuses ${JSON.stringify(probe)} at this node (the bound is reached elsewhere)`;
      }
    }
  } else if (f.kind === 'additionalProperties') {
    const probe = { zzCustomMember: 1 };
    const a = check('tt', tK, probe);
    const b = check('hcp', hK, probe);
    const ttClosed = a.raw.some((e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'zzCustomMember' && e.instancePath === '');
    const hcpClosed = b.raw.some((e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'zzCustomMember' && e.instancePath === '');
    r.vector = { value: '{ zzCustomMember: 1 }', ttRefusesUnknown: ttClosed, hcpRefusesUnknown: hcpClosed };
    r.cls = ttClosed !== hcpClosed ? 'c' : 'ok';
    r.why = ttClosed && !hcpClosed ? 'TT refuses an unknown member that HCP\'s schema accepts (SPEC 7.3 item 4 asks payload schemas to say how unknown members are treated; the TT payload roots close)' : 'same';
  } else if (f.kind === 'rule') {
    // rule HCP has, TT lacks: find #1381 coverage by slug and topic
    const topic = [
      [/general-context/, /General Context profile/],
      [/vc-evidence/, /VC Evidence profile/],
      [/model-inferred/, /confidence/],
      [/verifiable-credential/, /verifiable-credential/],
      [/"role":\{"const":"content"\}/, /role` `content/],
      [/contradicts/, /contradicts/],
      [/ContextEntry/, /ContextEntry/],
      [/temporary|persistent/, /temporary/],
      [/"method":\{"const":"evidence"\}/, /method` is `evidence/],
      [/"method":\{"const":"delegated"\}/, /`parent` is present/],
      [/rejected/, /rejected/],
      [/entryId \| ref/, /Exactly one of `ref` and `entryId`/],
      [/"subject"|"classification"/, /subject|classification/],
    ].find(([re]) => re.test(f.detail));
    const slug = slugOf(f.object);
    const shared = slug === 'hcp/_shared';
    const hits = topic ? unchecked.filter((u) => (shared || u.slug === slug) && topic[1].test(u.rule)) : [];
    const descs = ttDescriptions(tK);
    const doc = descs.find((d) => /not checked by the schema|does not check|not as a schema conditional|is not checked|cannot express|not checked/i.test(d));
    r.cls = 'c';
    r.documented = Boolean(doc) || hits.length > 0;
    r.unchecked1381 = hits.map((h) => `${h.slug} ${h.member}`);
    r.why = `TT accepts what this HCP schema rule refuses.${doc ? ` TT description: "${doc.match(/[^.]*(not checked|does not check|schema conditional|cannot)[^.]*\.?/i)?.[0]?.trim().slice(0, 150)}"` : ''} #1381: ${hits.length ? `${hits.length} uncheckedRules entr${hits.length === 1 ? 'y' : 'ies'} on this topic${shared ? ' (across the family)' : ''}` : 'no entry'}`;
  } else {
    r.cls = 'c';
    r.why = '(decided by hand in the notes)';
  }
  rows.push(r);
}

// ---- decisions by hand, each with its evidence (vectors in out/vectors-edge.txt)
for (const r of rows) {
  if (r.object === 'hcp/entries/hard-delete:response') {
    r.cls = 'c';
    r.documented = true;
    r.why = 'Q11: hard-delete/0.1/spec.md:113 "result `status` | none | Absent ... pending HCP confirmation" and :162 "takes the withdraw result\'s shape, with `hardDeleted` `true` and no `status`". My pairing; the PR lists this side notCompared. Vector: the TT example fails HCP withdraw-result only on `status`.';
  } else if (r.object.startsWith('hcp/grants/request')) {
    r.cls = 'a';
    r.documented = true;
    r.why = 'grants/request carries no HCP operation (spec.md:65); HCP has no request schema, so this pairing with accessDetail/requestingParty is mine. purposes optional: spec.md:126, matching HCP 6.1.5.2 ("Where a grant request names no purpose, the Authorization Service MUST ask"); notTo: TT OnwardSharingRequest description "`notTo` is set by the provider, never asked for", matching HCP 6.3 (specification.md:1705); closed objects are TT\'s own request shapes.';
  } else if (r.kind === 'union') {
    r.cls = 'c';
    r.documented = false;
    r.why = 'TT merges HCP\'s anyOf [enum or slug | format:uri + pattern] into one pattern and drops format:uri, so it accepts a non-URI such as "x:<y>" or "a:%zz" that HCP refuses; every other probe agrees (out/vectors-edge.txt, group union). No TT description says why.';
  } else if (r.kind === 'format') {
    r.cls = 'c';
    r.documented = false;
    r.why = 'TT purpose is pattern-only; HCP adds format:uri. TT accepts "x:<y>" and "a:%zz", HCP refuses (out/vectors-edge.txt, group format). The shared PurposeCode keeps format:uri, so this is a slip local to the audit event.';
  } else if (r.kind === 'rule' && r.object === 'hcp/entries/revise:request' && /subject/.test(r.detail)) {
    r.cls = 'ok';
    r.why = 'The TT revise request does not declare `subject` or `classification` and is closed, so it refuses both, as HCP\'s `not` does (vector: both reject).';
  } else if (r.kind === 'additionalProperties') {
    const entryWrite = /entries\/(create|revise):request/.test(r.object) && r.path === '(root)';
    r.documented = !entryWrite;
    r.why = entryWrite
      ? 'TT closes the request root, so a create/revise cannot carry an entry member HCP does not define, which HCP 4.2 says a provider MUST preserve (specification.md:783, A.3 :3938). Not mentioned in the spec. Vector: HCP create-request accepts, TT refuses.'
      : 'Framework norm: SPEC.md:1217 (7.3 item 4) asks a payload schema to say how unknown members are treated, and TT payload roots and its own request shapes close; the shared HCP objects inside stay open, like HCP\'s. A member a later HCP draft adds to this result or request is refused by a TT validator until the task gets a new version.';
  }
}
const summary = {};
for (const r of rows) {
  const k = `${r.kind}:${r.cls}${r.documented === true ? '(documented)' : r.documented === false ? '(undocumented)' : ''}`;
  summary[k] = (summary[k] ?? 0) + 1;
}
fs.writeFileSync(`${OUT}/classified.json`, JSON.stringify({ count: rows.length, summary, rows }, null, 1));

let md = `# Classification of the ${rows.length} differences not in the PR's drift list\n\n`;
md += '| class | count |\n|---|---|\n' + Object.entries(summary).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n';
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
for (const cls of ['c', 'b', 'a', 'ok']) {
  const list = rows.filter((r) => r.cls === cls);
  if (!list.length) continue;
  md += `\n## class ${cls} (${list.length})\n\n| object | path | kind | detail | TT schema | HCP schema | vector | why |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of list) {
    const v = r.vector ? esc(JSON.stringify(r.vector)).slice(0, 220) : '';
    md += `| ${esc(r.object)} | ${esc(r.path)} | ${r.kind} | ${esc(r.detail).slice(0, 160)} | ${esc(r.ttLoc)} | ${esc(r.hcpLoc)} | ${v} | ${esc(r.why).slice(0, 300)} |\n`;
  }
}
fs.writeFileSync(`${OUT}/classified.md`, md);
console.log(`${rows.length} classified`, summary);
