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

test("credVaultQuery: the filter goes through a file (never stdin), --json, and the descriptors' ids come back", async () => {
  const { credVaultQuery } = await import("./pnm.js");
  const { readFileSync, existsSync } = await import("node:fs");
  const seen = [];
  let file;
  const exec = (cmd, args, opts) => {
    seen.push({ cmd, args, stdio: opts.stdio });
    file = args[args.indexOf("--filter-file") + 1];
    seen.push(JSON.parse(readFileSync(file, "utf8")));
    return '  VTA: farm3-runner-prague\n{\n  "credentials": [ { "id": "urn:uuid:vmc-1", "types": ["VerifiableCredential"], "purpose": "membership" }, { "types": [] } ]\n}\n';
  };
  const got = credVaultQuery({ purpose: "membership" }, { slug: "farm3-runner-prague", locked: "/x/pnm-locked", exec, sleep: () => {}, log: () => {} });
  assert.deepEqual(got.ids, ["urn:uuid:vmc-1"]);
  assert.equal(got.credentials.length, 2);
  assert.equal(seen[0].cmd, "/x/pnm-locked");
  assert.deepEqual(seen[0].args.slice(0, 5), ["--vta", "farm3-runner-prague", "cred-vault", "query", "--filter-file"]);
  assert.equal(seen[0].args.at(-1), "--json");
  assert.notEqual(file, "-");
  assert.equal(seen[0].stdio[0], "ignore");
  assert.deepEqual(seen[1], { purpose: "membership" });
  // The filter file is gone afterwards.
  assert.equal(existsSync(file), false);
});

test("credVaultQuery: by type, a bare array answer, and an empty one", async () => {
  const { credVaultQuery } = await import("./pnm.js");
  const answers = ['[ { "id": "urn:uuid:role-1" } ]\n', '{ "credentials": [] }'];
  let i = 0;
  const opts = { slug: "s", exec: () => answers[i++], sleep: () => {}, log: () => {} };
  assert.deepEqual(credVaultQuery({ type: "AuthorityCredential" }, opts).ids, ["urn:uuid:role-1"]);
  assert.deepEqual(credVaultQuery({ type: "AuthorityCredential" }, opts).ids, []);
});

test("credVaultQuery: a refusal throws with pnm's last line; an empty filter is refused before any call", async () => {
  const { credVaultQuery } = await import("./pnm.js");
  let calls = 0;
  const refused = () => {
    calls++;
    throw Object.assign(new Error("exit 1"), { stdout: "  VTA: s\n", stderr: "✗ Forbidden: VaultRead required\n" });
  };
  assert.throws(() => credVaultQuery({ purpose: "membership" }, { slug: "s", exec: refused, sleep: () => {}, log: () => {} }), /no JSON: ✗ Forbidden: VaultRead required/);
  assert.equal(calls, 1);
  assert.throws(() => credVaultQuery({}, { slug: "s", exec: refused }), /empty filter/);
  assert.equal(calls, 1);
});

// IN-259 (persona-in-own-context, run-several-agents.mjs on B): the persona's context, read with pnm (execFileSync stubbed).
const DIDS_GET = (ctx) => `  VTA: runner\nWebVH DID:\n  DID:             did:webvh:Qm:host:p\n  Context:         ${ctx}\n  Server:          s1\n`;
const CONTEXTS = (...ids) => `  VTA: runner\n${JSON.stringify(ids.map((id) => ({ id, name: id === "kr-personas" ? "Keyring personas" : id.toUpperCase(), did: null })))}\n`;
const ACL = (rows) => `  VTA: runner\n  DID: did:key:zAdmin\n${JSON.stringify(rows)}\n`;
// B today (read-only list, 241): the openvtc TUI fixtures' contexts first, then vta.
const B_NOW = ["openvtc-farm3", "openvtc-farm3/harness-applicant-1", "openvtc-farm3n", "openvtc-farm3n/x", "openvtc-farm3p", "openvtc-farm3p/y", "vta"];
const LINK = { tempDid: "did:key:zTemp", heirs: ["did:key:zPhone"], before: ["did:key:zAdmin", "did:key:zOther"] };
const answering = (answers) => {
  const seen = [];
  let i = 0;
  const exec = (cmd, args) => {
    seen.push(args);
    const a = answers[i++];
    if (a instanceof Error) throw a;
    return a;
  };
  return { seen, opts: { slug: "farm3-runner-openvtc", exec, sleep: () => {}, log: () => {}, spacing: () => {} } };
};
const check = async (ctx, ids, extra = {}) => {
  const { personaContextCheck } = await import("./pnm.js");
  const f = answering([DIDS_GET(ctx), CONTEXTS(...ids), ...(extra.acl ? [extra.acl] : [])]);
  return { got: personaContextCheck("did:webvh:Qm:host:p", { before: new Set(B_NOW), ...extra.with, ...f.opts }), seen: f.seen };
};

test("persona in another app's context (B's contexts[0], openvtc-farm3) fails, naming ids only, read-only and in order", async () => {
  const { got, seen } = await check("openvtc-farm3", B_NOW);
  assert.equal(got.ok, false);
  assert.match(got.detail, /^persona context openvtc-farm3 \(pnm did-mgmt dids get, its Context line\): another app's context \(openvtc-\*\) · the persona is in the agent's first context · agent contexts 7 /);
  assert.doesNotMatch(got.detail, /did:/, "context ids only, never a DID");
  assert.deepEqual(seen.map((a) => a.slice(2)), [["did-mgmt", "dids", "get", "did:webvh:Qm:host:p"], ["contexts", "list", "--json"]]);
});

