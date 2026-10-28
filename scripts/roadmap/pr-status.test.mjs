// node --test scripts/roadmap/pr-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRefs } from './pr-status.mjs';

const here = { owner: 'acme', repo: 'app' };
const names = (text) => parseRefs(text, here).map((r) => `${r.owner}/${r.repo}#${r.number}`);

test('Refs names cards in this repository and in others', () => {
  assert.deepEqual(names('Refs #12'), ['acme/app#12']);
  assert.deepEqual(names('Refs acme/lib#7'), ['acme/lib#7']);
  assert.deepEqual(names('refs: #1, #2 and acme/lib#3'), ['acme/app#1', 'acme/app#2', 'acme/lib#3']);
});

test('a bare #N, Closes or Fixes moves nothing', () => {
  assert.deepEqual(names('See #12 for context. Closes #13. Fixes #14.'), []);
  assert.deepEqual(names('Prefers #12'), []);
});

test('a card named twice is moved once', () => {
  assert.deepEqual(names('Refs #4\n\nRefs #4, acme/app#4'), ['acme/app#4']);
});

test('no body is no refs', () => {
  assert.deepEqual(parseRefs(null, here), []);
});
