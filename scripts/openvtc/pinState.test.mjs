// node --test scripts/openvtc/pinState.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pinState } from './pinState.mjs';

const FULL = '439a03335eae64638fbdfa0c5d45bae9bbbc715f';
const OTHER = 'f7b78e29d0000000000000000000000000000000';

test('the pin named as git abbreviates it, at HEAD: pinned', () => {
  assert.equal(pinState({ head: '439a03335', headCommit: FULL, pinSha: '439a03335', pinCommit: FULL }), 'pinned');
});

test('the same commit named shorter than git abbreviates it: misnamed, not off (the 439a0333 case)', () => {
  assert.equal(pinState({ head: '439a03335', headCommit: FULL, pinSha: '439a0333', pinCommit: FULL }), 'misnamed');
});

test('named longer, or in full, is misnamed too: setup compares the short form', () => {
  assert.equal(pinState({ head: '439a03335', headCommit: FULL, pinSha: FULL, pinCommit: FULL }), 'misnamed');
});

test('HEAD at another commit is off, however the pin is spelled (control)', () => {
  assert.equal(pinState({ head: 'f7b78e29d', headCommit: OTHER, pinSha: '439a03335', pinCommit: FULL }), 'off');
});

test('a pin that resolves to no commit here is off, and is fetched as before (control)', () => {
  assert.equal(pinState({ head: '439a03335', headCommit: FULL, pinSha: 'deadbeef', pinCommit: undefined }), 'off');
});
