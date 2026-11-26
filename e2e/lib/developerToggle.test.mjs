// node --test e2e/lib/developerToggle.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { switchState, toggleAction } from "./developerToggle.js";

test("android: the Switch's checked attribute is the state", () => {
  assert.equal(switchState({ platform: "android", checked: "true" }), true);
  assert.equal(switchState({ platform: "android", checked: "false" }), false);
  assert.equal(switchState({ platform: "android", checked: null }), null);
  // the row's own value is not consulted on android
  assert.equal(switchState({ platform: "android", checked: undefined, value: "on" }), null);
});

test("ios: the row's accessibilityValue is the state", () => {
  assert.equal(switchState({ platform: "ios", value: "on" }), true);
  assert.equal(switchState({ platform: "ios", value: " Off " }), false);
  assert.equal(switchState({ platform: "ios", value: "1" }), true);
  assert.equal(switchState({ platform: "ios", value: "" }), null);
  assert.equal(switchState({ platform: "ios", value: undefined }), null);
});

test("a switch already where the run wants it is left alone", () => {
  assert.equal(toggleAction(true, true), "leave");
  assert.equal(toggleAction(false, false), "leave");
});

test("a switch that disagrees is tapped", () => {
  assert.equal(toggleAction(false, true), "tap");
  assert.equal(toggleAction(true, false), "tap");
});

test("CONTROL: an unreadable switch is never tapped blind", () => {
  assert.equal(toggleAction(null, true), "assume");
  assert.equal(toggleAction(undefined, true), "assume");
});
