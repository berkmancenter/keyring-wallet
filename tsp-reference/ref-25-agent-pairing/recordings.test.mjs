// The plan's two measured tables, held to the recordings, with no lab running.
//
// agent-connect-plan.md states what the mediator did (section 2.4) and what each VTA version serves (section
// 2.6). Those statements came from the recordings under fixtures/. This file ties the two together: each test
// quotes the table row it is about, fails if the plan no longer has that row, and then asserts that the
// recordings hold what the row says. So a changed row, or a re-recording that says something else, fails the
// test that sits beside it, until a person has read the row against those assertions.
//
// A row is compared by its words: runs of spaces are one space, so re-aligning a table changes nothing here.
//
// What it does not do: read the plan's prose, or the README. Only these rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
/** A line by its words: runs of spaces as one, none at the ends. */
const words = (line) => line.replace(/ +/g, " ").trim();
const planText = read("../../docs/plans/agent-connect-plan.md").split("\n");
const planLines = new Set(planText.map(words));
/** Every row a test has quoted and found in the plan. The last test holds this to the two tables, whole. */
const quoted = new Set();
/** The plan must still have `row`. Each test calls this first, with the row it is about. */
function planHas(row) {
  if (planLines.has(words(row))) quoted.add(words(row));
  assert.ok(
    planLines.has(words(row)),
    `the plan no longer has the row this test quotes. Read the plan's new row against the assertions in this test; change them if what the row says changed; then quote the new row here.\nQuoted: ${row}`,
  );
}
const recorded = (name) => JSON.parse(read(`./fixtures/${name}.json`));

const open = recorded("recorded-open").cases;
const mailbox = recorded("recorded-mailbox").cases;
const deny = recorded("recorded-deny").cases;
const VERSIONS = ["0.79.0", "0.84.0", "0.87.0"];
const serves = Object.fromEntries(VERSIONS.map((version) => [version, recorded(`vta-${version}`).serves]));
const cases = Object.fromEntries(VERSIONS.map((version) => [version, recorded(`vta-cases-${version}`).cases]));


const delivered = { send: { status: 200 }, delivered: true };
const refused = (status, code) => ({ send: code ? { status, code } : { status }, delivered: false });
const noSession = refused(401);
const QUEUE_FULL = { accepted: 50, refusal: { status: 503, code: "e.p.limits.queue.peer", retryAfter: 30 } };

test("a row is compared by its words: re-aligned it is the same row, and with one value changed it is not", () => {
  const row = "| `acl/list` | 0.3 | 0.4 | 0.4 |";
  planHas(row);
  planHas("| `acl/list`   |  0.3 | 0.4   | 0.4 |  ");
  assert.throws(() => planHas("| `acl/list` | 0.3 | 0.4 | 0.5 |"), /no longer has the row/);
  assert.throws(() => planHas("| `acl/list` | 0.3 | 0.4 |"), /no longer has the row/);
  // Spaces inside a cell's words still count: this is not the same text.
  assert.throws(() => planHas("| `acl/list` | 0. 3 | 0.4 | 0.4 |"), /no longer has the row/);
});

/**
 * The data rows of the one table in a section of the plan: the lines that start with `|` between the section's
 * heading and the next heading of any level, without the header row and the rule under it.
 */
