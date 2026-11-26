// The plan's two measured tables, held to the recordings, with no lab running.
//
// agent-connect-plan.md states what the mediator did (section 2.4) and what each VTA version serves (section
// 2.6). Those statements came from the recordings under fixtures/. This file ties the two together: each table
// row is quoted here exactly, the test fails if the plan no longer has that row, and beside it the recordings are
// asserted to hold what the row says. So a changed row, or a re-recording that says something else, fails here
// until a person has looked at both.
//
// What it does not do: read the plan's prose, or the README. Only these rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const planLines = new Set(read("../../docs/plans/agent-connect-plan.md").split("\n"));
const recorded = (name) => JSON.parse(read(`./fixtures/${name}.json`));

const open = recorded("recorded-open").cases;
const mailbox = recorded("recorded-mailbox").cases;
const deny = recorded("recorded-deny").cases;
const VERSIONS = ["0.79.0", "0.84.0", "0.87.0"];
const serves = Object.fromEntries(VERSIONS.map((version) => [version, recorded(`vta-${version}`).serves]));
const cases = Object.fromEntries(VERSIONS.map((version) => [version, recorded(`vta-cases-${version}`).cases]));

// The rows, exactly as the plan has them.
const MEDIATOR_ROWS = {
  "live": "| The recipient is authenticated with live delivery open | HTTP 200 `Forwarded`; the recipient's socket receives the inner message, from the sender | the same | **HTTP 401 \"Missing credentials\"** | HTTP 200, delivered |",
  "offline": "| The recipient has an account and is offline; it connects later | HTTP 200, queued, delivered on connect | the same | HTTP 401 | HTTP 200, delivered on connect |",
  "neverSeen": "| The recipient has never contacted the mediator | **HTTP 403 `e.p.delivery.refused`**, not delivered | the same | HTTP 401 | **HTTP 403 `e.p.delivery.refused`** |",
  "anonymous": "| The outer forward is anoncrypt | HTTP 400 `w.m.message.anonymous`, not delivered | the same | HTTP 401 | HTTP 400 `w.m.message.anonymous` |",
  "peerHere": "| A `did:peer:2` recipient whose service is this mediator's REST URL, or its DID | delivered | delivered | HTTP 401 | delivered |",
  "peerElsewhere": "| The same, but the service names a **different host** | HTTP 200 at send, not delivered in 8 s (the mediator tries the other host) | the same | HTTP 401 | HTTP 200, **delivered here** (`external_forwarding` is off, and the recipient holds an account here) |",
  "queue": "| The recipient is offline, one sender sends repeatedly | 50 accepted; the 51st refused HTTP 503 `e.p.limits.queue.peer` with `Retry-After: 30` | the same | HTTP 401 | 50 accepted; the 51st refused the same way |",
  "selfGrant": "| A new account sends before it switches `SEND_FORWARDED` on, then after | HTTP 200 both times | | | **HTTP 403 `e.p.authorization.send_forwarded`**; the `account/update` answer shows `sendForwarded` on; then HTTP 200, delivered |",
  "denyAll": "| `global_acl_default = DENY_ALL` | a send with a session is refused HTTP 403 `e.p.authorization.send` and one with none HTTP 401; the WebSocket upgrade is refused (close 1006); authentication itself still succeeds | | | |"
};
const VTA_ROWS = {
  "acl": "| `acl/grant`, `acl/revoke`, `acl/update` | 0.2 | 0.3 | 0.3 |",
  "aclList": "| `acl/list` | 0.3 | 0.4 | 0.4 |",
  "memoryWrites": "| `vta/memory/put`, `list`, `delete` | 0.1, 0.2 | 0.1 to 0.3 | 0.1 to 0.3 |",
  "memoryGet": "| `vta/memory/get` | 0.1 | 0.1, 0.2 | 0.1, 0.2 |",
  "contextsDelete": "| `vta/contexts/delete` | 1.1 | 1.2 | 1.2 |",
  "sameOnAll": "| `acl/swap-key` 0.1, `device/register` 0.2, `device/list` 0.3, `device/disable` 0.1, `vta/contexts/create` 1.0, `rooms/keys/present` 0.2, `rooms/keys/act` 0.8 to 0.12, `keys/sign-document` 0.1, `vta/webvh/dids/create` 1.2 | the same on all three | | |",
  "oob": "| `auth/oob/*` | not served by a VTA on any of the three (ledger AC-36) | | |",
  "cases": "| The rung's 14 cases (step 0.1) | none can run | recorded, each repeats | recorded, each repeats, the same as 0.84.0 on every case |"
};

