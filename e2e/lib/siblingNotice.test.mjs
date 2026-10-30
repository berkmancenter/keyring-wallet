import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearSiblingNoticeIfUp } from './driver.js';
import { fakeDriver } from './pages/testing/fakeDriver.mjs';

// clearSiblingNoticeIfUp(driver): the "also open as you" notice is dismissed with OK, as a person would. Since
// bifold #845 it is a strip under the header whose OK shows only once its line (SiblingNotice) is tapped open.

test('the strip, closed: opens it, then taps OK', async () => {
  const d = fakeDriver({ platform: 'ios', screen: { SiblingNotice: {} } });
  d.onTap.SiblingNotice = () => d.show('SiblingNoticeDismiss');
  d.onTap.SiblingNoticeDismiss = () => d.hide('SiblingNotice', 'SiblingNoticeDismiss');
  assert.equal(await clearSiblingNoticeIfUp(d), true);
  assert.deepEqual(d.taps, ['SiblingNotice', 'SiblingNoticeDismiss']);
  assert.equal(d.has('SiblingNotice'), false);
});

test('the strip already open, or the old card: OK at once', async () => {
  const d = fakeDriver({ platform: 'ios', screen: { SiblingNotice: {}, SiblingNoticeDismiss: {} } });
  assert.equal(await clearSiblingNoticeIfUp(d), true);
  assert.deepEqual(d.taps, ['SiblingNoticeDismiss']);
});

test('nothing on screen: no tap (control)', async () => {
  const d = fakeDriver({ platform: 'ios', screen: { Home: {} } });
  assert.equal(await clearSiblingNoticeIfUp(d), false);
  assert.deepEqual(d.taps, []);
});

test('a strip that does not open: no OK to tap, so it says it cleared nothing', async () => {
  const d = fakeDriver({ platform: 'ios', screen: { SiblingNotice: {} } });
  assert.equal(await clearSiblingNoticeIfUp(d), false);
  assert.deepEqual(d.taps, ['SiblingNotice']);
});