test("a sub-context of another app's, or any other context there before the run, fails too", async () => {
  let { got } = await check("openvtc-farm3n/x", B_NOW);
  assert.equal(got.ok, false);
  assert.match(got.detail, /another app's context/);
  assert.doesNotMatch(got.detail, /first context/);
  ({ got } = await check("did-git-sign", ["did-git-sign", "vta"], { with: { before: new Set(["did-git-sign", "vta"]) } }));
  assert.equal(got.ok, false);
  assert.match(got.detail, /there before this run and neither vta nor Keyring's: another app's · the persona is in the agent's first context/);
});

test("vta, a Keyring context (by id or by name), and a context made during the run pass", async () => {
  let { got } = await check("vta", B_NOW);
  assert.deepEqual([got.ok, /the agent's default context vta/.test(got.detail)], [true, true]);
  ({ got } = await check("keyring", [...B_NOW, "keyring"]));
  assert.deepEqual([got.ok, /a Keyring context/.test(got.detail)], [true, true]);
  ({ got } = await check("kr-personas", [...B_NOW, "kr-personas"]));
  assert.deepEqual([got.ok, /a Keyring context/.test(got.detail)], [true, true]);
  ({ got } = await check("app-personas", [...B_NOW, "app-personas"]));
  assert.equal(got.ok, true);
  assert.match(got.detail, /made during this run \(not there before; 7 were\), not another app's/);
});

test("an openvtc context made during the run is still another app's; with no snapshot an unknown context fails", async () => {
  let { got } = await check("openvtc-new", [...B_NOW, "openvtc-new"]);
  assert.equal(got.ok, false);
  ({ got } = await check("app-personas", [...B_NOW, "app-personas"], { with: { before: undefined } }));
  assert.equal(got.ok, false);
  assert.match(got.detail, /cannot tell whose it is: the agent's contexts were not read before the run/);
});

test("one context is a SKIP, not a PASS: the bug cannot show there", async () => {
  const { got } = await check("vta", ["vta"]);
  assert.equal(got.ok, undefined);
  assert.match(got.skip, /^single context: the bug cannot show here · persona context vta/);
});

test("the phone's ACL scope is a note only (read with a link), never the verdict", async () => {
  const acl = ACL([{ subject: "did:key:zPhone", role: "admin", scopes: ["ctx:openvtc-farm3"], createdBy: "did:key:zAdmin" }]);
  const { got, seen } = await check("openvtc-farm3", B_NOW, { acl, with: { link: LINK } });
  assert.equal(got.ok, false);
  assert.match(got.detail, / · the phone's ACL scope openvtc-farm3 · agent contexts/);
  assert.deepEqual(seen[2].slice(2), ["acl", "list", "--json"]);
});

test("a pnm without the command is a plain SKIP reason; an unknown DID throws", async () => {
  const { personaContextCheck } = await import("./pnm.js");
  const lacks = Object.assign(new Error("exit 2"), { stdout: "", stderr: "error: unrecognized subcommand 'did-mgmt'\n" });
  let f = answering([lacks]);
  const got = personaContextCheck("did:webvh:x", f.opts);
  assert.match(got.skip, /^pnm cannot read it: this pnm has no `did-mgmt dids get`: error: unrecognized subcommand/);
  assert.equal(f.seen.length, 1);
  f = answering([DIDS_GET("vta"), "error: unexpected argument '--json' found\n"]);
  assert.match(personaContextCheck("did:webvh:x", f.opts).skip, /no `contexts list --json`/);
  const missing = Object.assign(new Error("exit 1"), { stdout: "  VTA: runner\n", stderr: "✗ Not found: DID not found\n" });
  f = answering([missing]);
  assert.throws(() => personaContextCheck("did:webvh:x", f.opts), /no Context line: ✗ Not found/);
});

test("contextSnapshot: B's ids before the run, or undefined (logged) when the read fails", async () => {
  const { contextSnapshot } = await import("./pnm.js");
  let f = answering([CONTEXTS(...B_NOW)]);
  assert.deepEqual([...contextSnapshot(f.opts)], B_NOW);
  const logs = [];
  f = answering([Object.assign(new Error("exit 1"), { stdout: "", stderr: "✗ Forbidden\n" })]);
  assert.equal(contextSnapshot({ ...f.opts, log: (s) => logs.push(s) }), undefined);
  assert.match(logs.join("\n"), /contexts before the run on farm3-runner-openvtc: not read \(pnm printed no JSON: ✗ Forbidden\)/);
});

test("phoneAclRows: this link's keys only — the rotated heir and what the temporary key made, not what was there before", async () => {
  const { phoneAclRows } = await import("./pnm.js");
  const entries = [
    { subject: "did:key:zAdmin", createdBy: "", scopes: [] },
    { subject: "did:key:zPhone", createdBy: "did:key:zAdmin", scopes: ["a"] },
    { subject: "did:key:zChild", createdBy: "did:key:zTemp", scopes: ["b"] },
    { subject: "did:key:zStranger", createdBy: "did:key:zAdmin", scopes: ["c"] },
  ];
  assert.deepEqual(phoneAclRows(entries, LINK).map((e) => e.subject), ["did:key:zPhone", "did:key:zChild"]);
  assert.equal(phoneAclRows(entries, undefined), undefined);
});
