/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended), Android-only:
 * two physical Android phones instead of an Android + iPhone pair. No
 * macOS/Xcode needed. Flow lives in lib/witnessedExchangeFlow.js — see that
 * file's header for the phase breakdown; this script only wires up device
 * discovery and the two sessions.
 *
 * Two PHYSICAL phones are required, not emulators: the whole point of this
 * test is hardware-attested witnessing (TEE-backed keys + BiometricPrompt on
 * both sides), and emulators cannot do hardware attestation (see
 * e2e/README.md) — an emulator pair would silently fall back to a plain,
 * unattested exchange.
 *
 * ATTENDED: satisfy the OS biometric/PIN prompts at the OPERATOR banners on
 * BOTH phones. The witness runs behind a cloudflared HTTPS tunnel, so no
 * shared LAN is needed between the phones and the machine running this
 * script.
 *
 * Usage:
 *   node run-vrc-exchange-witnessed-android-only-devices.js
 *   (or: yarn e2e:vrc:witnessed:android-only from repo root)
 *
 * Both phones connected over USB are auto-detected; if more or fewer than
 * two are found, set ANDROID_UDID and ANDROID_UDID2 to pick them explicitly
 * (`adb devices` lists connected serials).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { createSession } from "./lib/driver.js";
import { ANDROID_APK, ANDROID_UDID, ANDROID_UDID2, androidDeviceCaps } from "./lib/config.js";
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
  name: "vrc-exchange:witnessed:android-only",
});
