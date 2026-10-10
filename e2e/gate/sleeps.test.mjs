import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, onBattery, parseSleeps, sleepsDuring } from './sleeps.mjs';

// `pmset -g log` around auto-run 1009-1608's kk leg (lines as the Mac wrote them, local time +0200).
const LOG = [
  "2026-10-09 18:14:17 +0200 Notification        \tDisplay is turned off                                                      \t          ",
  "2026-10-09 18:14:22 +0200 Sleep               \tEntering Sleep state due to 'Clamshell Sleep':TCPKeepAlive=active Using Batt (Charge:100%) 682 secs",
  "2026-10-09 18:14:24 +0200 PM Client Acks      \tDelays to Sleep notifications: [com.apple.bluetooth.sleep is slow(1543 ms)]",
  "2026-10-09 18:25:44 +0200 DarkWake            \tDarkWake from Deep Idle [CDNP] : due to smc.sysState.Wake(0x70070000) wifibt SMC.OutboxNotEmpty/ Using BATT (Charge:100%) 45 secs",
  "2026-10-09 18:26:29 +0200 Sleep               \tEntering Sleep state due to 'Maintenance Sleep':TCPKeepAlive=active Using Batt (Charge:100%) 80 secs",
  "2026-10-09 18:11:32 +0200 Assertions          \tPID 5482(caffeinate) Summary PreventUserIdleSystemSleep \"caffeinate command-line tool\" 16:05:58",
].join('\n');

// The kk leg of 1009-1608 (legs.tsv): 16:08:36Z → 16:25:59Z.
const KK = { from: 1791562116, to: 1791563159 };

test('reads the Sleep lines only, in UTC, with their length', () => {
  const s = parseSleeps(LOG);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { start: Date.parse('2026-10-09T16:14:22Z') / 1000, end: Date.parse('2026-10-09T16:25:44Z') / 1000, secs: 682, cause: 'Clamshell Sleep' });
  assert.equal(s[1].cause, 'Maintenance Sleep');
  assert.equal(s[1].secs, 80);
});

test("the kk leg of 1009-1608 overlaps the clamshell sleep, not the later maintenance one", () => {
  const hits = sleepsDuring(parseSleeps(LOG), KK.from, KK.to);
  assert.equal(hits.length, 1);
  assert.equal(describe(hits[0]), 'Mac slept 16:14:22Z–16:25:44Z (682 s, Clamshell Sleep)');
});

test('a leg wholly before or after a sleep does not overlap it', () => {
  const s = parseSleeps(LOG);
  assert.equal(sleepsDuring(s, KK.from, Date.parse('2026-10-09T16:14:22Z') / 1000).length, 0);
  assert.equal(sleepsDuring(s, Date.parse('2026-10-09T16:27:50Z') / 1000, Date.parse('2026-10-09T17:00:00Z') / 1000).length, 0);
});

test('a leg that starts during a sleep overlaps it', () => {
  const hits = sleepsDuring(parseSleeps(LOG), Date.parse('2026-10-09T16:20:00Z') / 1000, Date.parse('2026-10-09T16:40:00Z') / 1000);
  assert.deepEqual(hits.map((h) => h.cause), ['Clamshell Sleep', 'Maintenance Sleep']);
});

test('other timezones and no sleeps at all', () => {
  assert.equal(parseSleeps("2026-03-01 09:00:00 -0500 Sleep  \tEntering Sleep state due to 'Idle Sleep':TCPKeepAlive=active Using AC 10 secs")[0].start, Date.parse('2026-03-01T14:00:00Z') / 1000);
  assert.deepEqual(parseSleeps('nothing here\n'), []);
});

test('battery or AC from pmset -g batt', () => {
  assert.equal(onBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=22937699)\t95%; discharging; 8:16 remaining present: true"), true);
  assert.equal(onBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=22937699)\t100%; charged; 0:00 remaining present: true"), false);
  assert.equal(onBattery(''), false);
});
