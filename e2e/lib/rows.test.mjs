// node --test e2e/lib/rows.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_BROKEN, EXIT_PASS, EXIT_ROW_FAILED, createRows, selectedRows, withNeeds } from "./rows.js";

const leg = (opts = {}) => {
  const lines = [];
  const captured = [];
  let t = 0;
  const rows = createRows({
    label: "approvals",
    log: (s) => lines.push(s),
    now: () => (t += 1000),
    only: undefined,
    capture: async (_d, label) => captured.push(label),
    ...opts,
  });
  return { rows, lines, captured };
};

test("a pass, a fail and a throw: each a ROW line, and the rows after a failure still run", async () => {
  const { rows, lines } = leg();
  await rows.row("switch on", async () => ({ ok: true, detail: "switch true" }));
  await rows.row("test request held", async () => false);
  await rows.row("decline clears it", async () => {
    throw new Error("element testID=DenyConsentButton not found\n  at …");
  });
  await rows.row("switch off", async () => undefined);
  assert.deepEqual(lines, [
    "ROW switch on PASS — switch true",
    "ROW test request held FAIL — failed",
    "ROW decline clears it FAIL — threw: element testID=DenyConsentButton not found",
    "ROW switch off PASS — ok",
  ]);
  assert.equal(rows.exitCode(), EXIT_ROW_FAILED);
});

test("all passing or skipped as asked: exit 0", async () => {
  const { rows } = leg();
  await rows.row("a", async () => true);
  rows.skip("b", "not on iOS");
  assert.equal(rows.exitCode(), EXIT_PASS);
});

test("a row needing a failed row is skipped, saying which and why (R7 → R5/R4)", async () => {
  const { rows, lines } = leg();
  let ran = false;
  await rows.row("R7 card opens", async () => {
    throw new Error("Add credentials sheet in the way");
  });
  await rows.row("R5 card names its agent", async () => (ran = true), { needs: ["R7 card opens"] });
  await rows.row("R4 needs a row that never ran", async () => true, { needs: ["R9 nowhere"] });
  assert.equal(ran, false);
  assert.equal(lines[1], 'ROW R5 card names its agent SKIP — needs "R7 card opens", which was FAIL');
  assert.equal(lines[2], 'ROW R4 needs a row that never ran SKIP — needs "R9 nowhere", which did not run');
  // The skip is not a second failure: one FAIL, exit 3.
  assert.equal(rows.exitCode(), EXIT_ROW_FAILED);
});

test("E2E_ONLY_ROWS: only the named rows run; the rest say not selected; a listed need still runs", async () => {
  const { rows, lines } = leg({ only: selectedRows({ E2E_ONLY_ROWS: "link, approve" }) });
  const ran = [];
  await rows.row("link", async () => ran.push("link"));
  await rows.row("rename", async () => ran.push("rename"));
  await rows.row("approve", async () => ran.push("approve"), { needs: ["link"] });
  assert.deepEqual(ran, ["link", "approve"]);
  assert.equal(lines[1], "ROW rename SKIP — not selected");
  assert.equal(rows.exitCode(), EXIT_PASS);
});

test("the needs map: a dependent SKIPs when its need failed, with no needs option on the row", async () => {
  const { rows, lines } = leg({ needs: { "R1 switch to B": ["R1 add + keep"] } });
  await rows.row("R1 add + keep", async () => false);
  let ran = false;
  await rows.row("R1 switch to B", async () => (ran = true));
  assert.equal(ran, false);
  assert.equal(lines[1], 'ROW R1 switch to B SKIP — needs "R1 add + keep", which was FAIL');
});

test("--only-failed names the dependent alone: its need runs first (it passed last time, so it was not listed), then the dependent", async () => {
  // The rerun's E2E_ONLY_ROWS holds the FAILed row only; the need it has PASSed and is not named.
  const { rows, lines } = leg({ only: selectedRows({ E2E_ONLY_ROWS: "R1 switch to B" }), needs: { "R1 switch to B": ["R1 add + keep"] } });
  const ran = [];
  await rows.row("add-done-lands", async () => ran.push("add-done-lands"));
  await rows.row("R1 add + keep", async () => ran.push("R1 add + keep"));
  await rows.row("R1 switch to B", async () => ran.push("R1 switch to B"));
  assert.deepEqual(ran, ["R1 add + keep", "R1 switch to B"]);
  assert.deepEqual(lines, ["ROW add-done-lands SKIP — not selected", "ROW R1 add + keep PASS — ok", "ROW R1 switch to B PASS — ok"]);
  assert.equal(rows.exitCode(), EXIT_PASS);
});

test("the needs run all the way up: the last of a chain selects the whole chain", async () => {
  const needs = { "chain-second": ["chain-first"], "chain-third": ["chain-second"] };
  const { rows } = leg({ only: selectedRows({ E2E_ONLY_ROWS: "chain-third" }), needs });
  const ran = [];
  await rows.row("chain-first", async () => ran.push("chain-first"));
  await rows.row("chain-second", async () => ran.push("chain-second"));
  await rows.row("chain-third", async () => ran.push("chain-third"));
  assert.deepEqual(ran, ["chain-first", "chain-second", "chain-third"]);
  assert.deepEqual([...withNeeds(new Set(["chain-third"]), needs)], ["chain-third", "chain-second", "chain-first"]);
});

test("withNeeds: a need that is not a row of its own, and a cycle, both end", () => {
  assert.deepEqual([...withNeeds(new Set(["b"]), { b: ["a"], a: ["b"] })], ["b", "a"]);
  assert.deepEqual([...withNeeds(new Set(["x"]), {})], ["x"]);
});

