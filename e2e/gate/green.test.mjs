import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, newestGreenMain } from './green.mjs';

const SHA = '592c362400000000000000000000000000000000';
const run = (o) => ({ databaseId: 1, headSha: SHA, headBranch: 'main', event: 'push', status: 'completed', conclusion: 'success', createdAt: '2026-10-08T16:00:00Z', ...o });

test('a completed, successful run of the commit is green', () => {
  assert.deepEqual(judge([run({ databaseId: 11 })], SHA), { state: 'green', run: 11 });
});

test('an in-progress run is pending, not done', () => {
  assert.deepEqual(judge([run({ databaseId: 12, status: 'in_progress', conclusion: '' })], SHA), { state: 'pending', run: 12 });
});

test('a completed run with an empty conclusion is pending (the 10-07 slip)', () => {
  assert.deepEqual(judge([run({ databaseId: 13, conclusion: '' })], SHA), { state: 'pending', run: 13 });
  assert.deepEqual(judge([run({ databaseId: 13, conclusion: null })], SHA), { state: 'pending', run: 13 });
});

test('cancelled and failed runs are failed, with the newest conclusion', () => {
  const r = judge([run({ databaseId: 14, conclusion: 'cancelled', createdAt: '2026-10-08T17:00:00Z' }), run({ databaseId: 15, conclusion: 'failure', createdAt: '2026-10-08T16:00:00Z' })], SHA);
  assert.deepEqual(r, { state: 'failed', run: 14, conclusion: 'cancelled' });
});

test('an older green run of the same commit still counts after a newer cancelled one', () => {
  const r = judge([run({ databaseId: 16, conclusion: 'cancelled', createdAt: '2026-10-08T18:00:00Z' }), run({ databaseId: 17, createdAt: '2026-10-08T16:00:00Z' })], SHA);
  assert.deepEqual(r, { state: 'green', run: 17 });
});

test('runs of another commit or another event are ignored', () => {
  assert.deepEqual(judge([run({ headSha: 'abc' })], SHA), { state: 'none' });
  assert.deepEqual(judge([run({ event: 'workflow_dispatch' })], SHA), { state: 'none' });
  assert.deepEqual(judge([run({ databaseId: 18, event: 'workflow_dispatch' })], SHA, { event: 'workflow_dispatch' }), { state: 'green', run: 18 });
});

test('no runs at all is none, and bad input is none', () => {
  assert.deepEqual(judge([], SHA), { state: 'none' });
  assert.deepEqual(judge(null, SHA), { state: 'none' });
  assert.deepEqual(judge([null, {}], SHA), { state: 'none' });
});

test('newest green main build wins over an older green one and over newer non-green ones', () => {
  const runs = [
    run({ databaseId: 20, headSha: 'aaaa', createdAt: '2026-10-08T10:00:00Z' }),
    run({ databaseId: 21, headSha: 'bbbb', createdAt: '2026-10-08T12:00:00Z' }),
    run({ databaseId: 22, headSha: 'cccc', createdAt: '2026-10-08T14:00:00Z', status: 'in_progress', conclusion: '' }),
    run({ databaseId: 23, headSha: 'dddd', createdAt: '2026-10-08T15:00:00Z', conclusion: 'failure' }),
    run({ databaseId: 24, headSha: 'eeee', createdAt: '2026-10-08T16:00:00Z', headBranch: 'rc/238' }),
    run({ databaseId: 25, headSha: 'ffff', createdAt: '2026-10-08T17:00:00Z', event: 'workflow_dispatch' }),
  ];
  assert.deepEqual(newestGreenMain(runs), { sha: 'bbbb', run: 21, createdAt: '2026-10-08T12:00:00Z' });
  assert.equal(newestGreenMain([]), null);
});
