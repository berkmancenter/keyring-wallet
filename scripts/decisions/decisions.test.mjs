// node --test scripts/decisions/decisions.test.mjs   (a fake log in a temp folder; never the real one)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { append, readLog, render } from './decisions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'decisions-')); return { dir: d, file: path.join(d, 'decisions.jsonl'), done: () => rmSync(d, { recursive: true, force: true }) }; };
const ask = (file) => append(file, { event: 'asked', appendedBy: 'research-4d', question: 'Which option?', options: ['A', 'B'], recommendation: 'A', owner: 'owner' });

test('asked: sequential ids, the file created private (mode 600)', () => {
  const t = tmp();
  try {
    assert.equal(ask(t.file).id, 'D-1');
    assert.equal(ask(t.file).id, 'D-2');
    assert.equal(statSync(t.file).mode & 0o777, 0o600);
  } finally { t.done(); }
});

test('answered: only by the lane that heard it; choice an option index; a summary for the board', () => {
  const t = tmp();
  try {
    ask(t.file);
    const base = { event: 'answered', id: 'D-1', appendedBy: 'coordinator-19', heardVia: 'session', summary: 'option B', words: 'fake words for the test' };
    assert.throws(() => append(t.file, { ...base, heardBy: 'research-4d', choice: 1 }), /only the lane that heard the answer/);
    assert.throws(() => append(t.file, { ...base, heardBy: 'coordinator-19', choice: 5 }), /option index 0-1/);
    assert.throws(() => append(t.file, { ...base, heardBy: 'coordinator-19', choice: 1, summary: undefined }), /summary/);
    assert.equal(append(t.file, { ...base, heardBy: 'coordinator-19', choice: 1 }).event, 'answered');
  } finally { t.done(); }
});

test('words only on answered; a relay is reported, never his words', () => {
  const t = tmp();
  try {
    ask(t.file);
    assert.throws(() => append(t.file, { event: 'reported', id: 'D-1', appendedBy: 'research-4d', source: 'coordinator-19', choice: 0, summary: 's', words: 'x' }), /"words" belong only/);
    assert.equal(append(t.file, { event: 'reported', id: 'D-1', appendedBy: 'research-4d', source: 'coordinator-19', choice: 0, summary: 'option A' }).event, 'reported');
  } finally { t.done(); }
});

test('roles, not names: appendedBy must be a lane id', () => {
  const t = tmp();
  try {
    assert.throws(() => append(t.file, { event: 'asked', appendedBy: 'A Person', question: 'q' }), /lane role id/);
  } finally { t.done(); }
});

test('render: current state, paraphrase only; the words never leave the log', () => {
  const t = tmp();
  try {
    ask(t.file); ask(t.file);
    append(t.file, { event: 'answered', id: 'D-1', appendedBy: 'coordinator-19', heardBy: 'coordinator-19', heardVia: 'session', choice: 1, summary: 'option B', words: 'SECRET VERBATIM' });
    append(t.file, { event: 'superseded', id: 'D-2', appendedBy: 'coordinator-19', supersededBy: 'D-1' });
    const r = render(readLog(t.file));
    assert.deepEqual(r.map((d) => `${d.id}:${d.state}`), ['D-1:answered', 'D-2:superseded']);
    assert.equal(r[0].summary, 'option B');
    assert.ok(!JSON.stringify(r).includes('SECRET VERBATIM'));
  } finally { t.done(); }
});

test('append-only: earlier records are never rewritten', () => {
  const t = tmp();
  try {
    ask(t.file);
    const before = readFileSync(t.file, 'utf8');
    ask(t.file);
    assert.ok(readFileSync(t.file, 'utf8').startsWith(before));
  } finally { t.done(); }
});

test('the command line: ask, answer, render; errors exit 2', () => {
  const t = tmp();
  try {
    const run = (...a) => execFileSync('node', [path.join(here, 'decisions.mjs'), ...a], { env: { ...process.env, DECISIONS_FILE: t.file }, encoding: 'utf8' }).trim();
    assert.equal(run('ask', '--by', 'research-4d', '--question', 'Which option?', '--options', 'A|B'), 'D-1');
    assert.equal(run('answer', 'D-1', '--by', 'coordinator-19', '--heard-by', 'coordinator-19', '--heard-via', 'session', '--choice', '1', '--summary', 'option B'), 'D-1 answered');
    assert.match(run('render'), /^D-1 \[answered\] Which option\? -> option B$/);
    try { run('answer', 'D-1', '--by', 'research-4d', '--heard-by', 'coordinator-19', '--heard-via', 'session', '--choice', '0', '--summary', 's'); assert.fail('should exit 2'); }
    catch (e) { assert.equal(e.status, 2); }
  } finally { t.done(); }
});

const sup = (file, id, by) => append(file, { event: 'superseded', id, appendedBy: 'research-4d', supersededBy: by });
const withdraw = (file, id) => append(file, { event: 'withdrawn', id, appendedBy: 'research-4d', reason: 'no longer needed' });

