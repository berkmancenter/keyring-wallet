/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended), Android-only,
 * with LOCALITY (BLE co-presence) required — locality-plan.md §10.3 item 12.
 *
 * Same flow as run-vrc-exchange-witnessed-android-only-devices.js, plus:
 *   - the witness runs with WITNESS_LOCALITY_REQUIRED=true, so it refuses to
 *     issue a VWC unless BOTH phones' co-presence is confirmed over BLE
 *     (locality-plan.md §8.2's `required` policy);
 *   - each phone's native BLE peripheral (item 9) advertises and answers the
 *     witness's GATT round trip for real — no emulator/simulator can do
 *     this, which is why this is device-only like hardware attestation;
 *   - the run asserts BOTH phones' co-presence was actually CONFIRMED, not
 *     merely attempted (assertLocalityConfirmedMarker), from Android's
 *     logcat.
 *
 * Android-only for two independent reasons, not one: the native peripheral
 * (item 9) has no iOS implementation, AND the witness's own BLE SENSOR
 * (witness-server's BleLocalityProvider, over BlueZ's D-Bus interface via
 * `node-ble`) only runs on Linux — see docs/plans/locality-plan/2026-08-20-bam.md
 * for why. **The machine running this script needs a real Bluetooth adapter
 * and a Linux host** (BlueZ), unlike the plain witnessed flow, which needs
 * neither — this is the one witnessed-exchange variant where the HOST
 * machine's own hardware matters, not just the phones'.
 *
 * ATTENDED: satisfy the OS biometric/PIN prompts at the OPERATOR banners on
 * BOTH phones, and grant the Bluetooth permission prompt on each phone when
 * it appears (locality-plan.md §8.4 — primed by the app's own pre-flight
 * sheet first). The witness runs behind a cloudflared HTTPS tunnel for the
 * DIDComm task channel, same as the other witnessed variants — only the BLE
 * radio leg needs the phones physically near this machine.
 *
 * Usage:
 *   node run-vrc-exchange-witnessed-locality-android-only-devices.js
 *   (or: yarn e2e:vrc:witnessed:locality:android-only from repo root)
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
// this at call time, not at its own module-load time, so setting it here,
// before runWitnessedExchange runs below, is early enough regardless of
// import order).
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
  name: "vrc-exchange:witnessed:locality:android-only",
  assertLocality: true,
});
