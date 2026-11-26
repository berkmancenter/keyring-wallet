// Path-filter probe, test/tspref-red: a deliberately failing offline test, to show the job turns red. Never merged.
import { test } from "node:test";
import assert from "node:assert/strict";

test("this probe fails on purpose", () => {
  assert.equal(1, 2);
});