test('the place: never inside a git work tree (symlinked folders too), never a symlink, never a writable folder', () => {
  const t = tmp();
  try {
    const repo = path.join(t.dir, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    assert.throws(() => ask(path.join(repo, 'docs', 'decisions.jsonl')), /inside the git work tree/);
    symlinkSync(path.join(repo, 'docs'), path.join(t.dir, 'looks-private'));
    mkdirSync(path.join(repo, 'docs'), { recursive: true });
    assert.throws(() => ask(path.join(t.dir, 'looks-private', 'decisions.jsonl')), /inside the git work tree/);
    assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }), '');

    const real = path.join(t.dir, 'real.jsonl');
    writeFileSync(real, '');
    symlinkSync(real, path.join(t.dir, 'link.jsonl'));
    assert.throws(() => ask(path.join(t.dir, 'link.jsonl')), /symlink/);

    const open = path.join(t.dir, 'open');
    mkdirSync(open);
    chmodSync(open, 0o777);
    assert.throws(() => ask(path.join(open, 'decisions.jsonl')), /group- or world-writable/);

    const fresh = path.join(t.dir, 'new', 'deeper', 'decisions.jsonl');
    assert.equal(ask(fresh).id, 'D-1');
    assert.equal(statSync(path.dirname(fresh)).mode & 0o777, 0o700);
  } finally { t.done(); }
});

test('supersede: not itself, not round a loop, not onto a withdrawn decision; render says which one stands', () => {
  const t = tmp();
  try {
    for (let i = 0; i < 5; i++) ask(t.file);
    assert.throws(() => sup(t.file, 'D-1', 'D-1'), /cannot supersede itself/);
    sup(t.file, 'D-1', 'D-2');
    sup(t.file, 'D-2', 'D-3');
    assert.throws(() => sup(t.file, 'D-3', 'D-1'), /leads back to D-3 .*a loop/);
    withdraw(t.file, 'D-5');
    assert.throws(() => sup(t.file, 'D-4', 'D-5'), /withdrawn/);
    let r = Object.fromEntries(render(readLog(t.file)).map((d) => [d.id, d]));
    assert.equal(r['D-1'].current, 'D-3');
    assert.equal(r['D-1'].unresolved, undefined);
    assert.equal(r['D-4'].current, 'D-4');
    withdraw(t.file, 'D-3');
    r = Object.fromEntries(render(readLog(t.file)).map((d) => [d.id, d]));
    assert.equal(r['D-1'].current, 'D-3');
    assert.equal(r['D-1'].unresolved, true);
  } finally { t.done(); }
});

test('render: a chain that is broken (a hand-edited log) is unresolved, never an endless loop', () => {
  const log = [
    { event: 'asked', id: 'D-1', question: 'q' }, { event: 'asked', id: 'D-2', question: 'q' },
    { event: 'superseded', id: 'D-1', supersededBy: 'D-2' }, { event: 'superseded', id: 'D-2', supersededBy: 'D-1' },
    { event: 'asked', id: 'D-3', question: 'q' }, { event: 'superseded', id: 'D-3', supersededBy: 'D-9' },
  ];
  const r = Object.fromEntries(render(log).map((d) => [d.id, d]));
  assert.equal(r['D-1'].unresolved, true);
  assert.equal(r['D-3'].unresolved, true);
});

test('withdrawn and superseded are final: nothing more is recorded, and render ignores anything after', () => {
  const t = tmp();
  try {
    ask(t.file); ask(t.file);
    withdraw(t.file, 'D-1');
    const answer = { event: 'answered', id: 'D-1', appendedBy: 'coordinator-19', heardBy: 'coordinator-19', heardVia: 'session', choice: 0, summary: 'option A', words: 'fake' };
    assert.throws(() => append(t.file, answer), /D-1 is withdrawn, which is final/);
    assert.throws(() => append(t.file, { event: 'reported', id: 'D-1', appendedBy: 'research-4d', source: 'coordinator-19', choice: 0, summary: 's' }), /final/);
    assert.throws(() => withdraw(t.file, 'D-1'), /final/);
    const d3 = ask(t.file).id;
    sup(t.file, 'D-2', d3);
    assert.throws(() => append(t.file, { ...answer, id: 'D-2' }), /D-2 is superseded, which is final/);
    appendFileSync(t.file, JSON.stringify({ ...answer, v: 1, at: 'x' }) + '\n');
    assert.equal(render(readLog(t.file)).find((d) => d.id === 'D-1').state, 'withdrawn');
  } finally { t.done(); }
});

test('appends hold a lock: lanes appending at once never mint the same id; an abandoned lock is taken', async () => {
  const t = tmp();
  try {
    const one = () => new Promise((res, rej) => {
      const c = spawn('node', [path.join(here, 'decisions.mjs'), 'ask', '--by', 'research-4d', '--question', 'q'], { env: { ...process.env, DECISIONS_FILE: t.file } });
      let out = ''; c.stdout.on('data', (b) => { out += b; });
      c.on('close', (code) => (code === 0 ? res(out.trim()) : rej(new Error(`exit ${code}`))));
    });
    const ids = await Promise.all(Array.from({ length: 8 }, one));
    assert.equal(new Set(ids).size, 8);
    assert.deepEqual(readLog(t.file).map((r) => r.id).sort(), [...ids].sort());

    writeFileSync(`${t.file}.lock`, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${t.file}.lock`, old, old);
    assert.equal(ask(t.file).id, 'D-9');
  } finally { t.done(); }
});
