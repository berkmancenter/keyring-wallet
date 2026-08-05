/**
 * Askar 0.2→0.6 store-migration E2E (Phase 3 gate), Android holder + iOS
 * simulator peer. Flow lives in lib/storeMigrationFlow.js — see that file's
 * header for the full phase breakdown; this script only wires up the iOS
 * peer session.
 *
 * Usage:
 *   BASELINE_APK=/tmp/kw-baseline/app/android/app/build/outputs/apk/release/app-release.apk \
 *     node run-store-migration.js
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
 * No macOS/Xcode? See run-store-migration-android-only.js — same flow, a
 * second Android emulator stands in for the iOS peer.
 */
import { execSync } from "node:child_process";
import { remote } from "webdriverio";

import { sleep } from "./lib/driver.js";
import { APP_ID, APPIUM_PORT, iosCaps } from "./lib/config.js";
import { runStoreMigration } from "./lib/storeMigrationFlow.js";

const BASELINE_APK = process.env.BASELINE_APK;
if (!BASELINE_APK) {
  console.error("BASELINE_APK env var is required");
  process.exit(1);
}

async function createPeerSession() {
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
async function primePeer(peer) {
  try {
    execSync(`xcrun simctl privacy booted grant camera ${APP_ID}`);
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

await runStoreMigration({
  baselineApk: BASELINE_APK,
  createPeerSession,
  primePeer,
  name: "store-migration",
});
