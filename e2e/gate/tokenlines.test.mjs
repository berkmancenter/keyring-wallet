import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pidOf, startedPids, tokenLines } from './tokenlines.mjs';

const BID = 'asml.bkc.harvard.wallet';
// Lines cut from the dry run 1011-0020's android-logcat-all.txt (logcat -v time): Keyring started as 3480, then
// relaunched as 4685 and 5704; the emulator's Google Messages (pid 2272) logged Firebase StrictMode frames.
const LOG = readFileSync(new URL('./fixtures/tokenlines/logcat-1011-0020.txt', import.meta.url), 'utf8');

test("Keyring's pids are every Start proc of its bundle id, relaunches included", () => {
  assert.deepEqual([...startedPids(LOG, BID)], ['3480', '4685', '5704']);
});

test("another app's Firebase lines do not count (1011-0020: Google Messages, pid 2272)", () => {
  const all = LOG.split('\n').filter((l) => /FirebaseInstallations|FirebaseInstanceId/.test(l));
  assert.equal(all.length, 3); // what the old whole-logcat grep counted
  assert.deepEqual(tokenLines(LOG, startedPids(LOG, BID)), []);
});

test("a Keyring token line still fails the row, in any of its pids", () => {
  // Synthetic: no Keyring line like these exists in the run; they stand for what the row must still catch.
  const own = [
    '10-11 02:22:30.100 D/FirebaseMessaging( 4685): Fetching registration token',
    '10-11 02:31:40.200 I/FirebaseInstallations( 5704): Firebase Installation created',
  ];
  const hits = tokenLines(`${LOG}\n${own.join('\n')}\n`, startedPids(LOG, BID));
  assert.deepEqual(hits, own);
});

test('a pid the leg sampled counts too (a process started before the capture)', () => {
  const line = '10-11 02:21:20.000 D/FirebaseMessaging( 1234): token';
  assert.deepEqual(tokenLines(line, new Set(['1234'])), [line]);
  assert.deepEqual(tokenLines(line, new Set(['3480'])), []);
});

test('both logcat formats give the pid', () => {
  assert.equal(pidOf('10-11 02:21:19.008 D/StrictMode( 2272): \tat com.google.firebase'), '2272');
  assert.equal(pidOf('10-11 02:21:19.008  3480  3501 D FirebaseMessaging: token'), '3480');
  assert.equal(pidOf('--------- beginning of main'), undefined);
});

test("Play services' PACKAGE_ADDED line is still ignored", () => {
  const line = '10-11 02:21:20.000 W/GCM     ( 3480): Unexpected forwarded intent: Intent { act=android.intent.action.PACKAGE_ADDED }';
  assert.deepEqual(tokenLines(line, new Set(['3480'])), []);
});
