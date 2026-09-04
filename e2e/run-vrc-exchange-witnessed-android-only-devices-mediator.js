/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended), Android-only,
 * with the witness running in MEDIATOR mode instead of the default DIRECT.
 *
 * This is the ":mediator" twin of run-vrc-exchange-witnessed-android-only-devices.js
 * — same flow, same devices, same everything, except the witness connects
 * through the shared production mediator (WebSocket, message pickup) rather
 * than over its own direct HTTP tunnel. It exists so mediator-mode witnessing
 * gets exercised on demand instead of only when someone remembers to set
 * WITNESS_MEDIATOR_INVITATION_URL by hand — that's exactly how the witness
 * ended up silently unable to receive a single mediated message for over a
 * week (see docs/spikes/e2e-vrc-connect-findings.md, "fourth failure layer").
 *
 * Two PHYSICAL phones are required, not emulators — see the DIRECT-mode
 * runner's header for why.
 *
 * Usage:
 *   node run-vrc-exchange-witnessed-android-only-devices-mediator.js
 *   (or: yarn e2e:vrc:witnessed:android-only:mediator from repo root)
 *
 * Both phones connected over USB are auto-detected; if more or fewer than
 * two are found, set ANDROID_UDID and ANDROID_UDID2 to pick them explicitly
 * (`adb devices` lists connected serials). The mediator invitation defaults
 * to app/.env's own MEDIATOR_URL; override with WITNESS_MEDIATOR_INVITATION_URL.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { createSession } from "./lib/driver.js";
import {
  ANDROID_APK,
  ANDROID_UDID,
  ANDROID_UDID2,
  androidDeviceCaps,
  resolveWitnessMediatorInvitationUrl,
} from "./lib/config.js";
import { runWitnessedExchange, dumpAndroidWitnessLogs } from "./lib/witnessedExchangeFlow.js";

// ---------- device discovery ----------

/** Exactly two physical (non-emulator) android devices are required. */
function detectTwoAndroidUdids() {
  if (ANDROID_UDID && ANDROID_UDID2) return { a: ANDROID_UDID, b: ANDROID_UDID2 };
  const out = execSync("adb devices").toString();
  const physical = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([id, state]) => id && state === "device" && !id.startsWith("emulator-"))
    .map(([id]) => id);
  if (physical.length !== 2) {
    throw new Error(
      `expected exactly two physical android devices (found: ${physical.join(", ") || "none"}). ` +
        `Set ANDROID_UDID and ANDROID_UDID2 to pick them (see \`adb devices\`).`
    );
  }
  return { a: physical[0], b: physical[1] };
}

function preflight() {
  if (!existsSync(ANDROID_APK)) {
    throw new Error(
      `Android APK not found: ${ANDROID_APK}\n  Build it: cd app/android && ./gradlew assembleDebug`
    );
  }
}

/**
 * Hardware attestation needs a secure lock screen (PIN/pattern/biometric) on
 * the device — without one, Android's Keystore silently issues a non-attested
 * key instead of failing loudly. That doesn't surface until the very end of
 * this attended run, as a confusing "peer evidence missing" assertion failure
 * on the OTHER phone. Catch it up front instead, in seconds, on both devices.
 */
function ensureLockScreenEnabled(udid) {
  const disabled = execSync(`adb -s ${udid} shell locksettings get-disabled`).toString().trim();
  if (disabled === "true") {
    throw new Error(
      `device ${udid} has no lock screen (PIN/pattern/biometric) set — hardware attestation requires ` +
        `one on BOTH phones. Set a PIN/pattern/biometric on this device and retry.`
    );
  }
}

preflight();
// Fail fast, before touching devices, if there's no mediator invitation to use.
process.env.WITNESS_MEDIATOR_INVITATION_URL = resolveWitnessMediatorInvitationUrl();
console.log(`[e2e] witness will run in MEDIATOR mode`);

const { a: udidA, b: udidB } = detectTwoAndroidUdids();
console.log(`[e2e] android devices: ${udidA}, ${udidB}`);
ensureLockScreenEnabled(udidA);
ensureLockScreenEnabled(udidB);
for (const udid of [udidA, udidB]) {
  try {
    execSync(`adb -s ${udid} logcat -c`);
  } catch {
    /* non-fatal */
  }
}

await runWitnessedExchange({
  detectDevices: () => ({ a: udidA, b: udidB }),
  createSessionA: (udid) => createSession("android", androidDeviceCaps(udid)),
  createSessionB: (udid) => createSession("android", androidDeviceCaps(udid)),
  dumpWitnessLogs: (udids) => dumpAndroidWitnessLogs(udids),
  name: "vrc-exchange:witnessed:android-only:mediator",
});
