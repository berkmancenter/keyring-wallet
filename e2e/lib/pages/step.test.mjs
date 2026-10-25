// node --test e2e/lib/pages/step.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { fakeClock, fakeDriver } from "./testing/fakeDriver.mjs";
import { StepError, awaitScreen, idsWithPrefix, rowText, runStep, said, whichShowing } from "./step.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "e2e-pages-step-"));
process.env.E2E_RUN_DIR = tmp;
const MARKERS = ["AgentSwitching", "AgentIntro", "AgentHome", "VettingApplicantStep_"];

const quiet = () => {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  return { lines, restore: () => (console.log = orig) };
};

test("runStep: a step that returns writes its record, says the screen it ended on, and logs one line", async () => {
  const d = fakeDriver({ screen: { AgentHome: {}, AgentHomeName: { text: "Alpha" } } });
  const log = path.join(tmp, "steps.jsonl");
  const out = quiet();
  try {
    const record = await runStep(d, "agents", "open", { log }, MARKERS, async () => ({ value: { name: "Alpha" }, observed: { extra: 1 } }));
    assert.equal(record.ok, true);
    assert.equal(record.role, "agents");
    assert.equal(record.step, "open");
    assert.deepEqual(record.observed, { screen: "AgentHome", extra: 1 });
    assert.deepEqual(record.value, { name: "Alpha" });
    assert.equal(JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()).step, "open");
    assert.equal(out.lines.at(-1), '[step] agents.open ok — {"name":"Alpha"}');
  } finally {
    out.restore();
  }
});

test("runStep: a throw becomes a StepError carrying the screenshot, the source and what the error observed", async () => {
  const d = fakeDriver({ screen: { AgentSwitching: {}, AgentHome: {} } });
  const out = quiet();
  try {
    await assert.rejects(
      runStep(d, "agents", "switchTo", {}, MARKERS, async () => {
        throw Object.assign(new Error("the switch did not take"), { observed: { home: "Alpha" } });
      }),
      (err) => {
        assert.ok(err instanceof StepError);
        assert.equal(err.message, "agents.switchTo: the switch did not take");
        assert.equal(err.record.ok, false);
        // AgentSwitching is told apart before AgentHome when both show.
        assert.deepEqual(err.record.observed, { screen: "AgentSwitching", home: "Alpha" });
        assert.match(err.record.screenshot, /step-agents-switchTo-android-\d+\.png$/);
        assert.match(err.record.source, /step-agents-switchTo-android-\d+\.xml$/);
        return true;
      }
    );
    assert.equal(d.shots.length, 1);
    assert.equal(out.lines.at(-1), "[step] agents.switchTo FAILED — the switch did not take");
  } finally {
    out.restore();
  }
});

test("whichShowing: the first marker in order; a stem marker matches any id built on it; none is null", async () => {
  const d = fakeDriver({ screen: { AgentHome: {}, AgentIntro: {} } });
  assert.equal(await whichShowing(d, MARKERS), "AgentIntro");
  d.set({ VettingApplicantStep_ticket: {} });
  assert.equal(await whichShowing(d, MARKERS), "VettingApplicantStep_");
  d.set({ JoinAsks: {} });
  // "JoinAsk" is not "JoinAsks": the closing quote is part of the match.
  assert.equal(await whichShowing(d, ["JoinAsk"]), null);
});

test("awaitScreen: waits on the clock until the screen comes, and names the one reached", async () => {
  const clock = fakeClock();
  const d = fakeDriver({ screen: { AgentSwitching: {} }, clock });
  clock.schedule(20000, () => d.set({ AgentHome: {} }));
  const got = await awaitScreen(d, "AgentHome", { page: "agents", markers: MARKERS, timeoutMs: 60000, clock });
  assert.equal(got, "AgentHome");
  assert.equal(clock.at(), 20000);
});

test('awaitScreen: on the deadline, "stuck at <screen> for N s" is the finding, not "timeout"', async () => {
  const clock = fakeClock();
  const d = fakeDriver({ screen: { AgentSwitching: {} }, clock });
  await assert.rejects(awaitScreen(d, "AgentHome", { page: "agents", markers: MARKERS, timeoutMs: 30000, clock }), (err) => {
    assert.equal(err.message, 'stuck at "AgentSwitching" for 30 s, waiting for AgentHome');
    assert.equal(err.observed.secondsOnScreen, 30);
    assert.equal(err.observed.lastSeen, "AgentSwitching");
    return true;
  });
});

test("awaitScreen: no marker at all says so, with the last one seen; no deadline is refused", async () => {
  const clock = fakeClock();
  const d = fakeDriver({ screen: { AgentIntro: {} }, clock });
  clock.schedule(5000, () => d.set({ EnterPIN: {} }));
  await assert.rejects(awaitScreen(d, "AgentHome", { page: "agents", markers: MARKERS, timeoutMs: 10000, clock }), /no agents screen is showing \(last seen: AgentIntro; waiting for AgentHome\)/);
  await assert.rejects(awaitScreen(d, "AgentHome", { page: "agents", markers: MARKERS, clock }), /no deadline/);
});

test("idsWithPrefix, rowText, said: the switcher's rows, a row's own words or its children's or its sibling's", async () => {
  const d = fakeDriver({
    screen: {
      AgentSwitcherRow_0: { desc: "Alpha, Current" },
      AgentSwitcherRow_1: { desc: "Bravo, your agent" },
      AgentCommunityStatus_k: { children: ["You asked to join.", "Waiting"] },
      JoinAgentSuggested: { sibling: "Join with Alpha" },
      AgentHomeName: { text: "  Alpha\n Agent " },
    },
  });
  assert.deepEqual(await idsWithPrefix(d, "AgentSwitcherRow_"), ["AgentSwitcherRow_0", "AgentSwitcherRow_1"]);
  assert.equal(await rowText(d, "AgentCommunityStatus_k"), "You asked to join. Waiting");
  assert.equal(await rowText(d, "JoinAgentSuggested"), "Join with Alpha");
  assert.equal(await rowText(d, "Nowhere"), null);
  assert.equal(await said(d, "AgentHomeName"), "Alpha Agent");
  assert.equal(await said(d, "Nowhere"), null);
});