test("selectedRows: unset or blank selects everything", () => {
  assert.equal(selectedRows({}), undefined);
  assert.equal(selectedRows({ E2E_ONLY_ROWS: "  " }), undefined);
  assert.deepEqual([...selectedRows({ E2E_ONLY_ROWS: "a,b ,,c" })], ["a", "b", "c"]);
});

test("a failing row with a driver takes its screenshot and page source; a passing one does not", async () => {
  const { rows, captured } = leg({ driver: { e2ePlatform: "android" } });
  await rows.row("passes", async () => true);
  await rows.row("Test request: held?", async () => false);
  assert.deepEqual(captured, ["row-test-request-held"]);
});

test("a capture that fails does not turn into a thrown row", async () => {
  const { rows, lines } = leg({
    driver: {},
    capture: async () => {
      throw new Error("session gone");
    },
  });
  assert.equal(await rows.row("x", async () => false), "FAIL");
  assert.equal(lines[0], "ROW x FAIL — failed");
});

test("fatal: the leg broke outside its rows — BROKEN line, exit 1 even with rows that passed", async () => {
  const { rows, lines } = leg();
  await rows.row("a", async () => true);
  rows.fatal(new Error("no key of this phone on the agent: link it first\nstack…"));
  assert.equal(lines[1], "LEG approvals BROKEN — no key of this phone on the agent: link it first");
  assert.equal(rows.exitCode(), EXIT_BROKEN);
});

test("HEADS and DONE lines in the runner's format", async () => {
  const { rows, lines } = leg();
  rows.heads({ wallet: "18ced16f0000", bifold: "5fb10bc2aaaa", build: "d2a08f28669a77", harness: "abcdef012" });
  await rows.row("a", async () => true);
  await rows.row("b", async () => false);
  rows.skip("c", "not on iOS");
  const out = rows.summary();
  assert.equal(lines[0], "HEADS approvals wallet=18ced16f bifold=5fb10bc2 build=d2a08f28669a harness=abcdef01");
  assert.match(lines.at(-1), /^LEG approvals DONE 3 pass=1 fail=1 skip=1 \d+s$/);
  assert.deepEqual(out, { pass: 1, fail: 1, skip: 1, exit: 3 });
});

test("no label is a mistake in the driver, said at once", () => {
  assert.throws(() => createRows({}), /no label/);
});

test("a `skip` reason (the build lacks the feature) skips the row without running it, saying why", async () => {
  const { rows, lines } = leg();
  let ran = false;
  await rows.row("settings-section-rules", async () => (ran = true), { skip: "build lacks AgentSectionRule" });
  await rows.row("home-sections", async () => true, { skip: undefined });
  assert.equal(ran, false);
  assert.deepEqual(lines, ["ROW settings-section-rules SKIP — build lacks AgentSectionRule", "ROW home-sections PASS — ok"]);
  assert.equal(rows.exitCode(), EXIT_PASS);
});

test("--only-failed: a row runs when the row it needs was left out of the selection (it passed last time)", async () => {
  const { rows, lines } = leg({ only: selectedRows({ E2E_ONLY_ROWS: "test request held" }) });
  await rows.row("switch on (owner check)", async () => true);
  await rows.row("test request held", async () => ({ ok: true, detail: "asking now" }), { needs: ["switch on (owner check)"] });
  assert.deepEqual(lines, ["ROW switch on (owner check) SKIP — not selected", "ROW test request held PASS — asking now"]);
  // A need skipped for any other reason still blocks.
  rows.skip("card", "not on iOS");
  await rows.row("approve", async () => true, { needs: ["card"] });
  assert.equal(lines.at(-1), "ROW approve SKIP — not selected");
});

test("a need skipped on purpose blocks; a need skipped for a build lacking it blocks too", async () => {
  const { rows, lines } = leg();
  rows.skip("card", "not on iOS");
  await rows.row("approve", async () => true, { needs: ["card"] });
  await rows.row("chip-row-fits", async () => true, { skip: "build lacks AgentChips" });
  await rows.row("chip-strip-edges", async () => true, { needs: ["chip-row-fits"] });
  assert.equal(lines[1], 'ROW approve SKIP — needs "card", which was SKIP');
  assert.equal(lines[3], 'ROW chip-strip-edges SKIP — needs "chip-row-fits", which was SKIP');
});

test("outcome: how a row ended, or undefined before it ran", async () => {
  const { rows } = leg();
  assert.equal(rows.outcome("a"), undefined);
  await rows.row("a", async () => true);
  await rows.row("b", async () => false);
  await rows.row("c", async () => true, { needs: ["b"] });
  assert.deepEqual([rows.outcome("a"), rows.outcome("b"), rows.outcome("c")], ["PASS", "FAIL", "SKIP"]);
});

test("HEADS carries caps when given: a count, or buildCaps()'s object", () => {
  const { rows, lines } = leg();
  rows.heads({ wallet: "18ced16f", bifold: "5fb10bc2", build: "d2a08f28669a", harness: "abcdef01", caps: 814 });
  rows.heads({ wallet: "18ced16f", bifold: "5fb10bc2", build: "d2a08f28669a", harness: "abcdef01", caps: { present: 805, total: 852 } });
  assert.equal(lines[0], "HEADS approvals wallet=18ced16f bifold=5fb10bc2 build=d2a08f28669a harness=abcdef01 caps=814");
  assert.equal(lines[1], "HEADS approvals wallet=18ced16f bifold=5fb10bc2 build=d2a08f28669a harness=abcdef01 caps=805");
});
