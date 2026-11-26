#!/usr/bin/env node
// Every uncheckedRules entry #1381 adds, read with `git show pr1381:<path>` (no checkout).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import YAML from 'yaml';
const REPO = `${process.env.HCP_REVIEW_ROOT ?? '.'}/tt`;
const files = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', 'pr1381', 'specs/hcp'], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('/spec.md'));
const out = [];
for (const f of files) {
  const md = execFileSync('git', ['-C', REPO, 'show', `pr1381:${f}`], { encoding: 'utf8' });
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const meta = fm ? YAML.parse(fm[1]) : {};
  for (const r of meta.uncheckedRules ?? []) out.push({ slug: meta.slug, spec: f, ...r });
}
fs.writeFileSync(new URL('./out/unchecked-rules-1381.json', import.meta.url), JSON.stringify(out, null, 1));
const bySlug = {};
for (const r of out) bySlug[r.slug] = (bySlug[r.slug] ?? 0) + 1;
console.log(`${out.length} uncheckedRules in ${Object.keys(bySlug).length} specs`, bySlug);
