#!/usr/bin/env node
// Do two wallet commits carry the same app build? The CI test build (test-builds.yml) skips a push whose changes are
// all under its `paths-ignore`, so a main commit after only e2e/docs changes has no build of its own, and a build of
// main's HEAD is the same app as the last commit that was built. The watcher uses this to take HEAD's push-on build
// for a gate of an older commit (1011, first auto-run: main moved past c75ecfa4 with e2e-only merges, the push-on
// build came for 21946ac, and the gate waited an hour for one of c75ecfa4 that could never come).
//
// The list is read from the workflow file itself, never copied, so the two cannot drift.
//
//   samebuild.mjs <repo-dir> <from-sha> <to-sha> [--workflow .github/workflows/test-builds.yml]
//       prints "same" (exit 0), "app-changed <n> <first path>" (exit 1), or "unknown: <why>" (exit 2)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_FILE = '.github/workflows/test-builds.yml';

const indentOf = (line) => line.length - line.trimStart().length;
const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');

/** The `paths-ignore` globs of the workflow's `on: push:` trigger, or undefined when it has none. */
export function pushPathsIgnore(yamlText) {
  const lines = String(yamlText).split('\n');
  const on = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (on < 0) return undefined;
  let push = -1;
  for (let i = on + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
    if (indentOf(l) === 0) break;
    if (/^\s+push:\s*$/.test(l)) { push = i; break; }
  }
  if (push < 0) return undefined;
  const pushIndent = indentOf(lines[push]);
  for (let i = push + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
    if (indentOf(l) <= pushIndent) return undefined;
    if (/^\s+paths-ignore:\s*$/.test(l)) {
      const keyIndent = indentOf(l);
      const globs = [];
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j];
        if (item.trim() === '' || item.trimStart().startsWith('#')) continue;
        if (indentOf(item) <= keyIndent && !item.trimStart().startsWith('- ')) break;
        const m = item.match(/^\s*-\s+(.+?)\s*(#.*)?$/);
        if (!m) break;
        globs.push(unquote(m[1]));
      }
      return globs;
    }
  }
  return undefined;
}

/** A GitHub paths glob as a RegExp: `**` any depth (`**\/` also zero directories), `*` and `?` within a segment. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The changed paths a build would not ignore: any one of them means a different app. */
export function appPaths(files, globs) {
  const res = globs.map(globToRegExp);
  return files.filter((f) => f && !res.some((r) => r.test(f)));
}

export function verdict(repo, from, to, workflow = WORKFLOW_FILE) {
  let text;
  try {
    text = readFileSync(path.join(repo, workflow), 'utf8');
  } catch (e) {
    return { code: 2, line: `unknown: cannot read ${workflow} (${e.code ?? e.message})` };
  }
  const globs = pushPathsIgnore(text);
  if (!globs) return { code: 2, line: `unknown: ${workflow} has no push paths-ignore list` };
  let files;
  try {
    files = execFileSync('git', ['-C', repo, 'diff', '--name-only', `${from}..${to}`], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (e) {
    return { code: 2, line: `unknown: git diff ${from}..${to} failed` };
  }
  const app = appPaths(files, globs);
  return app.length ? { code: 1, line: `app-changed ${app.length} ${app[0]}` } : { code: 0, line: 'same' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const wf = args.includes('--workflow') ? args[args.indexOf('--workflow') + 1] : WORKFLOW_FILE;
  const [repo, from, to] = args.filter((a, i) => a !== '--workflow' && args[i - 1] !== '--workflow');
  if (!repo || !from || !to) {
    console.log('unknown: usage: samebuild.mjs <repo-dir> <from-sha> <to-sha> [--workflow <file>]');
    process.exit(2);
  }
  const v = verdict(repo, from, to, wf);
  console.log(v.line);
  process.exit(v.code);
}