function tableRows(heading) {
  const starts = planText.flatMap((line, index) => (line.startsWith(heading) ? [index] : []));
  assert.equal(starts.length, 1, `the plan has ${starts.length} headings that start "${heading}"`);
  const after = planText.slice(starts[0] + 1);
  const end = after.findIndex((line) => /^#{1,6} /.test(line));
  assert.notEqual(end, -1, `no heading follows "${heading}"`);
  const table = after.slice(0, end).filter((line) => line.startsWith("|"));
  assert.match(table[1] ?? "", /^\|(?: *:?-+:? *\|)+$/, `the second line of the table under "${heading}" is not a rule`);
  return table.slice(2).map(words);
}

// ───────────────────────────────────────────────────────────── section 2.4, the mediator

test("2.4, live delivery: 200 and delivered when open or with an account on the mailbox; 401 with no session there", () => {
  planHas("| The recipient is authenticated with live delivery open | HTTP 200 `Forwarded`; the recipient's socket receives the inner message, from the sender | the same | **HTTP 401 \"Missing credentials\"** | HTTP 200, delivered |");
  assert.deepEqual(open["live/none"], delivered);
  assert.deepEqual(open["live/session"], delivered);
  assert.deepEqual(mailbox["live/none"], noSession);
  assert.deepEqual(mailbox["live/session"], delivered);
});

test("2.4, an offline recipient: queued and delivered on connect, on the same pattern", () => {
  planHas("| The recipient has an account and is offline; it connects later | HTTP 200, queued, delivered on connect | the same | HTTP 401 | HTTP 200, delivered on connect |");
  assert.deepEqual(open["offline/none"], delivered);
  assert.deepEqual(open["offline/session"], delivered);
  assert.deepEqual(mailbox["offline/none"], noSession);
  assert.deepEqual(mailbox["offline/session"], delivered);
});

test("2.4, a recipient that never contacted the mediator: 403 e.p.delivery.refused, not delivered", () => {
  planHas("| The recipient has never contacted the mediator | **HTTP 403 `e.p.delivery.refused`**, not delivered | the same | HTTP 401 | **HTTP 403 `e.p.delivery.refused`** |");
  const expected = refused(403, "e.p.delivery.refused");
  assert.deepEqual(open["never-seen/none"], expected);
  assert.deepEqual(open["never-seen/session"], expected);
  assert.deepEqual(mailbox["never-seen/none"], noSession);
  assert.deepEqual(mailbox["never-seen/session"], expected);
});

test("2.4, an anoncrypt forward: 400 w.m.message.anonymous", () => {
  planHas("| The outer forward is anoncrypt | HTTP 400 `w.m.message.anonymous`, not delivered | the same | HTTP 401 | HTTP 400 `w.m.message.anonymous` |");
  const expected = refused(400, "w.m.message.anonymous");
  assert.deepEqual(open["anonymous/none"], expected);
  assert.deepEqual(open["anonymous/session"], expected);
  assert.deepEqual(mailbox["anonymous/none"], noSession);
  assert.deepEqual(mailbox["anonymous/session"], expected);
});

test("2.4, a did:peer whose service is this mediator, by URL or by DID: delivered", () => {
  planHas("| A `did:peer:2` recipient whose service is this mediator's REST URL, or its DID | delivered | delivered | HTTP 401 | delivered |");
  for (const how of ["peer-here-url", "peer-here-did"]) {
    assert.deepEqual(open[`${how}/none`], { attached: true, ...delivered }, how);
    assert.deepEqual(open[`${how}/session`], { attached: true, ...delivered }, how);
    assert.deepEqual(mailbox[`${how}/none`], { attached: true, ...noSession }, how);
    assert.deepEqual(mailbox[`${how}/session`], { attached: true, ...delivered }, how);
  }
});

test("2.4, a did:peer whose service names another host: accepted and not delivered when open; delivered here on the mailbox", () => {
  planHas("| The same, but the service names a **different host** | HTTP 200 at send, not delivered in 8 s (the mediator tries the other host) | the same | HTTP 401 | HTTP 200, **delivered here** (`external_forwarding` is off, and the recipient holds an account here) |");
  const acceptedNotDelivered = { attached: true, send: { status: 200 }, delivered: false };
  assert.deepEqual(open["peer-elsewhere/none"], acceptedNotDelivered);
  assert.deepEqual(open["peer-elsewhere/session"], acceptedNotDelivered);
  assert.deepEqual(mailbox["peer-elsewhere/none"], { attached: true, ...noSession });
  assert.deepEqual(mailbox["peer-elsewhere/session"], { attached: true, ...delivered });
});

test("2.4, the queue: 50 accepted, the 51st refused 503 e.p.limits.queue.peer with Retry-After 30", () => {
  planHas("| The recipient is offline, one sender sends repeatedly | 50 accepted; the 51st refused HTTP 503 `e.p.limits.queue.peer` with `Retry-After: 30` | the same | HTTP 401 | 50 accepted; the 51st refused the same way |");
  assert.deepEqual(open["queue/none"], QUEUE_FULL);
  assert.deepEqual(open["queue/session"], QUEUE_FULL);
  assert.deepEqual(mailbox["queue/session"], QUEUE_FULL);
  assert.deepEqual(mailbox["queue/none"], { accepted: 0, refusal: { status: 401, retryAfter: "absent" } });
});

test("2.4, the self-grant: 200 both times when open; on the mailbox 403 send_forwarded, the grant, then delivered", () => {
  planHas("| A new account sends before it switches `SEND_FORWARDED` on, then after | HTTP 200 both times | | | **HTTP 403 `e.p.authorization.send_forwarded`**; the `account/update` answer shows `sendForwarded` on; then HTTP 200, delivered |");
  assert.deepEqual(open["self-grant"], { attached: true, before: delivered, grant: { sendForwarded: true }, after: delivered });
  assert.deepEqual(mailbox["self-grant"], {
    attached: true,
    before: refused(403, "e.p.authorization.send_forwarded"),
    grant: { sendForwarded: true },
    after: delivered,
  });
});

test("2.4, a deny-all default: authentication succeeds, the socket does not open, a send is 403 with a session and 401 without", () => {
  planHas("| `global_acl_default = DENY_ALL` | a send with a session is refused HTTP 403 `e.p.authorization.send` and one with none HTTP 401; the WebSocket upgrade is refused (close 1006); authentication itself still succeeds | | | |");
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
  planHas("| `acl/grant`, `acl/revoke`, `acl/update` | 0.2 | 0.3 | 0.3 |");
  planHas("| `acl/list` | 0.3 | 0.4 | 0.4 |");
  for (const family of ["acl/grant", "acl/revoke", "acl/update"]) assert.deepEqual(servedBy(family), [["0.2"], ["0.3"], ["0.3"]], family);
  assert.deepEqual(servedBy("acl/list"), [["0.3"], ["0.4"], ["0.4"]]);
});

test("2.6, memory: put, list and delete up to 0.2 at the pin and 0.3 after; get up to 0.1 and 0.2", () => {
  planHas("| `vta/memory/put`, `list`, `delete` | 0.1, 0.2 | 0.1 to 0.3 | 0.1 to 0.3 |");
  planHas("| `vta/memory/get` | 0.1 | 0.1, 0.2 | 0.1, 0.2 |");
  planHas("| `vta/contexts/delete` | 1.1 | 1.2 | 1.2 |");
  for (const family of ["vta/memory/put", "vta/memory/list", "vta/memory/delete"]) {
    assert.deepEqual(servedBy(family), [["0.1", "0.2"], ["0.1", "0.2", "0.3"], ["0.1", "0.2", "0.3"]], family);
  }
  assert.deepEqual(servedBy("vta/memory/get"), [["0.1"], ["0.1", "0.2"], ["0.1", "0.2"]]);
  assert.deepEqual(servedBy("vta/contexts/delete"), [["1.1"], ["1.2"], ["1.2"]]);
});

test("2.6, the tasks the row calls the same on all three", () => {
  planHas("| `acl/swap-key` 0.1, `device/register` 0.2, `device/list` 0.3, `device/disable` 0.1, `vta/contexts/create` 1.0, `rooms/keys/present` 0.2, `rooms/keys/act` 0.8 to 0.12, `keys/sign-document` 0.1, `vta/webvh/dids/create` 1.2 | the same on all three | | |");
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
  planHas("| `auth/oob/*` | not served by a VTA on any of the three (ledger AC-36) | | |");
  for (const version of VERSIONS) {
    const oob = Object.entries(serves[version]).filter(([family]) => family.startsWith("auth/oob/"));
    assert.equal(oob.length, 6, version);
    for (const [family, answer] of oob) assert.ok(notServed(answer), `${version} ${family}`);
  }
  // The control: a family that is served is not read as "not served".
  assert.equal(notServed(serves["0.87.0"]["acl/grant"]), false);
});

test("2.6, the cases: 14 of step 0.1; none can run at the pin; 0.84.0 and 0.87.0 agree on every case", () => {
  planHas("| The rung's 14 cases (step 0.1) | none can run | recorded, each repeats | recorded, each repeats, the same as 0.84.0 on every case |");
  const names = Object.keys(cases["0.87.0"]);
  for (const version of VERSIONS) assert.deepEqual(Object.keys(cases[version]), names, `${version} records the same cases, in the same order`);
  // Every case but the one for step 7.5 and the one for Brendan's Q7 belongs to step 0.1.
  const notStep01 = ["pairing-readback", "own-entry"];
  for (const name of notStep01) assert.ok(names.includes(name), `the recordings carry ${name}`);
  assert.equal(names.filter((name) => !notStep01.includes(name)).length, 14);
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

// ───────────────────────────────────────────────────────────── both tables, whole

// This test is last on purpose: it reads what the tests above quoted. Run the whole file, not one test by name.
test("every row of the two tables is quoted by a test above, so a row added to either is not left unmeasured", () => {
  const mediator = tableRows("### 2.4 ");
  const vta = tableRows("### 2.6 ");
  // The counts are written out, so a table that moves, splits or loses its section fails here instead of
  // quietly giving a smaller set to check.
  assert.equal(mediator.length, 9, "section 2.4's table");
  assert.equal(vta.length, 8, "section 2.6's table");
  for (const row of [...mediator, ...vta]) {
    assert.ok(quoted.has(row), `no test quotes this row of the plan, so nothing holds it to the recordings:\n${row}`);
  }
});
