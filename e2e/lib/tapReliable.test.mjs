import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapTestIdReliable } from './driver.js';
import { fakeDriver } from './pages/testing/fakeDriver.mjs';

// tapTestIdReliable(driver, key, verify, { timeout }): tap `key` until `verify()` passes. The dry run 1010-2222
// lost agents to a wait for Enter after the unlock had already gone through (the goal met, the button gone).

test('the goal met while waiting for the key: returns without a tap', async () => {
  const d = fakeDriver({ screen: { EnterPIN: {} } }); // no Enter on screen
  let calls = 0;
  // First check (before waiting): still locked. Then the unlock lands: PIN screen gone.
  const verify = async () => ++calls > 1;
  await tapTestIdReliable(d, 'Enter', verify, { timeout: 5000, settleMs: 10 });
  assert.equal(calls, 2);
  assert.deepEqual(d.taps, []);
});

// iOS: tapElement clicks the element (Android taps by adb, which a fake driver does not see).
test('the key there and the goal met after the tap: taps once', async () => {
  const d = fakeDriver({ platform: 'ios', screen: { Enter: {}, EnterPIN: {} } });
  d.onTap.Enter = () => d.hide('EnterPIN', 'Enter');
  const verify = async () => !d.has('EnterPIN');
  await tapTestIdReliable(d, 'Enter', verify, { timeout: 5000, settleMs: 10 });
  assert.deepEqual(d.taps, ['Enter']);
});

test('neither the key nor the goal: fails with the usual message and the full timeout', async () => {
  const d = fakeDriver({ screen: { EnterPIN: {} } });
  await assert.rejects(
    tapTestIdReliable(d, 'Enter', async () => false, { timeout: 700, settleMs: 10 }),
    (err) => /element testID=Enter not found in 700ms/.test(err.message),
  );
});
