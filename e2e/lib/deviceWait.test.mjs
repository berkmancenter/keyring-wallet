// node --test e2e/lib/deviceWait.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceWait } from "./flows.js";

const phone = { e2ePlatform: "ios", capabilities: { "appium:udid": "00008030-001A2B3C4D5E802E" } };

test("a physical iPhone waits at least 240 s", () => {
  delete process.env.E2E_DEVICE_TIMEOUT_MS;
  assert.equal(deviceWait(phone, 90000), 240000);
  assert.equal(deviceWait(phone, 60000), 240000);
  assert.equal(deviceWait(phone, 300000), 300000); // a longer wait is kept
});

test("E2E_DEVICE_TIMEOUT_MS sets the floor", () => {
  process.env.E2E_DEVICE_TIMEOUT_MS = "360000";
  try { assert.equal(deviceWait(phone, 90000), 360000); } finally { delete process.env.E2E_DEVICE_TIMEOUT_MS; }
});

test("Android, an emulator, or an iOS session with no udid keep the given time", () => {
  assert.equal(deviceWait({ e2ePlatform: "android", e2eUdid: "emulator-5572" }, 60000), 60000);
  assert.equal(deviceWait({ e2ePlatform: "android", e2eUdid: "R5CT30ABCDE" }, 60000), 60000);
  assert.equal(deviceWait({ e2ePlatform: "ios", capabilities: {} }, 90000), 90000);
});

import { androidHomeEnv } from "./driver.js";
test("Appium gets ANDROID_HOME: kept, from ANDROID_SDK_ROOT, or the Mac default when it exists", () => {
  assert.deepEqual(androidHomeEnv({ ANDROID_HOME: "/x" }, () => true), {});
  assert.deepEqual(androidHomeEnv({ ANDROID_SDK_ROOT: "/sdk" }, () => true), { ANDROID_HOME: "/sdk" });
  assert.match(androidHomeEnv({}, () => true).ANDROID_HOME, /Library\/Android\/sdk$/);
  assert.deepEqual(androidHomeEnv({}, () => false), {});
});
