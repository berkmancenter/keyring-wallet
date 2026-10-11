#!/usr/bin/env node
// Which gate legs does a change touch? A fast check for a fix, never the release gate: the legs whose drivers use a
// testID that a changed file owns. The chain, each step from a file the repo already keeps:
//   changed file -> the testIDs it owns (e2e/lib/testids.json for bifold's packages/core, testids.app.json for app/)
//   -> the drivers and page objects that name those testIDs (check-testids' own reference reader)
//   -> the drivers that import such a page object -> the legs that run those drivers (`node <driver>` in legs/*.sh).
// A changed file that owns no testID (logic, a client, a store) cannot be mapped: it is listed as unmapped and the
// answer is "use the full gate" (exit 2). Exit 0 with a selection; 1 when nothing changed maps to any leg.
//
//   changed.mjs --files a,b,…            paths from the wallet root (bifold/packages/core/src/…, app/src/…)
//   changed.mjs --range <a>..<b>          the wallet range, plus the bifold submodule's own range when its pin moved
//   [--json]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReferences } from '../scripts/check-testids.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(here, '..');
const repo = path.resolve(e2eDir, '..');

const MANIFESTS = [
  { file: 'lib/testids.json', root: 'bifold/packages/core/' },
  { file: 'lib/testids.app.json', root: 'app/' },
];

/** owner index: repo path -> { keys:Set, stems:Set } */
export function ownersFrom(manifests) {
  const owners = new Map();
  const add = (p, kind, id) => {
    if (!owners.has(p)) owners.set(p, { keys: new Set(), stems: new Set() });
    owners.get(p)[kind].add(id);
  };
  for (const { json, root } of manifests) {
    for (const [id, files] of Object.entries(json.keys || {})) for (const f of files) add(root + f, 'keys', id);
    for (const [stem, files] of Object.entries(json.stems || {})) for (const f of files) add(root + f, 'stems', stem);
  }
  return owners;
}

