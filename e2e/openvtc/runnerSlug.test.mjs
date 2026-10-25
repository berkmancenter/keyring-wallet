import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRunnerSlug } from './runnerSlug.js';

test('the Farm runners, the lab bob, and the Mac mini slug for the same runners are accepted', () => {
  for (const s of ['farm3-runner-prague', 'farm-runner-openvtc', 'bob', 'keyring-mini-gate-farm3-runner-prague', 'keyring-mini-gate-farm3-runner-openvtc']) {
    assert.equal(isRunnerSlug(s), true, s);
  }
});

test('a person\'s agent, another runner, a dedicated vetter agent, or a near miss is refused', () => {
  for (const s of ['alice', 'alberto3', 'alberto-push-vta-2', 'keyring-mini-gate-alice', 'keyring-mini-gate-farm3-runner-uiux',
    'keyring-mini-gate-mini-hvvetter', 'keyring-mini-gate-', 'farm3-runner-prague-x', 'xkeyring-mini-gate-bob', '', undefined]) {
    assert.equal(isRunnerSlug(s), false, String(s));
  }
});
