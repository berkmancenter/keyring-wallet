/**
 * Two-wallet VRC exchange on REAL DEVICES (attended) — proves hardware
 * attestation + biometric-confirmed signing end to end:
 *
 *   fresh install on a physical Android phone (USB) + a second physical
 *   device (an iPhone by default, or a second Android phone) → onboarding →
 *   invitation → bidirectional VRC exchange where each side signs with its
 *   hardware key (TEE / App Attest) and each receiver chain-validates the
 *   peer's evidence (Google roots / Apple roots). The run FAILS unless BOTH
 *   offer screens show evidence was at least attempted (the "Secure
 *   Exchange" / AttestationVerified banner, or the "Hardware Verification
 *   Issue" / AttestationWarning banner — the latter is tolerated since it
 *   reflects the PHYSICAL DEVICE's attestation root cert validity, not the
 *   app's flow; see docs/HARDWARE_ATTESTATION_FLOW.md "Known limitations"
 *   #5). Only a banner missing entirely fails the run.
 *
 * ATTENDED: a human operator must satisfy the OS biometric/PIN prompts —
 * watch the console for the "OPERATOR: authenticate on ..." banners
 * (roughly twice per device: once per issuance direction).
 *
 * Usage: yarn e2e:vrc:devices from repo root (or npm run vrc-exchange:devices
 * from here), one script for every real-device pairing this flow supports —
 * there is no separate `:android-only` yarn command:
 *
 *   yarn e2e:vrc:devices                                   # android + iPhone (default)
 *
 *   DEVICE_PLATFORMS=android,android yarn e2e:vrc:devices  — two physical
 *   Android phones instead of an Android + iPhone pair. No macOS/Xcode
 *   needed. Two PHYSICAL phones are required, not emulators: the whole point
 *   of this test is hardware-attested signing (TEE-backed keys +
 *   BiometricPrompt on both sides), and emulators cannot do hardware
 *   attestation (see e2e/README.md) — an emulator pair would silently fall
 *   back to a plain, unattested exchange. Both phones connected over USB are
 *   auto-detected; if more or fewer than two are found, set ANDROID_UDID and
 *   ANDROID_UDID2 to pick them explicitly (`adb devices` lists connected
 *   serials).
 *
 *   DEVICE_PLATFORMS=android,android E2E_DIDCOMM_V2=1 yarn e2e:vrc:devices —
 *   the same two-physical-phone hardware attestation, but the connection is
 *   DIDComm v2 (OOB 2.0, did:peer:2, Coordinate Mediation 2.0 + Pickup 4.0)
 *   instead of the default v1 connection. Physical phones can't reach
 *   10.0.2.2, so the mediator needs tunnel mode (`yarn mediator --didcomm-v2`,
 *   no --endpoint, requires cloudflared), and the Android debug APK must be
 *   rebuilt (`cd app/android && ./gradlew :app:assembleDebug`) after that
 *   mediator run writes app/.env — restarting Metro alone does not pick up a
 *   new MEDIATOR_V2_URL, since react-native-config bakes it into the native
 *   BuildConfig at Gradle build time, not at bundle time (see e2e/README.md
 *   and the mediator-server README's "Which --endpoint" section).
 *
 * Env overrides: DEVICE_PLATFORMS, E2E_DIDCOMM_V2, ANDROID_UDID, ANDROID_UDID2
 * (android,android only), IOS_UDID, IOS_TEAM_ID, IOS_DEVICE_APP, ANDROID_APK.
 * If DEVICE_PLATFORMS is unset and this is run from a real terminal with
 * more than one pairing physically attached (e.g. 2 Android phones + an
 * iPhone), it prompts interactively instead of guessing — set the env var
 * to skip the prompt (required for CI/scripted runs; it's used automatically
 * whenever stdin isn't a TTY).
 * Prerequisites + build commands: see e2e/README.md ("Real devices").
 */
import "./lib/cli-guard.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { createSession } from "./lib/driver.js";
import {
  ANDROID_APK,
  IOS_DEVICE_APP,
  androidDeviceCaps,
  iosDeviceCaps,
} from "./lib/config.js";
import { detectAndroidUdid, detectIosUdid, detectTwoAndroidUdids } from "./lib/deviceDiscovery.js";
import { resolveDevicePlatforms } from "./lib/devicePairingPrompt.js";
import {
  runDeviceExchange,
  dumpAndroidAttestationLogs,
  dumpIosAttestationLogs,
} from "./lib/deviceExchangeFlow.js";

// ---------- platform selection ----------

const platforms = await resolveDevicePlatforms();
if (platforms.length !== 2 || platforms[0] !== "android" || (platforms[1] !== "android" && platforms[1] !== "ios")) {
  console.error(
    'DEVICE_PLATFORMS must be "android,ios" (default) or "android,android" — ' +
      "wallet A is always the physical Android phone; a two-iPhone pairing isn't supported by this runner."
  );
  process.exit(1);
}
const bothAndroid = platforms[1] === "android";
const useDidCommV2 = process.env.E2E_DIDCOMM_V2 === "1";

// ---------- preflight ----------

function preflight() {
  if (!existsSync(ANDROID_APK)) {
    throw new Error(
      `Android APK not found: ${ANDROID_APK}\n  Build it: cd app/android && ./gradlew assembleDebug`
    );
  }
  if (!bothAndroid && !existsSync(IOS_DEVICE_APP)) {
    throw new Error(
      `iOS device build not found: ${IOS_DEVICE_APP}\n  Build it (see e2e/README.md "Real devices" for the full command).`
    );
  }
}

// ---------- run ----------

preflight();

let udidA, udidB;
if (bothAndroid) {
  ({ a: udidA, b: udidB } = detectTwoAndroidUdids());
  console.log(`[e2e] android devices: ${udidA}, ${udidB}`);
  for (const udid of [udidA, udidB]) {
    try {
      execSync(`adb -s ${udid} logcat -c`);
    } catch {
      /* non-fatal */
    }
  }
  console.log("[e2e] cleared android logcat");
} else {
  udidA = detectAndroidUdid();
  udidB = detectIosUdid();
  console.log(`[e2e] android device: ${udidA}`);
  try {
    execSync(`adb -s ${udidA} logcat -c`);
    console.log("[e2e] cleared android logcat");
  } catch {
    /* non-fatal */
  }
}

const name = `vrc-exchange:devices (${platforms.join(",")}${useDidCommV2 ? " didcomm-v2" : ""})`;

await runDeviceExchange({
  detectDevices: () => ({ a: udidA, b: udidB }),
  createSessionA: (udid) => createSession("android", androidDeviceCaps(udid)),
  createSessionB: bothAndroid
    ? (udid) => createSession("android", androidDeviceCaps(udid))
    : (udid) => createSession("ios", iosDeviceCaps(udid)),
  // android-only: both udids are android, dump both. android+ios: only udidA
  // is android — an iOS udid isn't reachable via `adb logcat`.
  dumpAttestationLogs: bothAndroid
    ? (udids) => dumpAndroidAttestationLogs(udids)
    : () => dumpAndroidAttestationLogs([udidA]),
  // iOS syslog dump only applies (and is only attempted, on success) for the
  // android+iPhone pairing.
  dumpIosLogs: bothAndroid ? undefined : (driver) => dumpIosAttestationLogs(driver),
  name,
  useDidCommV2,
  platforms,
});
