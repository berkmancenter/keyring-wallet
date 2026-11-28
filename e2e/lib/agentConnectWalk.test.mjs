import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BASE_MANIFEST, EXTRAS, NEEDS, REACH, ROUTES, expandRoute, pairsFile, planWalk, readManifests } from "./agentConnectWalk.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("reads every manifest, the base first by name", () => {
  const files = { "agent-connect-screens.zz.json": { states: [] }, [BASE_MANIFEST]: { states: [] }, "agent-connect-screens.aa.json": { states: [] } };
  const got = readManifests("x", (f) => JSON.stringify(files[f]), () => [...Object.keys(files), "other.json"]);
  assert.deepEqual(got.map((m) => m.file), [BASE_MANIFEST, "agent-connect-screens.aa.json", "agent-connect-screens.zz.json"]);
});

test("the real manifests: every state is planned, walked or not reached with a reason, and the table names no stale state", () => {
  const plan = planWalk(readManifests(here));
  const ids = readManifests(here).flatMap((m) => m.states.map((s) => s.id));
  for (const id of ids) {
    const p = plan.find((x) => x.id === id);
    assert.ok(p, id);
    assert.ok(p.status === "walk" ? p.steps.length > 0 : p.reason.length > 0, id);
  }
  // A walked state always ends on its marker's screen: its route waits for something before the manifest's steps.
  for (const p of plan.filter((x) => x.status === "walk")) assert.ok(p.steps.some((s) => "wait" in s), p.id);
});

test("a manifest state the table does not name is listed as 'no route written', never dropped", () => {
  const plan = planWalk([{ file: BASE_MANIFEST, states: [{ id: "new-state", marker: "X" }] }], {}, []);
  assert.deepEqual(
    plan.map((p) => [p.id, p.status, p.reason]),
    [["new-state", "notReached", "no route written for this state yet"]]
  );
});

test("// control: a table naming a state no manifest has is refused", () => {
  assert.throws(() => planWalk([{ file: BASE_MANIFEST, states: [] }], { gone: { route: "aiAgents" } }, []), /gone/);
});

test("a route expands its sub-routes, the manifest's steps come after it, and a cycle is refused", () => {
  const plan = planWalk(
    [{ file: BASE_MANIFEST, states: [{ id: "s", marker: "M", steps: [{ press: "Y" }] }] }],
    { s: { route: "b" } },
    [],
    { a: [{ wait: "A" }], b: [{ route: "a" }, { tap: "B" }] }
  );
  assert.deepEqual(plan[0].steps, [{ wait: "A" }, { tap: "B" }, { press: "Y" }]);
  assert.throws(() => expandRoute("x", { x: [{ route: "y" }], y: [{ route: "x" }] }), /cycle/);
});

test("every need named in the table is described, and every route the table or the extras use exists", () => {
  for (const [id, r] of Object.entries(REACH)) {
    if (r.needs) assert.ok(NEEDS[r.needs], id);
    else assert.ok(ROUTES[r.route], id);
  }
  for (const e of EXTRAS) assert.ok(ROUTES[e.route], e.id);
});

test("the pairs file has one row per planned state, walked, stopped or not reached", () => {
  const plan = [
    { id: "a", frame: "02-main.png", status: "walk", steps: [] },
    { id: "b", frame: null, status: "notReached", reason: "a connected agent" },
    { id: "c", frame: "04-scan.png", status: "walk", steps: [] },
  ];
  const text = pairsFile(plan, [{ id: "a", outcome: "reached", screenshot: "a.png" }], {
    platform: "android",
    appCommit: "abc",
    planCommit: "def",
    date: "2026-11-28",
  });
  const rows = text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| State"));
  assert.deepEqual(rows, [
    "| a | 02-main.png | a.png | reached |",
    "| b | (no frame) |  | not reached: a connected agent |",
    "| c | 04-scan.png |  | walk stopped before it |",
  ]);
});
