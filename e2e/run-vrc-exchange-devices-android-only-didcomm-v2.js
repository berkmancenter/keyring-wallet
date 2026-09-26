/**
 * Two-wallet VRC exchange on REAL DEVICES (attended), Android-only, over
 * DIDComm v2: the same hardware-attested exchange as
 * run-vrc-exchange-devices-android-only.js, but both wallets turn on the
 * "Enable DIDComm v2" developer setting, provision Coordinate Mediation 2.0
 * with the build's MEDIATOR_V2_URL, and exchange over an out-of-band/2.0
 * invitation on did:peer:2 instead of the default DIDComm-v1 connection.
 *
 * What it proves beyond run-vrc-exchange-devices-android-only.js: the
 * DIDComm v2 stack (OOB 2.0, did:peer:2, ECDH-1PU envelopes, Coordinate
 * Mediation 2.0 + Pickup 4.0) carries a REAL hardware-attested signature
 * (TEE-backed key + BiometricPrompt) end to end on physical hardware, not
 * just the emulator pair run-vrc-exchange-didcomm-v2.js covers. Not an
 * ecosystem-interop claim: the mediator is Keyring's own mediator-server in
 * v2 mode.
 *
 * Two PHYSICAL phones are required, not emulators — same reasoning as
 * run-vrc-exchange-devices-android-only.js (see e2e/README.md).
 *
 * Physical phones can't reach `10.0.2.2`: the mediator needs tunnel mode
 * (`yarn mediator --didcomm-v2`, no `--endpoint`, requires `cloudflared`),
 * and the Android debug APK must be rebuilt (`cd app/android && ./gradlew
 * :app:assembleDebug`) after that mediator run writes app/.env — restarting
 * Metro alone does not pick up a new MEDIATOR_V2_URL, since react-native-config
 * bakes it into the native BuildConfig at Gradle build time, not at bundle
 * time (see e2e/README.md and the mediator-server README's "Which
 * --endpoint" section).
 *
 * ATTENDED: a human operator must satisfy the OS biometric/PIN prompts —
 * watch the console for the "OPERATOR: authenticate on ..." banners.
 *
 * Usage:
 *   node run-vrc-exchange-devices-android-only-didcomm-v2.js
 *   (or: yarn e2e:vrc:devices:android-only:didcomm-v2 from repo root)
 *
 * Both phones connected over USB are auto-detected; if more or fewer than
 * two are found, set ANDROID_UDID and ANDROID_UDID2 to pick them explicitly
 * (`adb devices` lists connected serials).
 */
import "./lib/cli-guard.js";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";

import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
  sleep,
} from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertDidCommV2CarriageMarkers,
  assertSecureExchangeBadge,
  assertTrustTaskExchangeMarkers,
  assertV2MediationMarker,
  assertVrcReceived,
  completeOnboarding,
  enableDidCommV2,
  enableHardwareAttestation,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { ANDROID_APK, ANDROID_UDID, ANDROID_UDID2, androidDeviceCaps } from "./lib/config.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const IDENTITY_A = { firstName: "Alice", lastName: "Anderson" };
const IDENTITY_B = { firstName: "Bob", lastName: "Baker" };

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

// ---------- preflight ----------

