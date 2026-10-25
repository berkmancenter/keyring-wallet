// The production app on a person's own phone is never reset or uninstalled by a test run. Appium's fullReset and an
// explicit `adb uninstall` both delete the app AND its data; the harness's default bundle id is the production one
// (config.js APP_ID), so a device run without an E2E_APP_ID override would wipe the person's real Keyring (found by
// the ZKP lane, 10-14, before the #397 device run). Emulators and simulators are the harness's own: no guard there.
//
// E2E_ALLOW_PROD_RESET=1 lets a run do it anyway, on purpose.
import { execFileSync } from "node:child_process";

export const PROD_BUNDLE = "asml.bkc.harvard.wallet";

/** Whether `udid` names a physical device, not an Android emulator or an iOS simulator. */
export function isPhysical(platform, udid, { simulators = iosSimulatorUdids } = {}) {
  if (!udid) return false; // no udid: Appium picks an emulator or simulator the harness started
  if (platform === "android") return !/^emulator-\d+$/.test(udid);
  return !simulators().has(udid);
}

let simCache;
function iosSimulatorUdids() {
  if (simCache) return simCache;
  simCache = new Set();
  try {
    const j = JSON.parse(execFileSync("xcrun", ["simctl", "list", "-j", "devices"], { encoding: "utf8", timeout: 20000 }));
    for (const list of Object.values(j.devices || {})) for (const d of list) simCache.add(d.udid);
  } catch {
    // No simctl (Linux, CI): nothing is known to be a simulator, so an iOS udid counts as physical: the safe side.
  }
  return simCache;
}

/** Throws unless resetting `bundleId` on this device is allowed. `action` says what was about to happen. */
export function assertResetAllowed({ platform, udid, bundleId, action }, { env = process.env, simulators } = {}) {
  if (bundleId !== PROD_BUNDLE || env.E2E_ALLOW_PROD_RESET === "1") return;
  if (!isPhysical(platform, udid, simulators ? { simulators } : undefined)) return;
  throw new Error(
    `refusing to ${action} the production app ${PROD_BUNDLE} on the physical device ${udid}: it would delete the ` +
      `person's real Keyring and its data. Use a test build's bundle id (E2E_APP_ID=${PROD_BUNDLE}.<slug>), keep the ` +
      `app (E2E_KEEP_APP=1 / noReset), or set E2E_ALLOW_PROD_RESET=1 if this phone's Keyring may really be wiped.`,
  );
}

/** For Appium capabilities: throws if they would fullReset the production app on a physical device. */
export function assertCapsSafe(platform, caps, opts) {
  if (caps["appium:fullReset"] !== true) return;
  const bundleId = caps["appium:appPackage"] ?? caps["appium:bundleId"];
  assertResetAllowed({ platform, udid: caps["appium:udid"], bundleId, action: "fullReset (uninstall)" }, opts);
}
