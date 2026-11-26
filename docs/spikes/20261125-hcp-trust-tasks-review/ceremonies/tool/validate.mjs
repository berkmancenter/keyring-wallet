#!/usr/bin/env node
// Publication-time checks for ceremony definitions.
//
// JSON Schema settles the SHAPE of a definition (ceremonies/ceremony.meta.schema.json).
// This settles the things a schema cannot: that references resolve, that the step
// graph is acyclic and reachable, and that declared aggregates do not understate
// what the steps actually do.
//
// Every check here is publication-time by design — see docs/design-notes/trust-ceremonies.md
// §6.5 and §7.9. Nothing in this file needs to run at verification time.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Root is overridable so the checks can be exercised against fixture trees —
// a validator that has never been shown to fail is not evidence of anything.
const ROOT = process.env.CEREMONY_ROOT
  ? process.env.CEREMONY_ROOT.replace(/\/$/, '')
  : fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const CEREMONIES = join(ROOT, 'ceremonies');
// Specs always resolve against the real repo: a fixture tree exercises ceremony
// checks, not a parallel copy of the registry.
const SPECS = `${process.env.HCP_REVIEW_ROOT ?? '.'}/tt/specs`;

const EXPOSURE_RANK = { none: 0, metadata: 1, secret: 2 };
const SIDE_EFFECT_RANK = { none: 0, mutating: 1, destructive: 2 };

let errors = 0;
let warnings = 0;
const err = (f, m) => { console.error(`  ERROR ${f}: ${m}`); errors++; };
const warn = (f, m) => { console.warn(`  warn  ${f}: ${m}`); warnings++; };

function findDefinitions(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findDefinitions(p));
    else if (entry === 'ceremony.json') out.push(p);
  }
  return out;
}

