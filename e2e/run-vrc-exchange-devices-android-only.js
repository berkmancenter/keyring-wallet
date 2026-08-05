/**
 * Two-wallet VRC exchange on REAL DEVICES (attended), Android-only: two
 * physical Android phones instead of a physical Android phone + iPhone pair.
 * No macOS/Xcode needed. Same hardware-attested exchange as
 * run-vrc-exchange-devices.js — this script only swaps the iPhone for a
 * second physical Android phone.
 *
 * Two PHYSICAL phones are required, not emulators: the whole point of this
 * test is hardware-attested signing (TEE-backed keys + BiometricPrompt on
 * both sides), and emulators cannot do hardware attestation (see
 * e2e/README.md) — an emulator pair would silently fall back to a plain,
 * unattested exchange.
 *
 * ATTENDED: a human operator must satisfy the OS biometric/PIN prompts —
 * watch the console for the "OPERATOR: authenticate on ..." banners
 * (roughly twice per device: once per issuance direction).
 *
 * Usage:
 *   node run-vrc-exchange-devices-android-only.js
 *   (or: yarn e2e:vrc:devices:android-only from repo root)
 *
 * Both phones connected over USB are auto-detected; if more or fewer than
 * two are found, set ANDROID_UDID and ANDROID_UDID2 to pick them explicitly
 * (`adb devices` lists connected serials).
 */
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
  acceptCredentialOfferFromChat,
  acceptInvitationViaPaste,
  assertVrcReceived,
  completeOnboarding,
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

      // Extract slim issued-credential JSON dumps (PEMs already omitted in-app).
      let n = 0;
      for (const line of raw.split("\n")) {
        const marker = "[VRC:IssuedCredentialJSON]";
        const idx = line.indexOf(marker);
        if (idx < 0) continue;
        const payload = line.slice(idx + marker.length).trim();
        // payload: side=… exchange=… record=… {json}
        const jsonStart = payload.indexOf("{");
        if (jsonStart < 0) continue;
        const meta = payload.slice(0, jsonStart).trim();
        const side = (meta.match(/side=(\w+)/) || [])[1] || "unknown";
        try {
          const obj = JSON.parse(payload.slice(jsonStart));
          const types = (obj.type || []).join("-") || "credential";
          const out = `artifacts/issued-credential-${udid}-${side}-${types}-${Date.now()}-${n++}.json`;
          writeFileSync(out, JSON.stringify(obj, null, 2));
          console.log(`[e2e] issued credential dump: ${out}`);
          if (obj.proof) {
            console.log(
              `[e2e]   proof.type=${obj.proof.type} proofPurpose=${obj.proof.proofPurpose}`
            );
          }
        } catch (e) {
          console.warn(`[e2e] could not parse IssuedCredentialJSON: ${e.message}`);
        }
      }
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
    "\n[e2e] ATTENDED RUN — keep both phones unlocked and within reach.\n" +
      "[e2e] You will be asked to authenticate (biometric or device PIN) when\n" +
      "[e2e] the OPERATOR banner appears in this console.\n"
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

  const invitationUrl = await showRelationshipInvitation(android);
  await acceptInvitationViaPaste(android2, invitationUrl);

  // Bidirectional exchange. expectAttestation makes each receiver REQUIRE the
  // Secure Exchange banner (peer evidence chain-validated on-device).
  // Longer timeout than emulators: two hardware signings + human auth in the loop.
  await Promise.all([
    acceptCredentialOfferFromChat(android, 600000, { expectAttestation: true }),
    acceptCredentialOfferFromChat(android2, 600000, { expectAttestation: true }),
  ]);

  await Promise.all([
    assertVrcReceived(android, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`),
    assertVrcReceived(android2, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`),
  ]);

  printSuccess("vrc-exchange:devices:android-only");
  process.exitCode = 0;

  dumpAndroidAttestationLogs([udidA, udidB]);
} catch (err) {
  printFailure("vrc-exchange:devices:android-only", err);
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