function preflight() {
  if (!existsSync(ANDROID_APK)) {
    throw new Error(
      `Android APK not found: ${ANDROID_APK}\n  Build it: cd app/android && ./gradlew assembleDebug`
    );
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
}

let metroProc;
async function ensureMetro() {
  // both debug APKs load JS from metro on this machine via `adb reverse`
  if (await portInUse(8081)) {
    console.log("[e2e] metro already running on :8081");
    return;
  }
  console.log("[e2e] starting metro (yarn start in app/)…");
  metroProc = spawn("yarn", ["start"], {
    cwd: new URL("../app", import.meta.url).pathname,
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 60; i++) {
    if (await portInUse(8081)) return;
    await sleep(1000);
  }
  throw new Error("metro did not start within 60s");
}

// ---------- attestation log evidence ----------

/** Filter + save the attestation-relevant logcat lines for one or more android udids. */
function dumpAndroidAttestationLogs(udids) {
  for (const udid of udids) {
    try {
      mkdirSync("artifacts", { recursive: true });
      const raw = execSync(`adb -s ${udid} logcat -d`, {
        maxBuffer: 64 * 1024 * 1024,
      }).toString();
      const lines = raw
        .split("\n")
        .filter((l) => /VRC:|Attestation|BiometricSignature|GoogleAttestation/i.test(l));
      const file = `artifacts/attestation-logcat-${udid}-${Date.now()}.txt`;
      writeFileSync(file, lines.join("\n"));
      console.log(`[e2e] android (${udid}) attestation log lines saved: ${file} (${lines.length} lines)`);
    } catch (e) {
      console.warn(`[e2e] logcat capture failed for ${udid} (non-fatal): ${e.message}`);
    }
  }
}

// ---------- run ----------

let android, android2;
try {
  preflight();
  const { a: udidA, b: udidB } = detectTwoAndroidUdids();
  console.log(`[e2e] android devices: ${udidA}, ${udidB}`);

  for (const udid of [udidA, udidB]) {
    try {
      execSync(`adb -s ${udid} logcat -c`);
    } catch {
      /* non-fatal */
    }
  }
  console.log("[e2e] cleared android logcat");

  await ensureMetro();
  await ensureAppium();

  console.log(
    "\n[e2e] ATTENDED RUN (DIDComm v2) — keep both phones unlocked and within reach.\n" +
      "[e2e] A relationship proposal appears on one phone (auto-accepted); then\n" +
      "[e2e] satisfy the BIOMETRIC prompt on EACH phone when the OPERATOR banner\n" +
      "[e2e] appears in this console.\n"
  );

  android = await createSession("android", androidDeviceCaps(udidA));
  android2 = await createSession("android", androidDeviceCaps(udidB));

  await Promise.all([
    completeOnboarding(android, IDENTITY_A),
    completeOnboarding(android2, IDENTITY_B),
  ]);

  // Hardware attestation is OFF by default — without it no evidence is
  // attached and the Secure Exchange banner can never show.
  await Promise.all([
    enableHardwareAttestation(android),
    enableHardwareAttestation(android2),
  ]);

  // Both sides: the inviter needs v2 to mint an OOB 2.0 invitation, the
  // invitee needs v2 to accept one (a v1-only agent rejects it outright).
  // Restarts each app — attestation's persisted preference survives that.
  await Promise.all([enableDidCommV2(android), enableDidCommV2(android2)]);

  // Mediation 2.0 must be granted before the invitation is minted, or the
  // invitation routes unmediated and the mediated claim below is hollow.
  await Promise.all([assertV2MediationMarker(android), assertV2MediationMarker(android2)]);

  const invitationUrl = await showRelationshipInvitation(android);
  if (!/[?&]_oob=/.test(invitationUrl)) {
    throw new Error(`expected an out-of-band/2.0 invitation (_oob=), got: ${invitationUrl.slice(0, 80)}…`);
  }
  await acceptInvitationViaPaste(android2, invitationUrl);

  // v4 consent: one bottom-sheet on the non-proposer wallet, no per-credential
  // offers — both signed VRCs then flow automatically as trust tasks. The
  // biometric prompts fire during the signed delivery that follows consent.
  await acceptRelationshipProposalOnEitherSide(android, android2);

  await Promise.all([
    assertVrcReceived(android, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`),
    assertVrcReceived(android2, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`),
  ]);

  // The crypto gates, from Android's run-scoped logcat (covers both directions).
  await Promise.all([
    assertTrustTaskExchangeMarkers(android),
    assertTrustTaskExchangeMarkers(android2),
    assertDidCommV2CarriageMarkers(android),
    assertDidCommV2CarriageMarkers(android2),
  ]);

  // Each receiver REQUIRES the Secure Exchange badge (peer evidence
  // chain-validated on-device) — the device-attestation gate this test exists
  // to prove, now over the v2 connection.
  await assertSecureExchangeBadge(android, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`);
  await assertSecureExchangeBadge(android2, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`);

  printSuccess("vrc-exchange:devices:android-only:didcomm-v2");
  process.exitCode = 0;

  dumpAndroidAttestationLogs([udidA, udidB]);
} catch (err) {
  printFailure("vrc-exchange:devices:android-only:didcomm-v2", err);
  for (const d of [android, android2].filter(Boolean)) {
    try {
      await screenshot(d, "failure");
      await dumpSource(d, "failure");
    } catch {
      /* session may be dead */
    }
  }
  try {
    const { a: udidA, b: udidB } = detectTwoAndroidUdids();
    dumpAndroidAttestationLogs([udidA, udidB]);
  } catch {
    /* best-effort */
  }
  process.exitCode = 1;
} finally {
  for (const d of [android, android2].filter(Boolean)) {
    try {
      await d.deleteSession();
    } catch {
      /* already gone */
    }
  }
  if (metroProc) metroProc.kill("SIGTERM");
  stopAppium();
}