// A Type URI resolves if specs/<slug>/<version>/spec.md exists.
function specExistsFor(typeUri) {
  const m = /^https:\/\/trusttasks\.org\/spec\/(.+?)\/(\d+\.\d+)(#.*)?$/.exec(typeUri);
  if (!m) return null; // non-registry authority: out of scope, not an error
  const [, slug, version] = m;
  return existsSync(join(SPECS, slug, version, 'spec.md')) ? { slug, version } : false;
}

function frontMatter(slug, version) {
  const p = join(SPECS, slug, version, 'spec.md');
  if (!existsSync(p)) return null;
  const src = readFileSync(p, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(src);
  if (!fm) return null;
  const get = (re) => { const x = re.exec(fm[1]); return x ? x[1].trim() : null; };
  return {
    discloses: get(/^\s*discloses:\s*(\S+)/m),
    actsAsSubject: get(/^\s*actsAsSubject:\s*(\S+)/m) === 'true',
    sideEffects: get(/^sideEffects:\s*\n\s*level:\s*(\S+)/m),
  };
}

// Collect every step name a completion predicate mentions.
function predicateSteps(pred, acc = []) {
  if (typeof pred === 'string') acc.push(pred);
  else if (pred && typeof pred === 'object') {
    for (const k of ['allOf', 'anyOf']) if (Array.isArray(pred[k])) pred[k].forEach((p) => predicateSteps(p, acc));
    if (pred.threshold) {
      if (Array.isArray(pred.threshold.of)) pred.threshold.of.forEach((p) => predicateSteps(p, acc));
      if (pred.threshold.ofStep) acc.push(pred.threshold.ofStep);
    }
  }
  return acc;
}

function checkDefinition(file, def, validate) {
  const f = relative(ROOT, file);

  if (!validate(def)) {
    for (const e of validate.errors) err(f, `schema: ${e.instancePath || '/'} ${e.message}`);
    return;
  }

  // SPEC §5.1.1 (adopted in 0.4.0): a definition published from then on MUST
  // declare the three-part form, so a two-part value naming 0.5 or later cannot
  // be a pre-rule declaration. Mirrors `twoPartAfterRule` in build-registry.mjs.
  const tfv = /^(\d+)\.(\d+)$/.exec(String(def.targetFrameworkVersion));
  if (tfv && (Number(tfv[1]) > 0 || Number(tfv[2]) >= 5)) {
    err(f, `targetFrameworkVersion "${def.targetFrameworkVersion}" is two-part, but that release postdates the three-part rule of SPEC §5.1.1 — declare "${def.targetFrameworkVersion}.0"`);
  }

  const steps = Object.entries(def.steps);
  const stepNames = new Set(Object.keys(def.steps));
  const roleNames = new Set(Object.keys(def.roles));

  let maxExposure = 0;
  let maxSideEffect = 0;
  let anyActsAsSubject = false;

  for (const [name, s] of steps) {
    // Roles referenced by the step must exist, and must not be evidentiary —
    // an evidentiary role exchanges no document, so it can be neither end of a step.
    for (const key of ['issuer', 'recipient']) {
      if (!roleNames.has(s[key])) err(f, `step "${name}".${key} names unknown role "${s[key]}"`);
      else if (def.roles[s[key]].evidentiary) err(f, `step "${name}".${key} is evidentiary role "${s[key]}", which exchanges no Trust Task document`);
    }

    if (s.multiplicity === 'perRole' && def.roles[s.issuer]?.cardinality !== 'many')
      err(f, `step "${name}" is multiplicity perRole but issuer role "${s.issuer}" has cardinality one`);

    for (const p of s.prev ?? []) {
      if (!stepNames.has(p)) err(f, `step "${name}".prev names unknown step "${p}"`);
      if (p === name) err(f, `step "${name}" lists itself in prev`);
    }

    if (s.kind === 'task') {
      const found = specExistsFor(s.type);
      if (found === false) err(f, `step "${name}" names Type URI with no spec in this registry: ${s.type}`);
      else if (found) {
        const fm = frontMatter(found.slug, found.version);
        if (fm) {
          maxExposure = Math.max(maxExposure, EXPOSURE_RANK[fm.discloses] ?? 0);
          maxSideEffect = Math.max(maxSideEffect, SIDE_EFFECT_RANK[fm.sideEffects] ?? 0);
          if (fm.actsAsSubject) anyActsAsSubject = true;
        }
      }
    }
    // kind === 'ceremony': the child's declared aggregate contributes. Resolving a
    // nested definition by digest is not implemented here — see §6.5.
    if (s.kind === 'ceremony') warn(f, `step "${name}" nests ${s.ceremony}; nested resolution is not implemented, so its exposure floor is not counted`);
  }

  // At least one terminal step, or every enactment is a prefix (§7.4).
  if (!steps.some(([, s]) => s.terminal)) err(f, 'no step is marked terminal; no enactment could ever be shown complete');

  // Acyclic prev graph.
  const state = new Map();
  const visit = (n, trail) => {
    if (state.get(n) === 'done') return;
    if (state.get(n) === 'open') { err(f, `prev graph has a cycle: ${[...trail, n].join(' -> ')}`); return; }
    state.set(n, 'open');
    for (const p of def.steps[n]?.prev ?? []) visit(p, [...trail, n]);
    state.set(n, 'done');
  };
  for (const n of stepNames) visit(n, []);

  // How the enactment is anchored decides what the prev graph must look like.
  //
  // `openingStep` (the default) needs exactly one required step with an empty
  // prev — the deadline is measured from it, so two would leave the origin
  // undefined. `coDerived` needs none: a simultaneous exchange has no first
  // step, and the anchor is the jointly-derived enactment identifier every step
  // signs. Applying the openingStep rule to a co-derived flow is what made a
  // two-person in-person ceremony inexpressible.
  const anchorKind = def.anchor?.kind ?? 'openingStep';
  const openers = steps.filter(([, s]) => (s.prev ?? []).length === 0 && !s.optional);
  if (anchorKind === 'openingStep') {
    if (openers.length === 0)
      err(f, 'no required step has an empty prev; nothing can open the enactment (declare anchor.kind "coDerived" if the exchange is simultaneous)');
    else if (openers.length > 1 && def.maxDuration)
      err(f, `maxDuration is declared but ${openers.length} required steps have empty prev (${openers.map(([n]) => n).join(', ')}); the deadline origin is ambiguous under an openingStep anchor`);
  } else {
    // coDerived: the roles named as producing the anchor must exist, and must
    // not be the same role twice — an anchor one party derives alone is an
    // opening step by another name.
    const bound = def.anchor?.boundBy ?? [];
    for (const r of bound)
      if (!roleNames.has(r)) err(f, `anchor.boundBy names unknown role "${r}"`);
    if (new Set(bound).size < 2)
      err(f, 'a coDerived anchor must be bound by at least two distinct roles');
    // No "at least one step must be anchor-rooted" check: a graph where every
    // step follows another is either a cycle or names a step that does not
    // exist, and both are already caught above. A co-derived anchor does not
    // forbid ordering BETWEEN steps — it removes the requirement that one step
    // start the flow, which is a different thing. A fixture asserting otherwise
    // was testing a legitimate configuration.

  }

  // Completion must reference real steps.
  for (const n of new Set(predicateSteps(def.completion)))
    if (!stepNames.has(n)) err(f, `completion references unknown step "${n}"`);

  // Recorders must be real roles, and are required at level receipt.
  //
  // `countersigned` needs none. Every participant signs the transcript, so there
  // is nobody to appoint — and for a bilateral ceremony that is the CHEAPEST
  // level rather than the heaviest, because both parties are present and signing
  // anyway. Two people offline have no third party to record for them, and
  // should not have to invent one.
  if (def.evidence.level === 'receipt') {
    if (!def.evidence.recorders?.length) err(f, 'evidence.level is receipt but no recorders are named');
    for (const r of def.evidence.recorders ?? [])
      if (!roleNames.has(r)) err(f, `evidence.recorders names unknown role "${r}"`);
  }
  if (def.evidence.level === 'countersigned' && def.evidence.recorders?.length)
    err(f, 'evidence.level is countersigned; every participant signs, so naming recorders is meaningless');

  // A bilateral ceremony is self-describing: two roles, each step running
  // between them, so the participant set is evident from the documents without
  // consulting the definition. Worth surfacing, because it is the shape that
  // verifies offline.
  //
  // Two ROLES is not two PARTIES: a role with cardinality `many` binds to a set,
  // so a two-role definition can still involve twenty people and its participant
  // set is not evident from the documents. A group-attestation definition
  // tripped exactly this, which is why both roles must be `one`.
  const bilateral =
    roleNames.size === 2 &&
    [...roleNames].every((r) => (def.roles[r].cardinality ?? 'one') === 'one') &&
    steps.every(([, s]) => s.issuer !== s.recipient) &&
    steps.every(([, s]) => (s.multiplicity ?? 'single') === 'single');
  if (bilateral && def.evidence.level === 'countersigned')
    console.log(`  note  ${f}: bilateral + countersigned — verifiable from the step documents alone, no definition needed at verification time`);

  // Aggregate floors (§11). max() is a lower bound for exposure and the value for
  // side effects; understatement is the failure mode worth catching.
  const declaredExposure = EXPOSURE_RANK[def.exposure.discloses] ?? 0;
  if (declaredExposure < maxExposure)
    err(f, `exposure.discloses "${def.exposure.discloses}" understates max() over steps ("${Object.keys(EXPOSURE_RANK)[maxExposure]}")`);
  if (anyActsAsSubject && !def.exposure.actsAsSubject)
    err(f, 'exposure.actsAsSubject is false but a step acts as the subject');
  if (def.sideEffects) {
    const declared = SIDE_EFFECT_RANK[def.sideEffects.level] ?? 0;
    if (declared < maxSideEffect)
      err(f, `sideEffects.level "${def.sideEffects.level}" understates max() over steps ("${Object.keys(SIDE_EFFECT_RANK)[maxSideEffect]}")`);
  }

  console.log(`  ok    ${f} (${steps.length} steps, ${roleNames.size} roles, evidence: ${def.evidence.level})`);
}

const metaPath = join(CEREMONIES, 'ceremony.meta.schema.json');
if (!existsSync(metaPath)) { console.error('no ceremonies/ceremony.meta.schema.json'); process.exit(1); }

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(metaPath, 'utf8')));

