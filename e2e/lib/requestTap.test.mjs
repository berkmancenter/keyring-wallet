import test from "node:test";
import assert from "node:assert/strict";
import { requestTookEffect } from "./requestTap.js";

const fresh = { cardBefore: false, statusBefore: "", endedBefore: false };

test("a dead tap: nothing moved, so it retries and can fail", () => {
  assert.equal(requestTookEffect(fresh, { card: false, status: "", ended: false }), false);
});

test("the card appearing means the request went", () => {
  assert.equal(requestTookEffect(fresh, { card: true, status: "Request sent", ended: false }), true);
});

test("a refusal inside the settle time: no card in the source, the ended line appears", () => {
  assert.equal(requestTookEffect(fresh, { card: false, status: "", ended: true }), true);
});

test("an ended line left by an earlier request is not this tap's effect", () => {
  assert.equal(requestTookEffect({ ...fresh, endedBefore: true }, { card: false, status: "", ended: true }), false);
});

test("the real ticket after a refusal: its card appears", () => {
  assert.equal(requestTookEffect({ ...fresh, endedBefore: true }, { card: true, status: "Request sent", ended: true }), true);
});

test("with a card already there, only a moved status counts", () => {
  const before = { cardBefore: true, statusBefore: "Refused", endedBefore: true };
  assert.equal(requestTookEffect(before, { card: true, status: "Refused", ended: true }), false);
  assert.equal(requestTookEffect(before, { card: true, status: "Request sent", ended: true }), true);
});