/** The testIDs (keys and stems) the changed files own; files owning none are unmapped (only source files count). */
export function idsOwnedBy(changed, owners) {
  const keys = new Set(), stems = new Set(), mapped = [], unmapped = [];
  for (const f of changed) {
    // A screen's testIDs often live in its typed ids map beside it (VtiJoin.tsx -> VtiJoin.ids.ts, the screen contract).
    // Both: a screen can own a few ids itself and the rest through its ids map (VtiVetting.tsx owns two stems,
    // VtiVetting.ids.ts its 81 keys).
    const sibling = f.replace(/\.(tsx?|jsx?)$/, '.ids.ts');
    const os = [owners.get(f), sibling !== f ? owners.get(sibling) : undefined].filter(Boolean);
    if (os.length) { for (const o of os) { o.keys.forEach((k) => keys.add(k)); o.stems.forEach((s) => stems.add(s)); } mapped.push(f); }
    else if (/^(bifold\/packages\/core\/src|app\/src)\/.*\.(tsx?|jsx?)$/.test(f) && !/\.(test|spec)\.[tj]sx?$/.test(f) && !/\/__tests__\//.test(f)) unmapped.push(f);
  }
  return { keys, stems, mapped, unmapped };
}

/** Does a reference (from extractReferences) name one of these ids? A key by name; a stem by prefix, both ways. */
export function refHits(ref, { keys, stems }) {
  if (ref.kind === 'key') return keys.has(ref.value) || [...stems].some((s) => ref.value.startsWith(s));
  if (ref.kind === 'stem') return stems.has(ref.value) || [...keys].some((k) => k.startsWith(ref.value));
  return false;
}

/**
 * A module's units: its top-level declarations (function, const, let), and the methods of a top-level object
 * literal (a page object: `export const join = { ask(d) {…}, … }`) as "join.ask". Each unit is a line range; a
 * reference or a call inside the range belongs to it.
 */
const TOP = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const METHOD = /^  (?:async\s+)?([A-Za-z_$][\w$]*)\s*\(|^  ([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/;
/** The line where a declaration starting on line `from` ends: its brackets close, skipping strings and comments. */
export function endOf(lines, from) {
  let depth = 0, opened = false, q = null, block = false;
  for (let i = from - 1; i < lines.length; i++) {
    const l = lines[i];
    for (let j = 0; j < l.length; j++) {
      const c = l[j], n = l[j + 1];
      if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
      if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
      if (c === '/' && n === '/') break;
      if (c === '/' && n === '*') { block = true; j++; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '(' || c === '{' || c === '[') { depth++; opened = true; }
      else if (c === ')' || c === '}' || c === ']') depth--;
    }
    if (q === '"' || q === "'") q = null; // an unclosed plain quote ends with its line
    if (!q && !block && depth <= 0 && (opened || /;\s*$/.test(l) || i + 1 === lines.length || !/[,=({[+\-*/&|?:.]\s*$/.test(l))) return i + 1;
  }
  return lines.length;
}

export function unitsOf(src) {
  const lines = src.split('\n');
  const tops = [];
  lines.forEach((l, i) => { const m = l.match(TOP); if (m) tops.push({ name: m[1] || m[2], from: i + 1 }); });
  const units = [];
  tops.forEach((t, k) => {
    const next = k + 1 < tops.length ? tops[k + 1].from - 1 : lines.length;
    const to = Math.min(endOf(lines, t.from), next);
    units.push({ name: t.name, from: t.from, to });
    if (/=\s*\{\s*$/.test(lines[t.from - 1])) {
      const ms = [];
      for (let i = t.from; i < to; i++) { const m = lines[i].match(METHOD); if (m) ms.push({ name: `${t.name}.${m[1] || m[2]}`, from: i + 1 }); }
      ms.forEach((m, j) => units.push({ name: m.name, from: m.from, to: j + 1 < ms.length ? ms[j + 1].from - 1 : to, method: true }));
    }
  });
  return units;
}

/** `import { a, b as c } from "./x.js"` -> local name -> { file, name }; a default or namespace import -> name "*". */
export function importsOf(file, src) {
  const out = new Map();
  for (const m of src.matchAll(/^\s*import\s+([^'";]+?)\s+from\s*["'](\.{1,2}\/[^"']+)["']/gm)) {
    const target = path.resolve(path.dirname(file), m[2]);
    const spec = m[1].trim();
    const named = spec.match(/\{([^}]*)\}/);
    if (named) for (const part of named[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const [orig, local] = part.split(/\s+as\s+/);
      out.set((local ?? orig).trim(), { file: target, name: orig.trim() });
    }
    const rest = spec.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const ns = rest.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/) || rest.match(/^([A-Za-z_$][\w$]*)/);
    if (ns) out.set(ns[1], { file: target, name: '*' });
  }
  return out;
}

const word = (name) => new RegExp(`(?<![\\w$.])${name.replace(/[$.]/g, (c) => `\\${c}`)}(?![\\w$])`);

/**
 * The units a driver run reaches, from the whole driver file down: within a module, the units a reached unit names;
 * across modules, the imported names a reached unit uses (`join.ask(` reaches the method "join.ask"; a bare `join`
 * reaches every unit of `join`). Each reached unit carries the testIDs it names. Returns hits: [{ file, unit, ids }].
 */
export function reach(driver, owned, read, env = new Map()) {
  const cache = new Map();
  const mod = (file) => {
    if (cache.has(file)) return cache.get(file);
    let src = null, refs = [], units = [], imports = new Map();
    try { src = read(file); } catch { /* missing */ }
    if (src != null) {
      try { refs = extractReferences(src); } catch { refs = []; }
      units = unitsOf(src);
      imports = importsOf(file, src);
    }
    // Flags from the environment: `const F = process.env.NAME === "1"` (or a bare process.env.NAME): off unless set so.
    const flags = new Map();
    for (const f of (src || '').matchAll(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\.([A-Z][A-Z0-9_]*)\s*(?:===\s*["']([^"']*)["'])?\s*;?\s*$/gm)) {
      const v = env.get(f[2]);
      flags.set(f[1], f[3] !== undefined ? v === f[3] : Boolean(v));
    }
    const m = { src, lines: src ? src.split('\n') : [], refs, units, imports, flags };
    cache.set(file, m);
    return m;
  };
  const textOf = (m, u) => m.lines.slice(u.from - 1, u.to).join('\n');
  const hits = [];
  const seen = new Set();
  const stack = [{ file: driver, unit: '*' }];
  while (stack.length) {
    const { file, unit } = stack.pop();
    const key = `${file}#${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = mod(file);
    if (m.src == null) continue;
    let ranges;
    if (unit === '*') {
      // A driver's own top-level statements: the lines inside no declaration. They name what runs.
      const inUnit = new Set();
      for (const u of m.units) if (!u.method) for (let l = u.from; l <= u.to; l++) inUnit.add(l);
      ranges = [];
      for (let l = 1; l <= m.lines.length; l++) if (!inUnit.has(l)) ranges.push({ from: l, to: l });
    } else {
      // A unit and, for an object, every method in it; a method alone otherwise.
      const u = m.units.find((x) => x.name === unit);
      if (!u) continue;
      ranges = [{ from: u.from, to: u.to }];
    }
    const inRange = (line) => ranges.some((r) => line >= r.from && line <= r.to) && !(m.flags && [...m.flags].some(([f, on]) => !on && new RegExp(`\\bif\\s*\\(\\s*${f}\\s*\\)`).test(m.lines[line - 1] || '')));
    const ids = [...new Set(m.refs.filter((r) => inRange(r.line) && refHits(r, owned)).map((r) => r.value))];
    if (ids.length) hits.push({ file, unit, ids });
    // A line behind a flag this run has off (`if (JOURNEY) await testerJourney(…)`) names nothing that runs.
    const off = [...m.flags].filter(([, on]) => !on).map(([f]) => f);
    const guarded = (line) => off.some((f) => new RegExp(`\\bif\\s*\\(\\s*${f.replace(/\$/g, '\\$')}\\s*\\)`).test(line));
    const text = ranges.map((r) => m.lines.slice(r.from - 1, r.to).filter((l) => !guarded(l)).join('\n')).join('\n');
    // Same module: units it names (top-level names; object methods through `obj.method`).
    for (const u of m.units) {
      if (u.name === unit) continue;
      if (u.method) { if (word(u.name).test(text) || (unit.startsWith(u.name.split('.')[0] + '.') && new RegExp(`\\b(this|${u.name.split('.')[0]})\\.${u.name.split('.')[1]}\\b`).test(text))) stack.push({ file, unit: u.name }); }
      else if (word(u.name).test(text) && !(unit.includes('.') && unit.startsWith(u.name + '.'))) stack.push({ file, unit: u.name });
    }
    // Other modules: imported names it uses.
    for (const [local, target] of m.imports) {
      if (!word(local).test(text)) continue;
      if (target.name === '*') { stack.push({ file: target.file, unit: '*' }); continue; }
      const t = mod(target.file);
      const methods = t.units.filter((u) => u.method && u.name.startsWith(`${target.name}.`));
      const called = methods.filter((u) => new RegExp(`(?<![\\w$])${local}\\.${u.name.split('.')[1]}\\b`).test(text));
      if (methods.length && called.length) called.forEach((u) => stack.push({ file: target.file, unit: u.name }));
      else stack.push({ file: target.file, unit: target.name });
    }
  }
  return hits;
}

/**
 * Each `node <driver>` in legs/*.sh, with the NAME=value settings on its command (continuation lines included):
 * [{ leg, driver, env: Map }]. A driver's flags read those, so a flow a leg never switches on is not counted.
 */
export function legInvocations(legsDir, root = e2eDir, top = repo) {
  const out = [];
  for (const f of fs.readdirSync(legsDir).filter((n) => n.endsWith('.sh'))) {
    const leg = f.replace(/\.sh$/, '');
    const lines = fs.readFileSync(path.join(legsDir, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\bnode\s+((?:e2e\/)?[\w./-]+\.m?js)\b/g)) {
        let cmd = line;
        for (let j = i - 1; j >= 0 && /\\\s*$/.test(lines[j]); j--) cmd = lines[j] + ' ' + cmd;
        const env = new Map([...cmd.matchAll(/\b([A-Z][A-Z0-9_]*)=("[^"]*"|'[^']*'|\S*)/g)].map((e) => [e[1], e[2].replace(/^["']|["']$/g, '')]));
        out.push({ leg, driver: path.resolve(m[1].startsWith('e2e/') ? top : root, m[1]), env });
      }
    });
  }
  return out;
}

/** The selection, with the reason for each leg: the changed file, the testID, the unit that names it. */
export function select(changed, { manifests, legsDir, root = e2eDir, top = repo, read = (f) => fs.readFileSync(f, 'utf8') }) {
  const owners = ownersFrom(manifests);
  const owned = idsOwnedBy(changed, owners);
  const ownsIt = (f, id) => [f, f.replace(/\.(tsx?|jsx?)$/, '.ids.ts')].some((g) => owners.get(g)?.keys.has(id) || owners.get(g)?.stems.has(id));
  const ownerOf = (id) => changed.find((f) => ownsIt(f, id)) || '(stem match)';
  const legs = new Map();
  if (!owned.keys.size && !owned.stems.size) return { legs, ...owned };
  for (const { leg, driver, env } of legInvocations(legsDir, root, top)) {
    if (!fs.existsSync(driver)) continue;
    for (const h of reach(driver, owned, read, env)) {
      if (!legs.has(leg)) legs.set(leg, []);
      for (const id of h.ids) legs.get(leg).push({ id, unit: `${path.relative(top, h.file)}#${h.unit}`, driver: path.relative(top, driver), changed: ownerOf(id) });
    }
  }
  return { legs, ...owned };
}

function changedFiles(range) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  const files = git('diff', '--name-only', range).split('\n').filter(Boolean);
  const [a, b] = range.split('..');
  const pin = (rev) => { try { return git('rev-parse', `${rev}:bifold`); } catch { return ''; } };
  const pa = pin(a), pb = pin(b);
  if (pa && pb && pa !== pb) {
    const inner = execFileSync('git', ['-C', path.join(repo, 'bifold'), 'diff', '--name-only', `${pa}..${pb}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    files.push(...inner.map((f) => `bifold/${f}`));
  }
  return files.filter((f) => f !== 'bifold');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const changed = arg('--files') ? arg('--files').split(',').map((s) => s.trim()).filter(Boolean) : arg('--range') ? changedFiles(arg('--range')) : null;
  if (!changed) { console.error('usage: changed.mjs --files a,b,… | --range <a>..<b> [--json]'); process.exit(64); }
  const manifests = MANIFESTS.filter((m) => fs.existsSync(path.join(e2eDir, m.file))).map((m) => ({ root: m.root, json: JSON.parse(fs.readFileSync(path.join(e2eDir, m.file), 'utf8')) }));
  const r = select(changed, { manifests, legsDir: path.join(here, 'legs') });
  const legs = [...r.legs.keys()].sort();
  const code = r.unmapped.length ? 2 : legs.length ? 0 : 1;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ legs, reasons: Object.fromEntries(r.legs), mapped: r.mapped, unmapped: r.unmapped, verdict: ['select', 'none', 'full-gate'][code] }, null, 2));
  } else {
    for (const leg of legs) {
      const why = r.legs.get(leg);
      console.log(`leg ${leg}: ${[...new Set(why.map((w) => w.id))].slice(0, 6).join(', ')}${why.length > 6 ? ', …' : ''} (via ${[...new Set(why.map((w) => w.unit))].slice(0, 4).join(', ')})`);
    }
    if (r.unmapped.length) console.log(`unmapped (owns no testID; use the full gate): ${r.unmapped.join(', ')}`);
    if (!legs.length && !r.unmapped.length) console.log('no leg names a testID these files own');
    console.log(`legs=${legs.join(',')}`);
  }
  // exitCode, not exit(): the --json gate.sh reads through a pipe must be written in full first.
  process.exitCode = code;
}