const delivered = { send: { status: 200 }, delivered: true };
const refused = (status, code) => ({ send: code ? { status, code } : { status }, delivered: false });
const noSession = refused(401);
const QUEUE_FULL = { accepted: 50, refusal: { status: 503, code: "e.p.limits.queue.peer", retryAfter: 30 } };

test("every quoted row is a row of the plan today", () => {
  for (const [name, row] of [...Object.entries(MEDIATOR_ROWS), ...Object.entries(VTA_ROWS)]) {
    assert.ok(planLines.has(row), `the plan's row "${name}" changed: read it against the recordings, then quote the new row here`);
  }
});

// ───────────────────────────────────────────────────────────── section 2.4, the mediator

test("2.4, live delivery: 200 and delivered when open or with an account on the mailbox; 401 with no session there", () => {
  assert.deepEqual(open["live/none"], delivered);
  assert.deepEqual(open["live/session"], delivered);
  assert.deepEqual(mailbox["live/none"], noSession);
  assert.deepEqual(mailbox["live/session"], delivered);
});

test("2.4, an offline recipient: queued and delivered on connect, on the same pattern", () => {
  assert.deepEqual(open["offline/none"], delivered);
  assert.deepEqual(open["offline/session"], delivered);
  assert.deepEqual(mailbox["offline/none"], noSession);
  assert.deepEqual(mailbox["offline/session"], delivered);
});

test("2.4, a recipient that never contacted the mediator: 403 e.p.delivery.refused, not delivered", () => {
  const expected = refused(403, "e.p.delivery.refused");
  assert.deepEqual(open["never-seen/none"], expected);
  assert.deepEqual(open["never-seen/session"], expected);
  assert.deepEqual(mailbox["never-seen/none"], noSession);
  assert.deepEqual(mailbox["never-seen/session"], expected);
});

test("2.4, an anoncrypt forward: 400 w.m.message.anonymous", () => {
  const expected = refused(400, "w.m.message.anonymous");
  assert.deepEqual(open["anonymous/none"], expected);
  assert.deepEqual(open["anonymous/session"], expected);
  assert.deepEqual(mailbox["anonymous/none"], noSession);
  assert.deepEqual(mailbox["anonymous/session"], expected);
});

test("2.4, a did:peer whose service is this mediator, by URL or by DID: delivered", () => {
  for (const how of ["peer-here-url", "peer-here-did"]) {
    assert.deepEqual(open[`${how}/none`], { attached: true, ...delivered }, how);
    assert.deepEqual(open[`${how}/session`], { attached: true, ...delivered }, how);
    assert.deepEqual(mailbox[`${how}/none`], { attached: true, ...noSession }, how);
    assert.deepEqual(mailbox[`${how}/session`], { attached: true, ...delivered }, how);
  }
});

test("2.4, a did:peer whose service names another host: accepted and not delivered when open; delivered here on the mailbox", () => {
  const acceptedNotDelivered = { attached: true, send: { status: 200 }, delivered: false };
  assert.deepEqual(open["peer-elsewhere/none"], acceptedNotDelivered);
  assert.deepEqual(open["peer-elsewhere/session"], acceptedNotDelivered);
  assert.deepEqual(mailbox["peer-elsewhere/none"], { attached: true, ...noSession });
  assert.deepEqual(mailbox["peer-elsewhere/session"], { attached: true, ...delivered });
});

test("2.4, the queue: 50 accepted, the 51st refused 503 e.p.limits.queue.peer with Retry-After 30", () => {
  assert.deepEqual(open["queue/none"], QUEUE_FULL);
  assert.deepEqual(open["queue/session"], QUEUE_FULL);
  assert.deepEqual(mailbox["queue/session"], QUEUE_FULL);
  assert.deepEqual(mailbox["queue/none"], { accepted: 0, refusal: { status: 401, retryAfter: "absent" } });
});

test("2.4, the self-grant: 200 both times when open; on the mailbox 403 send_forwarded, the grant, then delivered", () => {
  assert.deepEqual(open["self-grant"], { attached: true, before: delivered, grant: { sendForwarded: true }, after: delivered });
  assert.deepEqual(mailbox["self-grant"], {
    attached: true,
    before: refused(403, "e.p.authorization.send_forwarded"),
    grant: { sendForwarded: true },
    after: delivered,
  });
});

