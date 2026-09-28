/**
 * Askar 0.2→0.6 store-migration E2E (Phase 3 gate), Android holder + a peer
 * wallet. Flow lives in lib/storeMigrationFlow.js — see that file's header
 * for the full phase breakdown; this script only wires up the peer session.
 *
 * Usage: one script for every pairing this flow supports — there is no
 * separate `:android-only` yarn command:
 *
 *   BASELINE_APK=/tmp/kw-baseline/app/android/app/build/outputs/apk/release/app-release.apk \
 *     node run-store-migration.js                                # android + iOS sim (default)
 *
 *   DEVICE_PLATFORMS=android,android ANDROID_AVD2=<second-avd> \
 *   BASELINE_APK=... node run-store-migration.js                  # android + second android emulator
 *
 * No macOS/Xcode? Use DEVICE_PLATFORMS=android,android — a second Android
 * emulator stands in for the iOS simulator peer. Needs a second AVD (two
 * emulators can't share one) — see e2e/README.md "Android-only variant" for
 * how to create one. The default ANDROID_AVD is the upgrade holder;
 * ANDROID_AVD2 is the peer and is never upgraded.
 *
 * The new apk comes from ANDROID_APK or the default path in lib/config.js.
 * Metro for the NEW build must be running on :8081 (the baseline apk doesn't
 * need it — its JS is bundled).
 *
 * Building the baseline apk (the /tmp worktree is throwaway — recreate from
 * the `upgrade-baseline-p0` tag as needed):
 *   git worktree add /tmp/kw-baseline upgrade-baseline-p0
 *   git -C /tmp/kw-baseline submodule update --init bifold
 *   cp app/.env /tmp/kw-baseline/app/.env
 *   (cd /tmp/kw-baseline && yarn install)   # ffi-napi/ref-napi build failures
 *                                           # are fine (Node-only packages)
 *   (cd /tmp/kw-baseline/app/android && ./gradlew assembleRelease)
 * MUST be a RELEASE build (release already uses the debug keystore locally in
 * the baseline build.gradle): a debug baseline apk connects to metro and loads
 * the NEW JS bundle → askar 0.2-native vs 0.6-JS mismatch crash on launch.
 * Cleanup afterwards: git worktree remove --force /tmp/kw-baseline
 *
 * Env overrides: DEVICE_PLATFORMS, BASELINE_APK, ANDROID_AVD2 (android,android
 * only), ANDROID_APK.
 */
import "./lib/cli-guard.js";
import { execSync } from "node:child_process";
import { remote } from "webdriverio";

import { sleep, simTarget, createSession } from "./lib/driver.js";
import { APP_ID, APPIUM_PORT, iosCaps, androidCaps, ANDROID_AVD2 } from "./lib/config.js";
import { runStoreMigration } from "./lib/storeMigrationFlow.js";

const BASELINE_APK = process.env.BASELINE_APK;
if (!BASELINE_APK) {
  console.error("BASELINE_APK env var is required");
  process.exit(1);
}

// ---------- platform selection ----------

const platforms = (process.env.DEVICE_PLATFORMS || "android,ios")
  .split(",")
  .map((s) => s.trim());
if (platforms.length !== 2 || platforms[0] !== "android" || (platforms[1] !== "android" && platforms[1] !== "ios")) {
  console.error(
    'DEVICE_PLATFORMS must be "android,ios" (default) or "android,android" — ' +
      "the holder is always the physical Android build; a two-iPhone pairing isn't supported by this runner."
  );
  process.exit(1);
}
const bothAndroid = platforms[1] === "android";

if (bothAndroid && !ANDROID_AVD2) {
  console.error(
    "ANDROID_AVD2 env var is required — two emulators can't share one AVD " +
      "(see e2e/README.md \"Android-only variant\" for creating a second one)"
  );
  process.exit(1);
}

async function createIosPeerSession() {
  const driver = await remote({
    hostname: "127.0.0.1",
    port: APPIUM_PORT,
    connectionRetryTimeout: 600000,
    connectionRetryCount: 1,
    capabilities: iosCaps(),
  });
  driver.e2ePlatform = "ios";
  return driver;
}

/**
 * Pre-grant camera so the Scan screen skips the camera-disclosure Modal.
 * Presenting that Modal right as the QR bottom-sheet dismisses intermittently
 * fails on the iOS simulator, leaving a blank Scan screen that never recovers.
 */
async function primeIosPeer(peer) {
  try {
    execSync(`xcrun simctl privacy ${simTarget(peer)} grant camera ${APP_ID}`);
    // granting TCC permission kills the app; relaunch it cleanly (immediate
    // activate can race the teardown and leave a black screen)
    await peer.terminateApp(APP_ID).catch(() => {});
    await sleep(3000);
    await peer.activateApp(APP_ID);
    await sleep(3000);
    console.log("[e2e] ios: camera permission pre-granted");
  } catch {
    /* non-fatal — flow falls back to the disclosure modal */
  }
}

async function createAndroidPeerSession() {
  return createSession("android", androidCaps(ANDROID_AVD2));
}

// Fresh Appium-installed Android sessions already get autoGrantPermissions —
// nothing to pre-grant for the peer.
async function primeAndroidPeer() {}

const name = bothAndroid ? "store-migration (android,android)" : "store-migration";

await runStoreMigration({
  baselineApk: BASELINE_APK,
  createPeerSession: bothAndroid ? createAndroidPeerSession : createIosPeerSession,
  primePeer: bothAndroid ? primeAndroidPeer : primeIosPeer,
  name,
});
