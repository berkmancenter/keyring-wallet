/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended), Android-only,
 * with the wallet-to-wallet connection on DIDComm v2 instead of the default
 * v1 connection: both wallets have the "DIDComm v2" and "wallet mailbox"
 * settings on (the defaults), so the exchange routes through their mailboxes
 * at Keyring's mailbox mediator; the witness leg is WITNESS_LEG (v1 by
 * default, see lib/witness.js), and on "v2" the witness serves v1+v2 so it
 * can reply on whichever carriage it received.
 * Otherwise identical to run-vrc-exchange-witnessed-android-only-devices.js —
 * same witness, same hardware attestation, same VWC issuance. Flow lives in
 * lib/witnessedExchangeFlow.js (`useDidCommV2: true`) — see that file's
 * header for the phase breakdown.
 *
 * The wallet-to-WITNESS protocol (session-request/session-challenge/VP
 * submission) is a separate channel — plain DIDComm basic messages
 * (witnessed-vrc-manager.ts) — and is unaffected by this flag on the wallet
 * side; the witness itself needs to serve v1+v2 (handled by startWitness)
 * since it also replies to the peer VRC exchange on whichever carriage it
 * arrived on.
 *
 * The build: app/.env must carry MAILBOX_MEDIATOR_DID (the store
 * configuration; Test and OTA-gate builds write it blank) and a MEDIATOR_URL
 * the phones can reach (tunnel mode, `yarn mediator` without `--endpoint`,
 * requires `cloudflared`); then build the Android APK (`cd app/android &&
 * ./gradlew :app:assembleDebug`), since restarting Metro alone does not pick
 * up app/.env (see e2e/README.md and docs/E2E_REAL_DEVICE_FLAKINESS.md).
 * Coordinate Mediation 2.0 and MEDIATOR_V2_URL are gone (#1166).
 *
 * Two PHYSICAL phones are required, not emulators — same reasoning as
 * run-vrc-exchange-witnessed-android-only-devices.js (see e2e/README.md).
 *
 * Usage:
 *   node run-vrc-exchange-witnessed-android-only-devices-didcomm-v2.js
 *   (or: yarn e2e:vrc:witnessed:android-only:didcomm-v2 from repo root)
 *
 * Both phones connected over USB are auto-detected; if more or fewer than
 * two are found, set ANDROID_UDID and ANDROID_UDID2 to pick them explicitly
 * (`adb devices` lists connected serials).
 */
import "./lib/cli-guard.js";
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
  name: "vrc-exchange:witnessed:android-only:didcomm-v2",
  useDidCommV2: true,
});
