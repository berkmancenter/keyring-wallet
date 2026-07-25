/**
 * Askar 0.2→0.6 store-migration E2E, Android-only (no macOS/Xcode needed):
 * same flow as run-store-migration.js, but a second Android emulator stands
 * in for the iOS simulator peer. Flow lives in lib/storeMigrationFlow.js;
 * this script only wires up the peer session.
 *
 * Usage:
 *   BASELINE_APK=/tmp/kw-baseline/app/android/app/build/outputs/apk/release/app-release.apk \
 *   ANDROID_AVD2=<second-avd> \
 *     node run-store-migration-android-only.js
 *
 * Needs a second AVD (two emulators can't share one) — see e2e/README.md
 * "Android-only variant" for how to create one. The default ANDROID_AVD is
 * the upgrade holder; ANDROID_AVD2 is the peer and is never upgraded.
 *
 * See run-store-migration.js's header for BASELINE_APK build instructions —
 * unchanged here, the baseline apk is unrelated to the peer's platform.
 */
import { androidCaps, ANDROID_AVD2 } from "./lib/config.js";
import { createSession } from "./lib/driver.js";
import { runStoreMigration } from "./lib/storeMigrationFlow.js";

const BASELINE_APK = process.env.BASELINE_APK;
if (!BASELINE_APK) {
  console.error("BASELINE_APK env var is required");
  process.exit(1);
}
if (!ANDROID_AVD2) {
  console.error(
    "ANDROID_AVD2 env var is required — two emulators can't share one AVD " +
      "(see e2e/README.md \"Android-only variant\" for creating a second one)"
  );
  process.exit(1);
}

async function createPeerSession() {
  return createSession("android", androidCaps(ANDROID_AVD2));
}

// Fresh Appium-installed Android sessions already get autoGrantPermissions —
// nothing to pre-grant for the peer.
async function primePeer() {}

await runStoreMigration({ baselineApk: BASELINE_APK, createPeerSession, primePeer });
