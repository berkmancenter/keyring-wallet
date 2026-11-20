// The port knobs that let several checkouts run e2e on one machine. Each default
// must stay what it was before the knob existed, so a single checkout is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { androidCaps, androidDeviceCaps, iosDeviceCaps } from "./config.js";

const KNOBS = ["ANDROID_SYSTEM_PORT", "WDA_LOCAL_PORT"];

function withEnv(env, fn) {
  const saved = Object.fromEntries(KNOBS.map((k) => [k, process.env[k]]));
  for (const k of KNOBS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of KNOBS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("Android systemPort defaults to 8200 for emulators and phones", () => {
  withEnv({}, () => {
    assert.equal(androidCaps()["appium:systemPort"], 8200);
    assert.equal(androidDeviceCaps("serial")["appium:systemPort"], 8200);
  });
});

test("ANDROID_SYSTEM_PORT moves the Android systemPort", () => {
  withEnv({ ANDROID_SYSTEM_PORT: "8210" }, () => {
    assert.equal(androidCaps()["appium:systemPort"], 8210);
    assert.equal(androidDeviceCaps("serial")["appium:systemPort"], 8210);
  });
});

test("real-device iOS wdaLocalPort defaults to 8123, follows WDA_LOCAL_PORT, and a caller's port wins", () => {
  withEnv({}, () => {
    assert.equal(iosDeviceCaps("udid")["appium:wdaLocalPort"], 8123);
  });
  withEnv({ WDA_LOCAL_PORT: "8110" }, () => {
    assert.equal(iosDeviceCaps("udid")["appium:wdaLocalPort"], 8110);
    assert.equal(iosDeviceCaps("udid", { wdaLocalPort: 8130 })["appium:wdaLocalPort"], 8130);
  });
});
