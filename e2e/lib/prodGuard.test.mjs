// node --test e2e/lib/prodGuard.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { PROD_BUNDLE, assertCapsSafe, assertResetAllowed, isPhysical } from "./prodGuard.js";

const sims = () => new Set(["11111111-2222-3333-4444-555555555555"]);
const opts = (env = {}) => ({ env, simulators: sims });

test("physical vs emulator and simulator", () => {
  assert.equal(isPhysical("android", "emulator-5572"), false);
  assert.equal(isPhysical("android", "R5CT30ABCDE"), true);
  assert.equal(isPhysical("android", "192.168.1.20:5555"), true);
  assert.equal(isPhysical("ios", "11111111-2222-3333-4444-555555555555", { simulators: sims }), false);
  assert.equal(isPhysical("ios", "00008110-001A2B3C4D5E801E", { simulators: sims }), true);
  assert.equal(isPhysical("android", undefined), false);
});

test("fullReset of the production app on a physical phone is refused, with the reason", () => {
  for (const [platform, udid, key] of [["android", "R5CT30ABCDE", "appium:appPackage"], ["ios", "00008110-001A2B3C4D5E801E", "appium:bundleId"]]) {
    assert.throws(
      () => assertCapsSafe(platform, { "appium:fullReset": true, "appium:udid": udid, [key]: PROD_BUNDLE }, opts()),
      /refusing to fullReset \(uninstall\) the production app .* physical device .* real Keyring and its data/,
    );
  }
});

test("allowed: an emulator, a simulator, a test bundle id, noReset, or the explicit flag", () => {
  assert.doesNotThrow(() => assertCapsSafe("android", { "appium:fullReset": true, "appium:udid": "emulator-5570", "appium:appPackage": PROD_BUNDLE }, opts()));
  assert.doesNotThrow(() => assertCapsSafe("ios", { "appium:fullReset": true, "appium:udid": "11111111-2222-3333-4444-555555555555", "appium:bundleId": PROD_BUNDLE }, opts()));
  assert.doesNotThrow(() => assertCapsSafe("android", { "appium:fullReset": true, "appium:udid": "R5CT30ABCDE", "appium:appPackage": `${PROD_BUNDLE}.e2e` }, opts()));
  assert.doesNotThrow(() => assertCapsSafe("android", { "appium:fullReset": false, "appium:noReset": true, "appium:udid": "R5CT30ABCDE", "appium:appPackage": PROD_BUNDLE }, opts()));
  assert.doesNotThrow(() => assertCapsSafe("android", { "appium:fullReset": true, "appium:udid": "R5CT30ABCDE", "appium:appPackage": PROD_BUNDLE }, opts({ E2E_ALLOW_PROD_RESET: "1" })));
});

test("an explicit uninstall is guarded the same way", () => {
  assert.throws(() => assertResetAllowed({ platform: "android", udid: "R5CT30ABCDE", bundleId: PROD_BUNDLE, action: "uninstall" }, opts()), /refusing to uninstall/);
  assert.doesNotThrow(() => assertResetAllowed({ platform: "android", udid: "emulator-5572", bundleId: PROD_BUNDLE, action: "uninstall" }, opts()));
});
