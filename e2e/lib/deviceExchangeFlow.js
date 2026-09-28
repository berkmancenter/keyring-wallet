// Shared PLAIN (non-witnessed) two-wallet VRC exchange flow on REAL DEVICES
// (attended, hardware-attested):
//
//   fresh install → onboarding on both devices → enableHardwareAttestation →
//   optionally DIDComm v2 (enableDidCommV2 + assertV2MediationMarker) →
//   wallet A generates a relationship invitation → wallet B pastes it →
//   v4 consent → both wallets end up holding a Verifiable Relationship
//   Credential → the Trust Task crypto gates (+ DIDComm v2 carriage markers
//   when applicable) → each receiver's Secure Exchange badge.
//
// Device discovery and session creation are injected by the caller — nothing
// here depends on which platform(s) the two sessions are on. See
// run-vrc-exchange-devices.js, which wires this up for the default
// android+iPhone pairing (DEVICE_PLATFORMS=android,ios) and the android-only
// pairing (DEVICE_PLATFORMS=android,android), optionally over DIDComm v2
// (E2E_DIDCOMM_V2=1).
import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";

import { ensureAppium, stopAppium, screenshot, dumpSource, sleep, deviceTag } from "./driver.js";
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
} from "./flows.js";
import { printSuccess, printFailure } from "./banner.js";

const IDENTITY_A = { firstName: "Alice", lastName: "Anderson" };
const IDENTITY_B = { firstName: "Bob", lastName: "Baker" };

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
}

