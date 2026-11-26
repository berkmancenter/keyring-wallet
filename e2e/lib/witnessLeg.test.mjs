// node --test e2e/lib/witnessLeg.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { witnessLegFrom } from "./witnessLeg.js";

test("the witness leg is v1 unless asked otherwise", () => {
  assert.equal(witnessLegFrom(undefined), "v1");
  assert.equal(witnessLegFrom(""), "v1");
  assert.equal(witnessLegFrom("v1"), "v1");
});

test("v2 is the one other answer, case and spaces aside", () => {
  assert.equal(witnessLegFrom("v2"), "v2");
  assert.equal(witnessLegFrom(" V2 "), "v2");
});

test("CONTROL: anything else is refused, not read as a default", () => {
  assert.throws(() => witnessLegFrom("v3"), /WITNESS_LEG must be "v1" or "v2"/);
  assert.throws(() => witnessLegFrom("true"), /WITNESS_LEG/);
});
