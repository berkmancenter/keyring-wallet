// node --test scripts/openvtc/pinState.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pinState } from './pinState.mjs';

const FULL = '439a03335eae64638fbdfa0c5d45bae9bbbc715f';
const OTHER = 'f7b78e29dfa0fc79d125eba5970cce66d82b53d5';
// At the pin, setup computes pinBehindHead true too (a commit is its own ancestor): the rows say what it says.
const at = (o) => pinState({ head: '439a03335', headCommit: FULL, pinBehindHead: true, ...o });

test('the pin named as git abbreviates it, at HEAD: pinned', () => {
  assert.equal(at({ pinSha: '439a03335', pinCommit: FULL }), 'pinned');
});

test('named in full, or longer than git abbreviates: pinned (a full sha can never go ambiguous)', () => {
  assert.equal(at({ pinSha: FULL, pinCommit: FULL }), 'pinned');
  assert.equal(at({ pinSha: '439a03335eae', pinCommit: FULL }), 'pinned');
});

test('named shorter than git abbreviates it: misnamed, not off (the 439a0333 case)', () => {
  assert.equal(at({ pinSha: '439a0333', pinCommit: FULL }), 'misnamed');
});

test('a pin older than HEAD would move the clone back: rewind (a stale checkout running setup)', () => {
  assert.equal(
    pinState({ head: 'f7b78e29d', headCommit: OTHER, pinSha: '439a03335', pinCommit: FULL, pinBehindHead: true }),
    'rewind'
  );
});

test('HEAD at another commit the pin is not behind is off, and is checked out as before (control)', () => {
  assert.equal(pinState({ head: 'f7b78e29d', headCommit: OTHER, pinSha: '439a03335', pinCommit: FULL }), 'off');
});

test('a pin that resolves to no commit here is off, and is fetched as before (control)', () => {
  assert.equal(at({ pinSha: 'deadbeef', pinCommit: undefined, pinBehindHead: true }), 'off');
});
