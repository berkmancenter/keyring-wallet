// node --test e2e/lib/clocks.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { REAL_CLOCKS, clocksSaid, linkWaitTiming, parseClocks } from "./clocks.js";

const screen = (over = {}) => ({ mode: "real", grantWindowS: "600", phoneGrantWindowS: "600", autoLockMin: "5", ...over });

test("parseClocks: the real clocks as the Developer screen shows them", () => {
  const c = parseClocks(screen());
  assert.equal(c.mode, "real");
  assert.equal(c.grantWindowS, 600);
  assert.equal(c.phoneGrantWindowS, 600);
  assert.equal(c.autoLockS, 300);
});

test("parseClocks: a short-clock test build (bifold #411), and a half-minute lock", () => {
  assert.deepEqual(
    (({ mode, grantWindowS, phoneGrantWindowS, autoLockS }) => ({ mode, grantWindowS, phoneGrantWindowS, autoLockS }))(
      parseClocks(screen({ mode: "short", grantWindowS: "60", phoneGrantWindowS: "60", autoLockMin: "0.5" }))
    ),
    { mode: "short", grantWindowS: 60, phoneGrantWindowS: 60, autoLockS: 30 }
  );
});

test("parseClocks: anything unreadable is the driver's failure, never a guess", () => {
  for (const bad of [
    { mode: "" },
    { mode: "SHORT" },
    { grantWindowS: "" },
    { grantWindowS: "ten" },
    { phoneGrantWindowS: undefined },
    { autoLockMin: "-1" },
  ]) {
    assert.throws(() => parseClocks(screen(bad)), /^Error: driver: /, JSON.stringify(bad));
  }
});

test('parseClocks: "real" with windows that are not 600 s is refused', () => {
  assert.throws(() => parseClocks(screen({ grantWindowS: "60" })), /driver: clocks "real" but the grant windows read 60/);
});

test("linkWaitTiming: the real clocks give exactly the waits the cases always used", () => {
  const t = linkWaitTiming(REAL_CLOCKS);
  assert.equal(t.noLock.idleMs, 400_000);
  assert.equal(t.noLock.readBeforeS, 590);
  assert.equal(t.noAnswer.windowS, 600);
  assert.equal(t.noAnswer.lookUntilMs, 720_000);
  assert.equal(t.noAnswer.tooSoonS, 590);
  assert.ok(t.noAnswer.touchEveryMs >= 100_000 && t.noAnswer.touchEveryMs < 300_000, "a touch well inside the 5-min lock");
  assert.equal(t.noAnswer.stepMs, 20_000);
  assert.equal(t.paused.shortAwayMs, 180_000);
  assert.equal(t.paused.longAwayMs, 900_000);
});

test("linkWaitTiming: a 60 s window with a 30 s lock reads the no-lock wait before 50 s, past the lock", () => {
  const t = linkWaitTiming(parseClocks(screen({ mode: "short", grantWindowS: "60", phoneGrantWindowS: "60", autoLockMin: "0.5" })));
  assert.equal(t.noLock.readBeforeS, 50);
  assert.ok(t.noLock.idleMs > 30_000 && t.noLock.idleMs < 50_000, `idle ${t.noLock.idleMs} ms: past the lock, before the read limit`);
  assert.equal(t.noAnswer.lookUntilMs, 180_000);
  assert.equal(t.noAnswer.tooSoonS, 50);
  assert.ok(t.noAnswer.touchEveryMs < 30_000, "touched inside the lock");
  assert.ok(t.noAnswer.stepMs <= t.noAnswer.touchEveryMs / 2);
  assert.ok(t.paused.shortAwayMs < 30_000, "away under the lock");
  assert.ok(t.paused.longAwayMs > 60_000 && t.paused.longAwayMs > 30_000, "away past the window and the lock");
});

test("linkWaitTiming: every wait holds its rules over a range of clocks", () => {
  for (const [windowS, lockS] of [[600, 300], [60, 30], [120, 60], [300, 60], [60, 20]]) {
    const t = linkWaitTiming({ ...REAL_CLOCKS, mode: "short", grantWindowS: windowS, phoneGrantWindowS: windowS, autoLockS: lockS });
    const at = `window ${windowS} s, lock ${lockS} s`;
    assert.ok(t.noLock.idleMs / 1000 > lockS, `${at}: idle past the lock`);
    assert.ok(t.noLock.idleMs / 1000 < t.noLock.readBeforeS, `${at}: read inside the window`);
    assert.ok(t.noAnswer.lookUntilMs / 1000 > windowS + 6, `${at}: looks past the window's last check`);
    assert.ok(t.noAnswer.touchEveryMs / 1000 < lockS, `${at}: touched inside the lock`);
    assert.ok(t.paused.shortAwayMs / 1000 < lockS, `${at}: the short absence stays under the lock`);
    assert.ok(t.paused.longAwayMs / 1000 > Math.max(windowS, lockS), `${at}: the long absence outlasts both`);
  }
});

test("linkWaitTiming: a lock as long as the window leaves the hold nothing to show: refused, not mistimed", () => {
  const equal = { ...REAL_CLOCKS, mode: "short", grantWindowS: 60, phoneGrantWindowS: 60, autoLockS: 60 };
  assert.throws(() => linkWaitTiming(equal), /driver: a 60 s lock leaves no time inside a 60 s window/);
});

test("linkWaitTiming: a lock set to Never is refused", () => {
  assert.throws(() => linkWaitTiming({ ...REAL_CLOCKS, autoLockS: 0 }), /driver: the auto-lock reads Never/);
});

test("clocksSaid names the clocks and where they came from", () => {
  assert.equal(clocksSaid(REAL_CLOCKS), "clocks real: window 600 s, lock 300 s (real clocks)");
});
