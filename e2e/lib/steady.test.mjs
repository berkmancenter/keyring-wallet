// node --test e2e/lib/steady.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { dismissTourIfUp, expectChanged, findScrolling, waitStable } from "./steady.js";

/** A clock that moves only when the code waits, and a screen scripted by time. */
function fakeTime() {
  let t = 0;
  return { now: () => t, wait: async (ms) => void (t += ms), at: () => t };
}
/** A target as a function: what is on screen is decided by `isHere(t)`. */
const shown = (clock, isHere, name) =>
  Object.defineProperty(() => ({ isExisting: async () => isHere(clock.at()) }), "name", { value: name });

test("waitStable: an empty state that flashes first is waited out, and reported (the Wallet's R7)", async () => {
  const c = fakeTime();
  const card = shown(c, () => true, "card");
  const empty = shown(c, (t) => t < 600, "EmptyList");
  const { absentSeen } = await waitStable({}, card, { absent: [empty], holdMs: 1000, pollMs: 200, now: c.now, wait: c.wait });
  assert.deepEqual(absentSeen, ["EmptyList"]);
  assert.ok(c.at() >= 1600, `returned at ${c.at()} ms, before the card had held 1 s past the flash`);
});

test("waitStable: a target that drops out restarts the hold", async () => {
  const c = fakeTime();
  const card = shown(c, (t) => t < 400 || t >= 800, "card");
  await waitStable({}, card, { holdMs: 1000, pollMs: 200, now: c.now, wait: c.wait });
  assert.ok(c.at() >= 1800);
});

test("waitStable: never steady within the timeout throws, saying what was showing", async () => {
  const c = fakeTime();
  const card = shown(c, () => true, "card");
  const sheet = shown(c, () => true, "AddCredentialSlider");
  await assert.rejects(
    waitStable({}, card, { absent: [sheet], timeout: 2000, now: c.now, wait: c.wait }),
    /card did not hold for 1000 ms within 2000 ms \(last: present, with AddCredentialSlider showing\)/
  );
});

test("findScrolling: up first; down only when up does not find it", async () => {
  const tried = [];
  const scroll = async (_d, key, _n, { direction, both }) => {
    tried.push(`${direction}${both ? "+both" : ""}`);
    if (direction === "down") return `el:${key}`;
    throw new Error("not displayed");
  };
  assert.equal(await findScrolling({}, "AgentDevice_x", { scroll }), "el:AgentDevice_x");
  assert.deepEqual(tried, ["up", "down"]);
});

test("findScrolling: found scrolling up never scrolls down (the row above the fold)", async () => {
  const tried = [];
  const scroll = async (_d, key, _n, { direction }) => (tried.push(direction), `el:${key}`);
  await findScrolling({}, "AgentDevice_x", { scroll });
  assert.deepEqual(tried, ["up"]);
});

test("findScrolling: found neither way names both directions", async () => {
  const scroll = async () => {
    throw new Error("not displayed");
  };
  await assert.rejects(findScrolling({}, "K", { swipes: 3, scroll }), /testID=K not found scrolling up 3 and down 3/);
});

test("expectChanged: an old value still on screen is not the result (the eight-hour-old ticket)", async () => {
  const c = fakeTime();
  let code = "SG58-91EE";
  const { before, after } = await expectChanged(
    async () => code,
    async () => {
      setTimeout(() => (code = "K2Q7-0B1D"), 0);
    },
    { pollMs: 100, now: c.now, wait: async (ms) => (await c.wait(ms), new Promise((r) => setImmediate(r))) }
  );
  assert.equal(before, "SG58-91EE");
  assert.equal(after, "K2Q7-0B1D");
});

test("expectChanged: nothing changes, it says unchanged and what it stayed at", async () => {
  const c = fakeTime();
  await assert.rejects(
    expectChanged(async () => "SG58-91EE", async () => undefined, { timeout: 1000, now: c.now, wait: c.wait }),
    /unchanged after the action \(still "SG58-91EE"\)/
  );
});

test("expectChanged: compares structure, so an equal list read twice is unchanged", async () => {
  const c = fakeTime();
  await assert.rejects(
    expectChanged(async () => ["a", "b"], async () => undefined, { timeout: 500, now: c.now, wait: c.wait }),
    /unchanged/
  );
});

/** A tour with these steps: each tap on what shows moves to the next; empty when done. */
function tour(steps) {
  const shown = [...steps];
  const taps = [];
  return {
    taps,
    opts: {
      present: async (_d, id) => shown[0] === id,
      tap: async (_d, id) => (taps.push(id), shown.shift()),
      wait: async () => undefined,
      log: () => undefined,
    },
  };
}

test("dismissTourIfUp: a several-step tour is closed step by step, ✕ first, then Next/Done", async () => {
  const t = tour(["Next", "Next", "Close"]);
  assert.equal(await dismissTourIfUp({}, t.opts), 3);
  assert.deepEqual(t.taps, ["Next", "Next", "Close"]);
});

test("dismissTourIfUp: no tour, no taps", async () => {
  const t = tour([]);
  assert.equal(await dismissTourIfUp({}, t.opts), 0);
  assert.deepEqual(t.taps, []);
});

test("dismissTourIfUp: a tour that will not go stops after max taps", async () => {
  const taps = [];
  const closed = await dismissTourIfUp(
    {},
    { max: 5, present: async (_d, id) => id === "Close", tap: async (_d, id) => taps.push(id), wait: async () => undefined, log: () => undefined }
  );
  assert.equal(closed, 5);
  assert.equal(taps.length, 5);
});

test("dismissTourIfUp: a tour that appears a moment after the tab is still caught", async () => {
  let t = 0;
  const taps = [];
  const closed = await dismissTourIfUp(
    {},
    {
      appearMs: 1500,
      present: async (_d, id) => id === "Close" && t >= 600 && taps.length === 0,
      tap: async (_d, id) => taps.push(id),
      wait: async (ms) => void (t += ms),
      log: () => undefined,
    }
  );
  assert.equal(closed, 1);
});
