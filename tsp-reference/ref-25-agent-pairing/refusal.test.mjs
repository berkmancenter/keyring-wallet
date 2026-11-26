// Reading a mediator's refusals. The REST bodies below are the ones the lab
// mediator (v0.53.0, f6ed815) returned; fixtures/refusals.json holds them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROBLEM_REPORT, readProblemReport, readRestAnswer, refusedWith, retryAfterSeconds } from "./refusal.mjs";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/refusals.json", import.meta.url), "utf8"));

test("Retry-After is seconds, or an HTTP date, or nothing", () => {
  assert.equal(retryAfterSeconds("30"), 30);
  assert.equal(retryAfterSeconds(" 5 "), 5);
  const now = Date.parse("2026-11-26T00:00:00Z");
  assert.equal(retryAfterSeconds("Thu, 26 Nov 2026 00:01:00 GMT", now), 60);
  assert.equal(retryAfterSeconds("Thu, 26 Nov 2026 00:00:00 GMT", now + 5000), 0, "a date already past is now, never negative");
  assert.equal(retryAfterSeconds(undefined), undefined);
  assert.equal(retryAfterSeconds("soon"), undefined);
  assert.equal(retryAfterSeconds("-3"), undefined);
});

test("a success is not a refusal", () => {
  const answer = readRestAnswer(fixtures.accepted);
  assert.equal(answer.refused, false);
  assert.equal(answer.status, 200);
  assert.equal(answer.code, undefined);
});

test("each recorded refusal reduces to its status and code", () => {
  for (const [name, expected] of Object.entries(fixtures.expected)) {
    const answer = readRestAnswer(fixtures[name]);
    assert.equal(answer.refused, true, name);
    assert.equal(answer.status, expected.status, `${name} status`);
    assert.equal(answer.code, expected.code, `${name} code`);
    assert.equal(answer.errorCode, expected.errorCode, `${name} number`);
    assert.ok(refusedWith(answer, expected.code), name);
  }
});

test("the queue refusal carries Retry-After, and a refusal without the header carries none", () => {
  assert.equal(readRestAnswer(fixtures.queueFull).retryAfter, 30, "the mediator's own header was `retry-after: 30`");
  assert.equal(readRestAnswer(fixtures.anonymous).retryAfter, undefined);
});

test("headers are read whatever their case, from a plain object or a Headers", () => {
  const body = fixtures.queueFull.body;
  assert.equal(readRestAnswer({ status: 503, headers: { "Retry-After": "7" }, body }).retryAfter, 7);
  assert.equal(readRestAnswer({ status: 503, headers: new Headers({ "retry-after": "9" }), body }).retryAfter, 9);
});

test("a body that is not JSON still gives its status, and no code is invented", () => {
  const answer = readRestAnswer({ status: 502, headers: {}, body: "Bad Gateway" });
  assert.equal(answer.refused, true);
  assert.equal(answer.code, undefined);
  assert.equal(readRestAnswer({ status: 403, headers: {}, body: undefined }).code, undefined);
});

test("a code is matched whole: one code is not mistaken for a longer one", () => {
  const answer = readRestAnswer({ status: 403, headers: {}, body: { errorCodeStr: "e.p.authorization.send_forwarded", message: "x" } });
  assert.equal(answer.code, "e.p.authorization.send_forwarded");
  assert.equal(refusedWith(answer, "e.p.authorization.send"), false);
});

test("a problem report on the socket is reduced; any other message is not one", () => {
  const report = readProblemReport({
    type: PROBLEM_REPORT,
    pthid: "urn:uuid:1",
    body: { code: "e.p.authorization.send_forwarded", comment: "DID may not {1}", args: ["x", "forward"] },
  });
  assert.deepEqual(report, {
    code: "e.p.authorization.send_forwarded",
    comment: "DID may not {1}",
    args: ["x", "forward"],
    pthid: "urn:uuid:1",
    thid: undefined,
  });
  assert.equal(readProblemReport({ type: "https://didcomm.org/basicmessage/2.0/message", body: {} }), undefined);
  assert.equal(readProblemReport(undefined), undefined);
  assert.deepEqual(readProblemReport({ type: PROBLEM_REPORT }), { code: undefined, comment: undefined, args: [], pthid: undefined, thid: undefined });
});

test("a send with no session is a 401 with no problem code", () => {
  const answer = readRestAnswer(fixtures.noSession);
  assert.equal(answer.refused, true);
  assert.equal(answer.status, 401);
  assert.equal(answer.code, undefined);
  assert.equal(answer.message, "Missing credentials");
});
