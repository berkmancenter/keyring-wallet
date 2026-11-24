import assert from "node:assert/strict";
import { test } from "node:test";
import { pressAnyBack } from "./flows.js";
import { fakeDriver } from "./pages/testing/fakeDriver.mjs";

const withPredicate = (d, present) => {
  const real = d.$.bind(d);
  d.predicateClicks = 0;
  d.$ = (sel) =>
    String(sel).startsWith("-ios predicate string:")
      ? { isExisting: async () => present, click: async () => void d.predicateClicks++ }
      : real(sel);
  return d;
};

test("a stacked screen's header back (testID Back) is the one it presses", async () => {
  const d = fakeDriver({ screen: { Back: {} } });
  assert.equal(await pressAnyBack(d), true);
  assert.deepEqual(d.taps, ["Back"]);
});

test("BackButton when that is all the screen has", async () => {
  const d = fakeDriver({ screen: { BackButton: {} } });
  assert.equal(await pressAnyBack(d), true);
  assert.deepEqual(d.taps, ["BackButton"]);
});

test("Back wins over BackButton, and it is ONE press per call", async () => {
  const d = fakeDriver({ screen: { Back: {}, BackButton: {} } });
  assert.equal(await pressAnyBack(d), true);
  assert.deepEqual(d.taps, ["Back"], "both present must still be a single press");
});

test("android with neither is the old no-op: false, nothing pressed", async () => {
  const d = withPredicate(fakeDriver({ screen: { Contacts: {} } }), true);
  assert.equal(await pressAnyBack(d), false);
  assert.deepEqual(d.taps, []);
  assert.equal(d.predicateClicks, 0, "the iOS predicate must not run on android");
});

test("ios falls through to a header button labelled Back", async () => {
  const d = withPredicate(fakeDriver({ platform: "ios", screen: { Contacts: {} } }), true);
  assert.equal(await pressAnyBack(d), true);
  assert.equal(d.predicateClicks, 1);
});

test("ios with no such button: false, so backOut's loop stops", async () => {
  const d = withPredicate(fakeDriver({ platform: "ios", screen: { Contacts: {} } }), false);
  assert.equal(await pressAnyBack(d), false);
  assert.equal(d.predicateClicks, 0);
});
