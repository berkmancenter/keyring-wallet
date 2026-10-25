// node --test tsp-reference/ref-20-local-vetting/retry-after.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { retryAfterMs, withRetryAfter, MAX_ATTEMPTS, MAX_WAIT_MS } from "./retry-after.mjs";

const refused = (retryAfter, body = { error: "rate_limited", limiter: "unauth", retryAfterSecs: 1 }) => ({
  status: 429,
  headers: new Headers(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
  body,
});
const ok = { status: 200, headers: new Headers(), body: { tokens: { accessToken: "t" } } };

function sequence(...answers) {
  let i = 0;
  const send = async () => answers[Math.min(i++, answers.length - 1)];
  send.calls = () => i;
  return send;
}

test("the wait comes from Retry-After first, then retryAfterSecs, then one second", () => {
  assert.equal(retryAfterMs(new Headers({ "retry-after": "3" }), { retryAfterSecs: 7 }), 3000);
  assert.equal(retryAfterMs(new Headers(), { retryAfterSecs: 7 }), 7000);
  assert.equal(retryAfterMs(new Headers(), "not json"), 1000);
  assert.equal(retryAfterMs(new Headers({ "retry-after": "0" }), {}), 1000);
});

test("a long wait is bounded", () => {
  assert.equal(retryAfterMs(new Headers({ "retry-after": "3600" }), {}), MAX_WAIT_MS);
});

test("a refused call is retried after the wait it asked for, and the later answer is returned", async () => {
  const waits = [];
  const send = sequence(refused(2), refused(undefined, { retryAfterSecs: 1 }), ok);
  const r = await withRetryAfter(send, { sleep: async (ms) => void waits.push(ms) });
  assert.equal(r.status, 200);
  assert.equal(send.calls(), 3);
  assert.deepEqual(waits, [2000, 1000]);
});

test("an answer other than 429 is returned at once, errors included", async () => {
  const send = sequence({ status: 409, headers: new Headers(), body: { error: "conflict" } });
  const r = await withRetryAfter(send, { sleep: async () => assert.fail("must not wait") });
  assert.equal(r.status, 409);
  assert.equal(send.calls(), 1);
});

test("a limiter that keeps refusing is reported after MAX_ATTEMPTS, not waited out", async () => {
  const send = sequence(refused(1));
  const r = await withRetryAfter(send, { sleep: async () => {} });
  assert.equal(r.status, 429);
  assert.equal(send.calls(), MAX_ATTEMPTS);
});
