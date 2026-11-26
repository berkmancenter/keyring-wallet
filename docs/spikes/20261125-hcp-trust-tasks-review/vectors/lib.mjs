// Shared helpers for the independent HCP <-> Trust Task comparison and vector tests.
// Nothing here imports the PR's scripts.
import fs from 'node:fs';
import path from 'node:path';

// The review folder: the proposal checkout at ./tt (branch pr1380 as tt-drift), HCP's spec at ./hcp-spec.
export const BASE = process.env.HCP_REVIEW_ROOT ?? '.';
export const TT_ROOT = `${BASE}/tt-drift`;
export const HCP_ROOT = `${BASE}/hcp-spec`;
export const HCP_SCHEMAS = `${HCP_ROOT}/schemas/2.0-draft-3`;
export const TT_HCP = `${TT_ROOT}/specs/hcp`;
export const OUT = `${BASE}/vectors/out`;

const pp = path.posix;

export function makeSide(root) {
  const docs = new Map();
  const doc = (file) => {
    if (!docs.has(file)) docs.set(file, JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
    return docs.get(file);
  };
  const at = (file, pointer = '') => {
    let node = doc(file);
    for (const seg of pointer.split('/').slice(1)) {
      const k = decodeURIComponent(seg).replace(/~1/g, '/').replace(/~0/g, '~');
      if (node === null || typeof node !== 'object' || !(k in node)) throw new Error(`${file}#${pointer}: no such pointer`);
      node = node[k];
    }
    return node;
  };
  const locate = (spec) => {
    const [file, pointer = ''] = spec.split('#');
    return { file, pointer, node: at(file, pointer) };
  };
  const ref = (from, r) => {
    const [f, frag = ''] = r.split('#');
    const file = f ? pp.normalize(pp.join(pp.dirname(from.file), f)) : from.file;
    return { file, pointer: frag, node: at(file, frag) };
  };
  const child = (loc, ...segs) => ({
    file: loc.file,
    pointer: `${loc.pointer}/${segs.map((s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`,
    node: segs.reduce((n, s) => n[s], loc.node),
  });
  return { root, locate, ref, child, doc };
}

export const key = (loc) => `${loc.file}#${loc.pointer}`;

const ANNOT = new Set(['description', 'title', '$comment', '$anchor', '$id', '$schema', 'default', 'examples', '$defs']);

/** Follow a chain of refs that carry only annotations, to give shared targets one identity. */
export function canonical(side, loc) {
  let cur = loc;
  for (let i = 0; i < 32; i++) {
    const n = cur.node;
    if (!n || typeof n !== 'object' || typeof n.$ref !== 'string') return cur;
    if (!Object.keys(n).every((k) => k === '$ref' || ANNOT.has(k))) return cur;
    cur = side.ref(cur, n.$ref);
  }
  return cur;
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isRequiredOnly = (n) => n && typeof n === 'object' && Array.isArray(n.required) && Object.keys(n).every((k) => k === 'required' || ANNOT.has(k));

export function emptyShape() {
  return {
    types: null,
    nullable: false,
    values: null,
    format: null,
    patterns: [],
    bounds: {},
    uniqueItems: false,
    props: new Map(),
    condProps: new Map(),
    required: new Set(),
    additional: undefined, // undefined | true | false | loc
    items: null,
    alts: null,
    rules: [], // conditionals and cross-member rules, canonical text
    hasObjectKeywords: false,
  };
}

const TIGHT_MAX = ['minLength', 'minItems', 'minimum', 'minProperties'];
const TIGHT_MIN = ['maxLength', 'maxItems', 'maximum', 'maxProperties'];

function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => !ANNOT.has(k))
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Fold one node (with its $ref, allOf, null-anyOf) into a shape. */
export function shapeOf(side, loc) {
  const s = emptyShape();
  absorb(s, side, loc, 0);
  if (!s.types && s.values) s.types = new Set([...s.values].map((v) => typeOf(JSON.parse(v))));
  if (s.values?.has('null')) {
    s.values = new Set([...s.values].filter((v) => v !== 'null'));
    s.nullable = true;
  }
  if (s.types?.has('null')) {
    s.types = new Set([...s.types].filter((t) => t !== 'null'));
    s.nullable = true;
  }
  return s;
}

function absorb(s, side, loc, depth) {
  if (depth > 48) throw new Error(`ref chain too deep at ${key(loc)}`);
  const n = loc.node;
  if (n === true || n === false || n === null || typeof n !== 'object') return;
  if (typeof n.$ref === 'string') absorb(s, side, side.ref(loc, n.$ref), depth + 1);
  if (n.type !== undefined) {
    const t = new Set([n.type].flat());
    s.types = s.types ? new Set([...s.types].filter((x) => t.has(x))) : t;
  }
  if ('const' in n) s.values = new Set([JSON.stringify(n.const)]);
  if (Array.isArray(n.enum)) {
    const v = new Set(n.enum.map((x) => JSON.stringify(x)));
    s.values = s.values ? new Set([...s.values].filter((x) => v.has(x))) : v;
  }
  if (n.format) s.format = n.format;
  if (n.pattern) s.patterns.push(n.pattern);
  for (const k of TIGHT_MAX) if (typeof n[k] === 'number') s.bounds[k] = Math.max(s.bounds[k] ?? -Infinity, n[k]);
  for (const k of TIGHT_MIN) if (typeof n[k] === 'number') s.bounds[k] = Math.min(s.bounds[k] ?? Infinity, n[k]);
  if (n.uniqueItems) s.uniqueItems = true;
  if (n.properties && typeof n.properties === 'object') {
    s.hasObjectKeywords = true;
    for (const k of Object.keys(n.properties)) if (!s.props.has(k)) s.props.set(k, side.child(loc, 'properties', k));
  }
  if (Array.isArray(n.required)) {
    s.hasObjectKeywords = true;
    for (const k of n.required) s.required.add(k);
  }
  if ('additionalProperties' in n) {
    const ap = n.additionalProperties;
    s.additional = typeof ap === 'boolean' ? ap : side.child(loc, 'additionalProperties');
  }
  if (n.items && typeof n.items === 'object') s.items = side.child(loc, 'items');
  if (Array.isArray(n.allOf)) n.allOf.forEach((_, i) => absorb(s, side, side.child(loc, 'allOf', i), depth + 1));
  if (n.if !== undefined) {
    s.rules.push(`if ${canon(n.if)} then ${canon(n.then ?? true)}${n.else !== undefined ? ` else ${canon(n.else)}` : ''}`);
    for (const k of ['then', 'else']) {
      const b = n[k];
      if (b && typeof b === 'object' && b.properties) {
        for (const name of Object.keys(b.properties)) if (!s.condProps.has(name)) s.condProps.set(name, side.child(loc, k, 'properties', name));
      }
    }
  }
  if (n.not !== undefined) s.rules.push(`not ${canon(n.not)}`);
  if (n.contains !== undefined) s.rules.push(`contains ${canon(n.contains)}${n.minContains !== undefined ? ` minContains ${n.minContains}` : ''}${n.maxContains !== undefined ? ` maxContains ${n.maxContains}` : ''}`);
  for (const k of ['anyOf', 'oneOf']) {
    if (!Array.isArray(n[k])) continue;
    if (n[k].every(isRequiredOnly)) {
      s.rules.push(`${k === 'oneOf' ? 'exactly' : 'at least'} one of (${n[k].map((b) => [...b.required].sort().join('+')).sort().join(' | ')}) present`);
      continue;
    }
    const branches = n[k].map((_, i) => side.child(loc, k, i));
    const isNull = (b) => b.node && b.node.type === 'null';
    const nonNull = branches.filter((b) => !isNull(b));
    if (nonNull.length < branches.length) s.nullable = true;
    if (nonNull.length === 1) absorb(s, side, nonNull[0], depth + 1);
    else s.alts = nonNull;
  }
}

/** Indented (4-space) JSON blocks of a Markdown file, with the nearest heading. */
export function extractJsonBlocks(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let heading = '?';
  let i = 0;
  while (i < lines.length) {
    const h = /^#+\s+(.*)$/.exec(lines[i]);
    if (h) heading = h[1].trim();
    if (/^(    |\t)\S/.test(lines[i]) && (i === 0 || !/^(    |\t)/.test(lines[i - 1]))) {
      const start = i;
      const b = [];
      while (i < lines.length && (/^(    |\t)/.test(lines[i]) || !lines[i].trim())) {
        b.push(lines[i].replace(/^(    |\t)/, ''));
        i++;
      }
      out.push({ file, line: start + 1, heading, text: b.join('\n').trim() });
      continue;
    }
    i++;
  }
  return out;
}

/** Fenced ```json blocks of a Markdown file, with the nearest heading. */
export function extractFenced(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let heading = '?';
  for (let i = 0; i < lines.length; i++) {
    const h = /^#+\s+(.*)$/.exec(lines[i]);
    if (h) heading = h[1].trim();
    const m = /^\s*```(\w*)/.exec(lines[i]);
    if (m) {
      const start = i;
      const b = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) b.push(lines[i++]);
      out.push({ file, line: start + 1, heading, lang: m[1], text: b.join('\n') });
    }
  }
  return out;
}