test("2.4, a deny-all default: authentication succeeds, the socket does not open, a send is 403 with a session and 401 without", () => {
  assert.deepEqual(deny["fresh-key"], { authenticates: true, socketOpens: false });
  assert.deepEqual(deny["rest-only/session"], { authenticated: true, send: { status: 403, code: "e.p.authorization.send" } });
  assert.deepEqual(deny["rest-only/none"], { authenticated: true, send: { status: 401 } });
  // The control for "the socket does not open": on the other two configurations it does.
  assert.equal(open["fresh-key"].socketOpens, true);
  assert.equal(mailbox["fresh-key"].socketOpens, true);
});

// ───────────────────────────────────────────────────────────── section 2.6, the VTA versions

const servedBy = (family) => VERSIONS.map((version) => serves[version][family]);
const notServed = (answer) => typeof answer === "string" && answer.startsWith("not served");

test("2.6, the access-list tasks: 0.2 at the pin, 0.3 on the other two, and one version each", () => {
  for (const family of ["acl/grant", "acl/revoke", "acl/update"]) assert.deepEqual(servedBy(family), [["0.2"], ["0.3"], ["0.3"]], family);
  assert.deepEqual(servedBy("acl/list"), [["0.3"], ["0.4"], ["0.4"]]);
});

test("2.6, memory: put, list and delete up to 0.2 at the pin and 0.3 after; get up to 0.1 and 0.2", () => {
  for (const family of ["vta/memory/put", "vta/memory/list", "vta/memory/delete"]) {
    assert.deepEqual(servedBy(family), [["0.1", "0.2"], ["0.1", "0.2", "0.3"], ["0.1", "0.2", "0.3"]], family);
  }
  assert.deepEqual(servedBy("vta/memory/get"), [["0.1"], ["0.1", "0.2"], ["0.1", "0.2"]]);
  assert.deepEqual(servedBy("vta/contexts/delete"), [["1.1"], ["1.2"], ["1.2"]]);
});

test("2.6, the tasks the row calls the same on all three", () => {
  const same = {
    "acl/swap-key": ["0.1"],
    "device/register": ["0.2"],
    "device/list": ["0.3"],
    "device/disable": ["0.1"],
    "vta/contexts/create": ["1.0"],
    "rooms/keys/present": ["0.2"],
    "rooms/keys/act": ["0.8", "0.9", "0.10", "0.11", "0.12"],
    "keys/sign-document": ["0.1"],
    "vta/webvh/dids/create": ["1.2"],
  };
  for (const [family, versions] of Object.entries(same)) assert.deepEqual(servedBy(family), [versions, versions, versions], family);
});

test("2.6, auth/oob: no VTA of the three serves any of its tasks", () => {
  for (const version of VERSIONS) {
    const oob = Object.entries(serves[version]).filter(([family]) => family.startsWith("auth/oob/"));
    assert.equal(oob.length, 6, version);
    for (const [family, answer] of oob) assert.ok(notServed(answer), `${version} ${family}`);
  }
  // The control: a family that is served is not read as "not served".
  assert.equal(notServed(serves["0.87.0"]["acl/grant"]), false);
});

test("2.6, the cases: 14 of step 0.1; none can run at the pin; 0.84.0 and 0.87.0 agree on every case", () => {
  const names = Object.keys(cases["0.87.0"]);
  for (const version of VERSIONS) assert.deepEqual(Object.keys(cases[version]), names, `${version} records the same cases, in the same order`);
  // Every case but the one for step 7.5 belongs to step 0.1.
  assert.equal(names.filter((name) => name !== "pairing-readback").length, 14);
  for (const name of names) {
    assert.match(cases["0.79.0"][name].notRunnable?.join(" ") ?? "", /acl\/grant\/0\.3 is not served/, `0.79.0 ${name}`);
    assert.equal("notRunnable" in cases["0.84.0"][name], false, `0.84.0 ${name}`);
    assert.deepEqual(cases["0.84.0"][name], cases["0.87.0"][name], name);
  }
});

test("no recorded case is a case that threw", () => {
  for (const version of VERSIONS) for (const [name, result] of Object.entries(cases[version])) assert.equal("error" in result, false, `${version} ${name}`);
  for (const [mode, set] of Object.entries({ open, mailbox, deny })) for (const [name, result] of Object.entries(set)) assert.equal("error" in result, false, `${mode} ${name}`);
});