// --- JSON Pointer helpers, for the fixture mutations only ---
const ptrParts = (p) => p.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
function ptrSet(obj, ptr, val) {
  const parts = ptrParts(ptr); const last = parts.pop();
  let cur = obj; for (const p of parts) cur = cur[p];
  cur[last] = val;
}
function ptrDelete(obj, ptr) {
  const parts = ptrParts(ptr); const last = parts.pop();
  let cur = obj; for (const p of parts) { if (cur == null) return; cur = cur[p]; }
  if (cur) delete cur[last];
}

if (process.argv.includes('--test')) {
  // Fixture mode: every case MUST be rejected, and the unmutated base MUST pass.
  const fx = JSON.parse(readFileSync(join(CEREMONIES, 'ceremony.invalid-examples.json'), 'utf8'));
  const loadBase = (rel) => {
    const p = join(ROOT, rel);
    return { path: p, doc: JSON.parse(readFileSync(p, 'utf8')) };
  };
  const defaultBase = loadBase(fx.base);
  const basePath = defaultBase.path;
  const base = defaultBase.doc;

  const runsClean = (def) => {
    const before = errors; const quiet = console.error; const quietWarn = console.warn; const quietLog = console.log;
    console.error = () => {}; console.warn = () => {}; console.log = () => {};
    try { checkDefinition(basePath, def, validate); } finally {
      console.error = quiet; console.warn = quietWarn; console.log = quietLog;
    }
    const clean = errors === before; errors = before; return clean;
  };

  let pass = 0, fail = 0;
  if (runsClean(JSON.parse(JSON.stringify(base)))) console.log('  ok    (control) unmutated base passes');
  else { console.error('  ERROR (control) unmutated base does NOT pass — fixtures are meaningless'); fail++; }

  for (const c of fx.cases) {
    const from = c.base ? loadBase(c.base) : defaultBase;
    if (!runsClean(JSON.parse(JSON.stringify(from.doc)))) {
      console.error(`  ERROR base does not pass, so "${c.name}" proves nothing: ${c.base ?? fx.base}`);
      fail++;
      continue;
    }
    const def = JSON.parse(JSON.stringify(from.doc));
    for (const [ptr, val] of Object.entries(c.set ?? {})) ptrSet(def, ptr, val);
    for (const ptr of c.delete ?? []) ptrDelete(def, ptr);
    if (runsClean(def)) { console.error(`  ERROR not rejected: ${c.name}`); fail++; }
    else { console.log(`  ok    rejected: ${c.name}`); pass++; }
  }
  console.log(fail ? `\nFAILED: ${fail} fixture(s) not rejected` : `\n${pass}/${fx.cases.length} invalid definitions correctly rejected`);
  process.exit(fail ? 1 : 0);
}

const files = findDefinitions(CEREMONIES);
console.log(`Ceremony definitions: ${files.length}`);
for (const file of files) {
  let def;
  try { def = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { err(relative(ROOT, file), `not parseable: ${e.message}`); continue; }
  checkDefinition(file, def, validate);
}

console.log(errors ? `\nFAILED: ${errors} error(s), ${warnings} warning(s)` : `\nValidated ${files.length} ceremony definition(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
