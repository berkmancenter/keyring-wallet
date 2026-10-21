// node --test e2e/gate/waitingAttribution.test.mjs
// The waiting leg judges and declines only this phone's own join request on C, which kk shares: never "the newest
// pending" one. The identity rows SKIP without an attributed request; a decline run declines only the single pending
// request whose applicant is the identity the phone showed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const leg = readFileSync(path.join(here, 'legs', 'waiting.sh'), 'utf8');

test('no newest-pending pick anywhere in the leg', () => {
  assert.doesNotMatch(leg, /items\[-1\]|newest pending request \(\$RID\)/);
  assert.match(leg, /row "\$shot" SKIP "no request attributed to this phone/);
});

test('a decline run picks only the single pending request from the identity the phone showed', () => {
  const py = leg.match(/python3 -c "\n([\s\S]*?)"\)/)[1];
  const pick = (me, items) => execFileSync('python3', ['-c', py], { input: JSON.stringify({ items }), env: { ...process.env, ME: me }, encoding: 'utf8' }).trim();
  const mine = { id: 'r-mine', applicantDid: 'did:webvh:x:mine', submittedAt: '2026-10-21T08:00:00Z' };
  const theirs = { id: 'r-theirs', applicantDid: 'did:webvh:x:theirs', submittedAt: '2026-10-21T08:00:09Z' };
  assert.equal(pick('did:webvh:x:mine', [mine, theirs]), 'r-mine', 'theirs is newer, mine is taken');
  assert.equal(pick('did:webvh:x:mine', [theirs]), '-', 'none of mine: nothing');
  assert.equal(pick('did:webvh:x:mine', [mine, { ...mine, id: 'r-mine-2' }]), '-', 'two of mine: nothing');
  assert.equal(pick('', [mine, theirs]), '-', 'no identity shown: nothing');
});
