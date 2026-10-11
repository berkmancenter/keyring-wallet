// node --test scripts/decisions/decisions.test.mjs   (a fake log in a temp folder; never the real one)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { append, readLog, render } from './decisions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'decisions-')); return { file: path.join(d, 'decisions.jsonl'), done: () => rmSync(d, { recursive: true, force: true }) }; };
const ask = (file) => append(file, { event: 'asked', appendedBy: 'research-4d', question: 'Which option?', options: ['A', 'B'], recommendation: 'A', owner: 'alberto' });

test('asked: sequential ids, the file created private (mode 600)', () => {
  const t = tmp();
  try {
    assert.equal(ask(t.file).id, 'D-1');
    assert.equal(ask(t.file).id, 'D-2');
    assert.equal(statSync(t.file).mode & 0o777, 0o600);
  } finally { t.done(); }
});

test('answered: only by the lane that heard him; choice an option index; a summary for the board', () => {
  const t = tmp();
  try {
    ask(t.file);
    const base = { event: 'answered', id: 'D-1', appendedBy: 'coordinator-19', heardVia: 'session', summary: 'option B', words: 'fake words for the test' };
    assert.throws(() => append(t.file, { ...base, heardBy: 'research-4d', choice: 1 }), /only the lane that heard him/);
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
    assert.throws(() => append(t.file, { event: 'asked', appendedBy: 'Alberto L', question: 'q' }), /lane role id/);
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
