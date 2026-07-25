// Shared WITNESSED two-wallet VRC exchange flow (attended, hardware-attested):
//
//   start witness (HTTPS tunnel) → fresh installs → onboarding → both wallets
//   connect to the witness → invitation → bidirectional, hardware-attested,
//   witnessed VRC exchange → assert VRC + VWC (Verifiable Witness Credential)
//   on both.
//
// Device discovery and session creation are injected by the caller — nothing
// here depends on which platform(s) the two sessions are on. See
// run-vrc-exchange-witnessed-devices.js (Android + iPhone) and
// run-vrc-exchange-witnessed-android-only-devices.js (two Android phones).
import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";

import { ensureAppium, stopAppium, screenshot, dumpSource, sleep } from "./driver.js";
import {
  acceptCredentialOfferFromChat,
  acceptInvitationViaPaste,
  assertVrcReceived,
  assertContactShields,
  completeOnboarding,
  connectToWitness,
  enableHardwareAttestation,
  showRelationshipInvitation,
} from "./flows.js";
import { startWitness } from "./witness.js";

const WITNESS_NAME = process.env.WITNESS_NAME || "e2e-witness";
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
  metroProc = spawn("yarn", ["start"], {
    cwd: new URL("../../app", import.meta.url).pathname,
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 60; i++) {
    if (await portInUse(8081)) return;
    await sleep(1000);
  }
  throw new Error("metro did not start within 60s");
}

/** Filter + save the witness/attestation-relevant logcat lines for one or more android udids. */
export function dumpAndroidWitnessLogs(udids) {
  for (const udid of udids) {
    try {
      mkdirSync("artifacts", { recursive: true });
      const raw = execSync(`adb -s ${udid} logcat -d`, { maxBuffer: 64 * 1024 * 1024 }).toString();
      const lines = raw
        .split("\n")
        .filter((l) => /VRC:|Attestation|BiometricSignature|Witness|VWC|proofType|cryptosuite/i.test(l));
      const file = `artifacts/witnessed-logcat-${udid}-${Date.now()}.txt`;
      writeFileSync(file, lines.join("\n"));
      console.log(`[e2e] android (${udid}) witnessed log lines saved: ${file} (${lines.length} lines)`);
      // Surface any DI proof lines for the VWC/VRC
      for (const l of lines) {
        if (/proofType=DataIntegrityProof|cryptosuite/i.test(l)) {
          console.log(`[e2e]   ${l.replace(/^.*ReactNativeJS:\s*/, "").trim().slice(0, 140)}`);
        }
      }
    } catch (e) {
      console.warn(`[e2e] logcat capture failed for ${udid} (non-fatal): ${e.message}`);
    }
  }
}

/**
 * Run the full witnessed + hardware-attested exchange flow.
 *
 * @param {object} opts
 * @param {() => { a: string, b: string }} opts.detectDevices - returns the
 *   two device identifiers (UDIDs) to use for session A and session B.
 * @param {(udid: string) => Promise<import('webdriverio').Browser>} opts.createSessionA
 * @param {(udid: string) => Promise<import('webdriverio').Browser>} opts.createSessionB
 * @param {(udids: string[]) => void} opts.dumpWitnessLogs - given the
 *   `[udidA, udidB]` this run used, saves whatever diagnostic logs are
 *   available. Use the exported `dumpAndroidWitnessLogs` helper for
 *   whichever udids are actually Android devices (ignore the rest — e.g. an
 *   iOS udid isn't reachable via `adb logcat`).
 */
export async function runWitnessedExchange({
  detectDevices,
  createSessionA,
  createSessionB,
  dumpWitnessLogs: dumpLogs,
}) {
  let sessionA, sessionB, witness;
  try {
    const { a: udidA, b: udidB } = detectDevices();
    console.log(`[e2e] device A: ${udidA}, device B: ${udidB}`);

    await ensureMetro();
    await ensureAppium();

    // The witness runs in direct mode behind a cloudflared HTTPS tunnel: the app
    // blocks cleartext http, and production witnesses are HTTPS (real mediators
    // like aaleon have SSL). The tunnel mirrors that locally without the
    // instability of routing the witness through the app's mediator.
    witness = await startWitness({ name: WITNESS_NAME });

    console.log(
      "\n[e2e] ATTENDED WITNESSED RUN — keep both phones unlocked and within reach.\n" +
        "[e2e] Witness is reachable via an HTTPS tunnel; no LAN needed.\n" +
        "[e2e] Authenticate at the OPERATOR banners.\n"
    );

    sessionA = await createSessionA(udidA);
    sessionB = await createSessionB(udidB);

    await Promise.all([
      completeOnboarding(sessionA, IDENTITY_A),
      completeOnboarding(sessionB, IDENTITY_B),
    ]);

    await Promise.all([
      enableHardwareAttestation(sessionA),
      enableHardwareAttestation(sessionB),
    ]);

    // Both wallets connect to the witness FIRST — if either isn't connected when
    // the exchange starts, the 15s session-challenge timeout fires and the
    // exchange silently falls back to direct (no VWC). Confirm BOTH connections
    // completed via the witness's own log (no "connected" banner exists in the
    // app — witness participation only surfaces as a VWC after the exchange).
    await connectToWitness(sessionA, witness.invitationUrl);
    await connectToWitness(sessionB, witness.invitationUrl);
    await witness.waitForParticipants(2, 120000);
    console.log("[e2e] both wallets connected to the witness");

    const invitationUrl = await showRelationshipInvitation(sessionA);
    await acceptInvitationViaPaste(sessionB, invitationUrl);

    await Promise.all([
      acceptCredentialOfferFromChat(sessionA, 600000, { expectAttestation: true }),
      acceptCredentialOfferFromChat(sessionB, 600000, { expectAttestation: true }),
    ]);

    await Promise.all([
      assertVrcReceived(sessionA, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`),
      assertVrcReceived(sessionB, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`),
    ]);

    // The culminating check: each contact must show BOTH shields together —
    // "Secure Exchange" (device attestation on the DI VRC) AND "Verified" +
    // Witness Records (VWC from the witness). VWC is issued after the VRC, so
    // this polls both.
    await Promise.all([
      assertContactShields(sessionA, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`),
      assertContactShields(sessionB, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`),
    ]);

    console.log(
      "\n[e2e] ✅ WITNESSED + ATTESTED VC 2.0 (eddsa-rdfc-2022) exchange succeeded on both phones —\n" +
        "[e2e]    each contact shows BOTH shields: Secure Exchange (attestation) + Witnessed"
    );
    process.exitCode = 0;

    dumpLogs([udidA, udidB].filter(Boolean));
  } catch (err) {
    console.error("\n[e2e] ❌ FAILED:", err.message);
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
      dumpLogs([udidA, udidB].filter(Boolean));
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
    if (witness) {
      try {
        await witness.stop();
      } catch {
        /* best-effort */
      }
    }
    if (metroProc) metroProc.kill("SIGTERM");
    stopAppium();
  }
}
