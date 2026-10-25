// node --test e2e/lib/seatStep.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { awaitSeatStep } from "./seatStep.js";

/** A seat whose steps are scripted per poll, on a clock that moves only when the code waits. */
const seat = (steps, { loading = false } = {}) => {
  let t = 0;
  let poll = 0;
  const lines = [];
  return {
    lines,
    opts: {
      platform: "ios",
      role: "applicant",
      stepOf: async () => steps[Math.min(poll++, steps.length - 1)],
      loadingShown: async () => loading,
      now: () => t,
      wait: async (ms) => void (t += ms),
      log: (s) => lines.push(s),
    },
  };
};

test("a seat still reading (no step yet) is waited out, and the step it lands on is returned and logged", async () => {
  const s = seat([null, null, null, "identity"]);
  assert.equal(await awaitSeatStep(s.opts), "identity");
  assert.deepEqual(s.lines, ['[e2e] ios: Vetting applicant seat on "identity" after 1500 ms']);
});

test("a step already showing returns at once, and the log says 0 ms", async () => {
  const s = seat(["name"]);
  assert.equal(await awaitSeatStep(s.opts), "name");
  assert.deepEqual(s.lines, ['[e2e] ios: Vetting applicant seat on "name" after 0 ms']);
});

test("reads that never finish fail by name, saying the placeholder is still up", async () => {
  const s = seat([null], { loading: true });
  await assert.rejects(awaitSeatStep({ ...s.opts, timeoutMs: 5000 }), {
    message: "ios: Vetting showed no applicant step after 5 s (still on VettingSeatLoading: its reads never finished)",
  });
});

test("no step and no placeholder fails without blaming the reads", async () => {
  const s = seat([null]);
  await assert.rejects(awaitSeatStep({ ...s.opts, timeoutMs: 2000 }), { message: "ios: Vetting showed no applicant step after 2 s" });
});
