// Run: node --test lib/androidCaps.test.mjs   (no device or Appium needed)
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { androidCaps, androidTargetCaps, ANDROID_AVD } from "./config.js";

const noUdid = !process.env.ANDROID_UDID;

test("AVD mode is the default and carries the raised boot timeouts", { skip: !noUdid }, () => {
  const caps = androidCaps();
  assert.equal(caps["appium:avd"], ANDROID_AVD);
  assert.equal(caps["appium:udid"], undefined);
  assert.equal(caps["appium:avdLaunchTimeout"], 300000);
  assert.equal(caps["appium:avdReadyTimeout"], 300000);
});

test("an explicit avd stays AVD mode", () => {
  const caps = androidTargetCaps("Second_AVD");
  assert.equal(caps["appium:avd"], "Second_AVD");
  assert.equal(caps["appium:udid"], undefined);
});

test("an explicit udid replaces the avd and skips AVD launch settings", () => {
  const caps = androidCaps(undefined, "R5CN70Q6PDP");
  assert.equal(caps["appium:udid"], "R5CN70Q6PDP");
  for (const k of ["appium:avd", "appium:avdLaunchTimeout", "appium:avdReadyTimeout"]) {
    assert.equal(k in caps, false, k);
  }
  assert.equal(caps["appium:appPackage"], "asml.bkc.harvard.wallet");
});

test("ANDROID_UDID in the environment selects device mode, unless an avd is passed", () => {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { androidCaps } from "./lib/config.js";
       console.log(JSON.stringify([androidCaps(), androidCaps("Other_AVD")]));`,
    ],
    { env: { ...process.env, ANDROID_UDID: "R5CY83SM4ST" }, cwd: new URL("..", import.meta.url), encoding: "utf8" }
  );
  const [fromEnv, withAvd] = JSON.parse(out.trim().split("\n").pop());
  assert.equal(fromEnv["appium:udid"], "R5CY83SM4ST");
  assert.equal("appium:avd" in fromEnv, false);
  assert.equal(withAvd["appium:avd"], "Other_AVD");
  assert.equal("appium:udid" in withAvd, false);
});
