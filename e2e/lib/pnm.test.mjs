// node --test e2e/lib/pnm.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { RATE_LIMITED, parsePnmJson, pnmCall } from "./pnm.js";

const fakes = (answers) => {
  const calls = [];
  const waits = [];
  const logs = [];
  let i = 0;
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a;
  };
  return { calls, waits, logs, opts: { exec, sleep: (ms) => waits.push(ms), log: (s) => logs.push(s) } };
};
const failed = (stdout, stderr = "") => Object.assign(new Error("exit 1"), { stdout, stderr });

test("goes through the slug's lock, and returns what pnm printed", () => {
  const f = fakes(["{\"rules\": []}\n"]);
  const out = pnmCall(["approvals", "list"], { slug: "farm3-runner-prague", locked: "/x/pnm-locked", ...f.opts });
  assert.equal(out, "{\"rules\": []}\n");
  assert.deepEqual(f.calls, [["/x/pnm-locked", "--vta", "farm3-runner-prague", "approvals", "list"]]);
  assert.deepEqual(f.waits, []);
});

test("a refusal is an answer, not a retry: it comes back whatever the exit status", () => {
  const f = fakes([failed("", "✗ Not found: ACL entry not found\n")]);
  assert.match(pnmCall(["acl", "delete", "did:key:z"], { slug: "s", ...f.opts }), /ACL entry not found/);
  assert.equal(f.calls.length, 1);
});

test("a 429 is retried after 5, 10, 20, 40 s, each logged as RATE-LIMITED (the 236 gate's setup)", () => {
  const limited = failed("", "Refused request: 429 Too Many Requests\n");
  const f = fakes([limited, limited, limited, "ok\n"]);
  assert.equal(pnmCall(["approvals", "require", "x", "--consent"], { slug: "s", ...f.opts }), "ok\n");
  assert.deepEqual(f.waits, [5000, 10000, 20000]);
  assert.equal(f.logs.length, 3);
  assert.match(f.logs[0], /^RATE-LIMITED \d{4}-\d\d-\d\dT[\d:.]+Z pnm approvals require x \(attempt 1\)$/);
});

test("still limited after every retry: the last answer comes back, with no wait after it", () => {
  const f = fakes([failed("", "rate limit exceeded\n")]);
  assert.match(pnmCall(["contexts", "list"], { slug: "s", retries: 2, ...f.opts }), /rate limit/);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.waits, [5000, 10000]);
});

test("json: read from the first brace, past pnm's VTA:/DID: header lines", () => {
  const f = fakes(["  VTA: farm3-runner-prague\n  DID: did:webvh:x\n\n{\n  \"approverSets\": {},\n  \"rules\": []\n}\n"]);
  assert.deepEqual(pnmCall(["approvals", "list"], { slug: "s", json: true, ...f.opts }), { approverSets: {}, rules: [] });
});

test("json with no JSON in the output says what pnm printed instead", () => {
  assert.throws(() => parsePnmJson("  VTA: x\n✗ not authenticated\n"), /no JSON: ✗ not authenticated/);
});

test("no slug is a mistake in the driver, said at once", () => {
  assert.throws(() => pnmCall(["approvals", "list"], {}), /no slug/);
});

test("what counts as rate limited: the proxy's words as well as the agent's", () => {
  for (const said of ["HTTP 429", "Too Many Requests", "rate-limited", "Check the proxy / load balancer's limits"]) {
    assert.ok(RATE_LIMITED.test(said), said);
  }
  assert.ok(!RATE_LIMITED.test("4290 bytes"));
});

test("E2E_PNM_TIMING: one PNM line per attempt with its wall-clock time, off by default", () => {
  const f = fakes(["ok\n"]);
  let t = 1000;
  pnmCall(["approvals", "list", "--json", "x"], { slug: "s", timing: true, now: () => (t += 250), ...f.opts });
  assert.deepEqual(f.logs, ["PNM s approvals list --json 250ms"]);
  const quiet = fakes(["ok\n"]);
  pnmCall(["approvals", "list"], { slug: "s", timing: false, ...quiet.opts });
  assert.deepEqual(quiet.logs, []);
});
