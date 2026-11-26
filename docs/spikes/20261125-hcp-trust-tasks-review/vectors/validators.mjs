// Two Ajv 2020-12 registries: HCP's schemas under their own $id, and every
// Trust Task *.schema.json under its file URL (the framework does the same in
// scripts/lib/spec-examples.mjs, because the published $id does not resolve the
// on-disk relative $refs). Nothing here imports the PR's scripts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { HCP_SCHEMAS, TT_ROOT, TT_HCP } from './lib.mjs';

const HCP_BASE = 'https://hcp.example/schemas/2.0-draft-3/';

function walk(d, pred, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(e.name)) out.push(p);
  }
  return out;
}

export function makeHcpAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false });
  addFormats(ajv);
  for (const f of walk(HCP_SCHEMAS, (n) => n.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(HCP_SCHEMAS, f).split(path.sep).join('/');
    if (j.$id !== HCP_BASE + rel) throw new Error(`HCP ${rel}: unexpected $id ${j.$id}`);
    ajv.addSchema(j);
  }
  return ajv;
}

export function makeTtAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false });
  addFormats(ajv);
  for (const f of walk(path.join(TT_ROOT, 'specs'), (n) => n.endsWith('.schema.json'))) {
    if (path.dirname(f) === path.join(TT_ROOT, 'specs')) continue; // spec.meta.schema.json
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    ajv.addSchema({ ...j, $id: pathToFileURL(f).href });
  }
  return ajv;
}

const cache = new Map();
/** A validator for `file#pointer` on one side ('hcp' paths under schemas/2.0-draft-3, 'tt' under specs/hcp). */
export function validator(side, spec) {
  const k = `${side}:${spec}`;
  if (cache.has(k)) return cache.get(k);
  const [file, pointer = ''] = spec.split('#');
  const ajv = side === 'hcp' ? (validator.hcp ??= makeHcpAjv()) : (validator.tt ??= makeTtAjv());
  const uri = side === 'hcp' ? `${HCP_BASE}${file}` : pathToFileURL(path.join(TT_HCP, file)).href;
  const v = ajv.getSchema(pointer ? `${uri}#${pointer}` : uri);
  if (!v) throw new Error(`${side} ${spec}: no schema`);
  cache.set(k, v);
  return v;
}

export const errs = (v, n = 3) =>
  (v.errors || [])
    .slice(0, n)
    .map((e) => `${e.instancePath || '/'} ${e.message}${e.params && e.keyword === 'additionalProperties' ? ` (${e.params.additionalProperty})` : ''}${e.keyword === 'required' ? '' : ''}`)
    .join('; ');

export function check(side, spec, value) {
  const v = validator(side, spec);
  const ok = v(value);
  return { ok, errors: ok ? '' : errs(v, 4), raw: ok ? [] : [...v.errors] };
}
