/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended, hardware-
 * attested): an Android phone paired with an iPhone by default, or a second
 * physical Android phone instead (no macOS/Xcode needed). Flow lives in
 * lib/witnessedExchangeFlow.js — see that file's header for the phase
 * breakdown; this script only wires up device discovery, the two sessions,
 * and the flag env vars below.
 *
 * Same hardware-attested exchange as run-vrc-exchange-devices.js, but both
 * wallets first connect to a locally-run witness server, so the exchange
 * auto-routes through the witness and each wallet ends up with a Verifiable
 * Witness Credential (VWC) in addition to the peer VRC.
 *
 * ATTENDED: satisfy the OS biometric/PIN prompts at the OPERATOR banners on
 * BOTH phones. The witness runs behind a cloudflared HTTPS tunnel, so no
 * shared LAN is needed between the phones and the machine running this
 * script.
 *
 * Usage: yarn e2e:vrc:witnessed:devices from repo root (or npm run
 * vrc-exchange:witnessed:devices from here), one script for every real-device
 * witnessed pairing/flag combination this flow supports — there is no
 * separate `:android-only` yarn command:
 *
 *   yarn e2e:vrc:witnessed:devices                          # android + iPhone (default)
 *
 *   DEVICE_PLATFORMS=android,android yarn e2e:vrc:witnessed:devices  — two
 *   physical Android phones instead of an Android + iPhone pair. No
 *   macOS/Xcode needed. Two PHYSICAL phones are required, not emulators: the
 *   whole point of this test is hardware-attested witnessing (TEE-backed keys
 *   + BiometricPrompt on both sides), and emulators cannot do hardware
 *   attestation (see e2e/README.md) — an emulator pair would silently fall
 *   back to a plain, unattested exchange. Both phones connected over USB are
 *   auto-detected; if more or fewer than two are found, set ANDROID_UDID and
 *   ANDROID_UDID2 to pick them explicitly (`adb devices` lists connected
 *   serials).
 *
 *   E2E_DIDCOMM_V2=1 yarn e2e:vrc:witnessed:devices — the wallet-to-wallet
 *   connection is DIDComm v2 (OOB 2.0, Coordinate Mediation 2.0) instead of
 *   the default v1 connection; the witness serves v1+v2 and replies on
 *   whichever carriage it received. Works with either DEVICE_PLATFORMS
 *   pairing. Physical phones can't reach 10.0.2.2, so the mediator needs
 *   tunnel mode (`yarn mediator --didcomm-v2`, requires cloudflared), and the
 *   Android debug APK must be rebuilt (`cd app/android && ./gradlew
 *   :app:assembleDebug`) after that mediator run writes app/.env's
 *   MEDIATOR_V2_URL — restarting Metro alone does not pick up the new value
 *   (see e2e/README.md and docs/E2E_REAL_DEVICE_FLAKINESS.md).
 *
 *   E2E_TSP=1 yarn e2e:vrc:witnessed:devices — the wallet-to-wallet Trust
 *   Task documents (discovery/propose/issue) are carried over the real TSP
 *   envelope stack instead of the default DIDComm-v1 binding. The
 *   wallet-to-WITNESS protocol is a separate channel (plain DIDComm basic
 *   messages) and is unaffected either way. Works standalone — unlike the
 *   iOS-devices witnessed runner's TSP variant, this does NOT require
 *   E2E_DIDCOMM_V2 too (that's a deliberate, pre-existing difference between
 *   the two runners, kept as-is here). Combine with E2E_DIDCOMM_V2=1 to carry
 *   TSP over the v2 connection instead of v1.
 *
 *   DEVICE_PLATFORMS=android,android E2E_LOCALITY=required \
 *     yarn e2e:vrc:witnessed:devices — additionally REQUIRES LOCALITY (BLE
 *   co-presence): the witness refuses to issue a VWC unless BOTH phones'
 *   co-presence is confirmed over BLE, and the run asserts both were actually
 *   CONFIRMED, not merely attempted. android,android ONLY — only the Android
 *   BLE peripheral has been verified end to end so far; the android+iPhone
 *   pairing has no proven "required" variant to preserve, and the
 *   android+iPhone "offered"/reported locality flow (each side's outcome
 *   reported rather than gated on) is a deliberately separate script,
 *   run-vrc-exchange-witnessed-locality-devices.js — left untouched, don't
 *   fold it in here. **The machine running this script needs a real
 *   Bluetooth adapter** when E2E_LOCALITY is set. ATTENDED: also grant the
 *   Bluetooth permission prompt on each phone when it appears.
 *
 *   E2E_MEDIATOR=1 yarn e2e:vrc:witnessed:devices — the witness runs in
 *   MEDIATOR mode (shared production mediator, WebSocket + message pickup)
 *   instead of its default DIRECT mode (its own HTTPS tunnel). Orthogonal to
 *   DEVICE_PLATFORMS — allowed for either pairing, even though only the
 *   android-only pairing had a proven mediator-mode variant before this port
 *   (kept available for android+iPhone too since mediator-vs-direct is a
 *   witness-transport concern, not a device-pairing one). The mediator
 *   invitation defaults to app/.env's own MEDIATOR_URL; override with
 *   WITNESS_MEDIATOR_INVITATION_URL.
 *
 * Flags compose, e.g.:
 *   DEVICE_PLATFORMS=android,android E2E_DIDCOMM_V2=1 E2E_TSP=1 E2E_LOCALITY=required \
 *     yarn e2e:vrc:witnessed:devices
 *
 * Env overrides: DEVICE_PLATFORMS, E2E_DIDCOMM_V2, E2E_TSP, E2E_LOCALITY,
 * E2E_MEDIATOR, WITNESS_MEDIATOR_INVITATION_URL, ANDROID_UDID, ANDROID_UDID2
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
  resolveWitnessMediatorInvitationUrl,
} from "./lib/config.js";
import {
  detectAndroidUdid,
  detectIosUdid,
  detectTwoAndroidUdids,
  ensureLockScreenEnabled,
} from "./lib/deviceDiscovery.js";
import { resolveDevicePlatforms } from "./lib/devicePairingPrompt.js";
import { runWitnessedExchange, dumpAndroidWitnessLogs } from "./lib/witnessedExchangeFlow.js";

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
const useTspCarriage = process.env.E2E_TSP === "1";
const useMediator = process.env.E2E_MEDIATOR === "1";

