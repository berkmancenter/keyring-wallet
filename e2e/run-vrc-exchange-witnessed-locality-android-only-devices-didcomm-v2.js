/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended), Android-only,
 * with LOCALITY (BLE co-presence) required, on DIDComm v2: combines
 * run-vrc-exchange-witnessed-locality-android-only-devices.js's BLE gating
 * with run-vrc-exchange-witnessed-android-only-devices-didcomm-v2.js's v2
 * wallet-to-wallet connection.
 *
 * Same flow as run-vrc-exchange-witnessed-locality-android-only-devices.js,
 * plus: both wallets turn on Coordinate Mediation 2.0 and the witness serves
 * v1+v2, replying on whichever carriage it received — same reasoning as the
 * plain didcomm-v2 witnessed variant. The BLE co-presence leg (locality-plan.md
 * §8.2/§8.4) is unaffected by which DIDComm version the peer-to-peer exchange
 * uses; it's a separate radio round trip between the phones and this
 * machine's Bluetooth adapter.
 *
 * **The machine running this script needs a real Bluetooth adapter** — same
 * requirement as the plain locality variant, and for the same reason (the
 * witness's own BLE sensor runs here, not on the phones alone).
 *
 * ATTENDED: satisfy the OS biometric/PIN prompts at the OPERATOR banners on
 * BOTH phones, and grant the Bluetooth permission prompt on each phone when
 * it appears.
 *
 * Physical phones can't reach `10.0.2.2`, so the mediator needs tunnel mode
 * with v2 (`yarn mediator --didcomm-v2`), and the Android debug APK must be
 * rebuilt (`cd app/android && ./gradlew :app:assembleDebug`) after that
 * mediator run writes app/.env's MEDIATOR_V2_URL — restarting Metro alone
 * does not pick it up (see e2e/README.md and docs/E2E_REAL_DEVICE_FLAKINESS.md).
 *
 * Usage:
 *   node run-vrc-exchange-witnessed-locality-android-only-devices-didcomm-v2.js
 *   (or: yarn e2e:vrc:witnessed:locality:android-only:didcomm-v2 from repo root)
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

// This variant's whole point is a required, real BLE round trip — set
// before any of this module's other imports call startWitness (which reads
// these at call time, not at its own module-load time, so setting them here,
// before runWitnessedExchange runs below, is early enough regardless of
// import order). WITNESS_LOCALITY_POLICY drives both the Trust Tasks
// discovery answer (what makes the app's witness-connect pre-flight sheet
// show at all — startWitness defaults this to "off" for every other e2e
// variant) and the witness's own BLE sensor startup; WITNESS_LOCALITY_REQUIRED
// is the separate, legacy basic-message-ceremony gate.
process.env.WITNESS_LOCALITY_POLICY = "required";
process.env.WITNESS_LOCALITY_REQUIRED = "true";

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
  name: "vrc-exchange:witnessed:locality:android-only:didcomm-v2",
  assertLocality: true,
  useDidCommV2: true,
});