let metroProc;
async function ensureMetro() {
  if (await portInUse(8081)) {
    console.log("[e2e] metro already running on :8081");
    return;
  }
  console.log("[e2e] starting metro (yarn start in app/)…");
  const artifactsDir = new URL("../artifacts", import.meta.url).pathname;
  mkdirSync(artifactsDir, { recursive: true });
  const metroLog = `${artifactsDir}/metro-${Date.now()}.log`;
  metroProc = spawn("sh", ["-c", 'exec yarn start > "$METRO_LOG" 2>&1'], {
    cwd: new URL("../../app", import.meta.url).pathname,
    env: { ...process.env, METRO_LOG: metroLog },
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log(`[e2e] metro log: ${metroLog}`);
  for (let i = 0; i < 60; i++) {
    if (await portInUse(8081)) return;
    await sleep(1000);
  }
  throw new Error("metro did not start within 60s");
}

/**
 * Filter + save the attestation-relevant logcat lines for one or more android
 * udids, plus slim issued-credential JSON dumps (PEMs already omitted
 * in-app). Pass just the android udid(s) out of a pairing — an iOS udid
 * isn't reachable via `adb logcat`, and passing it in here would just log a
 * spurious "logcat capture failed" warning for it.
 */
export function dumpAndroidAttestationLogs(udids) {
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

/** "android x2" / "android + ios" — a human-readable count-and-type summary. */
function summarizePlatforms(platforms) {
  const counts = platforms.reduce((m, p) => ((m[p] = (m[p] || 0) + 1), m), {});
  return Object.entries(counts)
    .map(([platform, n]) => (n > 1 ? `${platform} x${n}` : platform))
    .join(" + ");
}

/** iOS has no logcat — its attestation evidence is read from the app's own syslog. */
export async function dumpIosAttestationLogs(driver) {
  try {
    const logs = await driver.getLogs("syslog");
    const lines = logs
      .map((l) => (typeof l === "string" ? l : l.message || ""))
      .filter((l) => /VRC:|Attestation|AppAttest/i.test(l));
    mkdirSync("artifacts", { recursive: true });
    const file = `artifacts/attestation-syslog-${Date.now()}.txt`;
    writeFileSync(file, lines.join("\n"));
    console.log(`[e2e] ios attestation log lines saved: ${file} (${lines.length} lines)`);
  } catch (e) {
    console.warn(`[e2e] ios syslog capture failed (non-fatal): ${e.message}`);
  }
}

/**
 * Run the full plain (non-witnessed) hardware-attested exchange flow.
 *
 * @param {object} opts
 * @param {() => { a: string, b: string }} opts.detectDevices - returns the
 *   two device identifiers (UDIDs) to use for session A and session B.
 * @param {(udid: string) => Promise<import('webdriverio').Browser>} opts.createSessionA
 * @param {(udid: string) => Promise<import('webdriverio').Browser>} opts.createSessionB
 * @param {(udids: string[]) => void} opts.dumpAttestationLogs - given the
 *   `[udidA, udidB]` this run used, saves whatever android diagnostic logs
 *   are available. Use the exported `dumpAndroidAttestationLogs` helper for
 *   whichever udids are actually Android devices (ignore the rest — e.g. an
 *   iOS udid isn't reachable via `adb logcat`). Called on both success and
 *   failure, same as `dumpWitnessLogs` in the witnessed flow.
 * @param {(driver: import('webdriverio').Browser) => Promise<void>} [opts.dumpIosLogs] -
 *   optional, called ONLY on success (matching the original devices runner):
 *   pass `dumpIosAttestationLogs` bound to whichever session is the real
 *   iPhone. Omit entirely for an all-Android pairing.
 * @param {string} opts.name - banner name, matching the invoking script's
 *   `DEVICE_PLATFORMS`/flag combination (e.g. "vrc-exchange:devices
 *   (android,android didcomm-v2)").
 * @param {boolean} [opts.useDidCommV2] - both wallets turn on the "Enable
 *   DIDComm v2" developer setting and exchange over an out-of-band/2.0
 *   invitation instead of the default DIDComm-v1 connection.
 * @param {string[]} opts.platforms - `["android", "ios"]`-style pairing shape
 *   (as passed to `DEVICE_PLATFORMS`), used only to print the final
 *   device-type/count summary line — never to brand or gate anything.
 */
export async function runDeviceExchange({
  detectDevices,
  createSessionA,
  createSessionB,
  dumpAttestationLogs,
  dumpIosLogs,
  name,
  useDidCommV2 = false,
  platforms,
}) {
  let sessionA, sessionB;
  let udidA, udidB;
  try {
    ({ a: udidA, b: udidB } = detectDevices());
    console.log(`[e2e] device A: ${udidA}, device B: ${udidB}`);

    await ensureMetro();
    await ensureAppium();

    console.log(
      `\n[e2e] ATTENDED RUN${useDidCommV2 ? " (DIDComm v2)" : ""} — keep both phones unlocked and within reach.\n` +
        "[e2e] A relationship proposal appears on one phone (auto-accepted); then\n" +
        "[e2e] satisfy the BIOMETRIC prompt on EACH phone when the OPERATOR banner\n" +
        "[e2e] appears in this console.\n"
    );

    sessionA = await createSessionA(udidA);
    sessionB = await createSessionB(udidB);

    await Promise.all([
      completeOnboarding(sessionA, IDENTITY_A),
      completeOnboarding(sessionB, IDENTITY_B),
    ]);

    // Hardware attestation is OFF by default — without it no evidence is
    // attached and the Secure Exchange banner can never show.
    await Promise.all([
      enableHardwareAttestation(sessionA),
      enableHardwareAttestation(sessionB),
    ]);

    if (useDidCommV2) {
      // Both sides: the inviter needs v2 to mint an OOB 2.0 invitation, the
      // invitee needs v2 to accept one (a v1-only agent rejects it outright).
      // Restarts each app — attestation's persisted preference survives that.
      await Promise.all([enableDidCommV2(sessionA), enableDidCommV2(sessionB)]);
      // Mediation 2.0 must be granted before the invitation is minted, or the
      // invitation routes unmediated and the mediated claim below is hollow.
      await Promise.all([assertV2MediationMarker(sessionA), assertV2MediationMarker(sessionB)]);
    }

    const invitationUrl = await showRelationshipInvitation(sessionA);
    if (useDidCommV2 && !/[?&]_oob=/.test(invitationUrl)) {
      throw new Error(`expected an out-of-band/2.0 invitation (_oob=), got: ${invitationUrl.slice(0, 80)}…`);
    }
    await acceptInvitationViaPaste(sessionB, invitationUrl);

    // v4 consent: one bottom-sheet on the non-proposer wallet, no
    // per-credential offers — both signed VRCs then flow automatically as
    // trust tasks. The biometric prompts fire during the signed delivery
    // that follows consent.
    await acceptRelationshipProposalOnEitherSide(sessionA, sessionB);

    await Promise.all([
      assertVrcReceived(sessionA, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`),
      assertVrcReceived(sessionB, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`),
    ]);

    // The crypto gates, from Android's run-scoped logcat (covers both
    // directions of the exchange; iOS has no logcat path).
    await Promise.all([
      assertTrustTaskExchangeMarkers(sessionA),
      assertTrustTaskExchangeMarkers(sessionB),
      ...(useDidCommV2
        ? [assertDidCommV2CarriageMarkers(sessionA), assertDidCommV2CarriageMarkers(sessionB)]
        : []),
    ]);

    // Each receiver REQUIRES the Secure Exchange badge (peer evidence
    // chain-validated on-device) — the device-attestation gate this test
    // exists to prove, now over the v2 connection when useDidCommV2 is set.
    await assertSecureExchangeBadge(sessionA, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`);
    await assertSecureExchangeBadge(sessionB, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`);

    printSuccess(name);
    process.exitCode = 0;

    dumpAttestationLogs([udidA, udidB].filter(Boolean));
    if (dumpIosLogs) await dumpIosLogs(sessionB);
  } catch (err) {
    printFailure(name, err);
    for (const d of [sessionA, sessionB].filter(Boolean)) {
      try {
        await screenshot(d, "failure");
        await dumpSource(d, "failure");
      } catch {
        /* session may be dead */
      }
    }
    try {
      const { a: udidA, b: udidB } = detectDevices();
      dumpAttestationLogs([udidA, udidB].filter(Boolean));
    } catch {
      /* best-effort */
    }
    process.exitCode = 1;
  } finally {
    for (const d of [sessionA, sessionB].filter(Boolean)) {
      try {
        await d.deleteSession();
      } catch {
        /* already gone */
      }
    }
    if (metroProc) metroProc.kill("SIGTERM");
    stopAppium();

    // Last line of the run, on purpose: attestation log dumps above can be
    // long, so this is the one line — after everything else — that says
    // what actually ran (device types, how many of each) and whether it passed.
    const tags = [sessionA, sessionB].filter(Boolean).map(deviceTag);
    const devices = tags.length ? tags.join(", ") : [udidA, udidB].filter(Boolean).join(", ") || "unknown";
    console.log(
      `[e2e] ${process.exitCode === 0 ? "PASSED" : "FAILED"} — devices: ${summarizePlatforms(platforms)} (${devices})`
    );
  }
}