const localityEnv = process.env.E2E_LOCALITY;
if (localityEnv && !bothAndroid) {
  console.error(
    'E2E_LOCALITY is only supported with DEVICE_PLATFORMS=android,android — there is no proven ' +
      '"required" locality variant for the android+iPhone pairing. For android+iPhone locality, use ' +
      "run-vrc-exchange-witnessed-locality-devices.js (offered/reported semantics, deliberately separate)."
  );
  process.exit(1);
}
if (localityEnv && localityEnv !== "required") {
  console.error(`E2E_LOCALITY must be "required" (got: "${localityEnv}").`);
  process.exit(1);
}
const assertLocality = localityEnv === "required";
if (assertLocality) {
  // WITNESS_LOCALITY_POLICY drives both the Trust Tasks discovery answer
  // (what makes the app's witness-connect pre-flight sheet show at all —
  // startWitness defaults this to "off" otherwise) and the witness's own BLE
  // sensor startup; WITNESS_LOCALITY_REQUIRED is the separate, legacy
  // basic-message-ceremony gate. Both must be set before runWitnessedExchange
  // calls startWitness below (it reads them from process.env at call time).
  process.env.WITNESS_LOCALITY_POLICY = "required";
  process.env.WITNESS_LOCALITY_REQUIRED = "true";
}

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

if (useMediator) {
  // Fail fast, before touching devices, if there's no mediator invitation to use.
  process.env.WITNESS_MEDIATOR_INVITATION_URL = resolveWitnessMediatorInvitationUrl();
  console.log("[e2e] witness will run in MEDIATOR mode");
}

let udidA, udidB;
if (bothAndroid) {
  ({ a: udidA, b: udidB } = detectTwoAndroidUdids());
  console.log(`[e2e] android devices: ${udidA}, ${udidB}`);
  // Lock-screen check is android-only-specific: historically only these two
  // phones ever got it (the android+iPhone pairing below never has), so that
  // asymmetry is preserved here rather than added to a device that never had
  // this check before.
  ensureLockScreenEnabled(udidA);
  ensureLockScreenEnabled(udidB);
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

const flagParts = [];
if (useDidCommV2) flagParts.push("didcomm-v2");
if (useTspCarriage) flagParts.push("tsp");
if (assertLocality) flagParts.push("locality");
if (useMediator) flagParts.push("mediator");
const name = `vrc-exchange:witnessed:devices (${platforms.join(",")}${flagParts.length ? " " + flagParts.join(",") : ""})`;

await runWitnessedExchange({
  detectDevices: () => ({ a: udidA, b: udidB }),
  createSessionA: (udid) => createSession("android", androidDeviceCaps(udid)),
  createSessionB: bothAndroid
    ? (udid) => createSession("android", androidDeviceCaps(udid))
    : (udid) => createSession("ios", iosDeviceCaps(udid)),
  // android-only: both udids are android, dump both. android+ios: only udidA
  // is android — an iOS udid isn't reachable via `adb logcat`.
  dumpWitnessLogs: bothAndroid
    ? (udids) => dumpAndroidWitnessLogs(udids)
    : () => dumpAndroidWitnessLogs([udidA]),
  name,
  useDidCommV2,
  useTspCarriage,
  assertLocality,
});
