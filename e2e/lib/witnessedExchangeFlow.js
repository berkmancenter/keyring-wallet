// Shared WITNESSED two-wallet VRC exchange flow (attended, hardware-attested),
// on the Trust Task dialect (§9 step 5):
//
//   start witness (HTTPS tunnel) → fresh installs → onboarding → both wallets
//   connect to the witness → invitation → v4 exchange (discovery → propose →
//   consent bottom-sheet → per-party witness sessions → hardware-attested
//   signed issue legs) → assert VRC on both + the ceremony/attestation
//   markers from Android's run-scoped logcat.
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
  acceptInvitationViaPaste,
  acceptLocalityPreflightIfPresent,
  assertLocalityConfirmedMarker,
  acceptRelationshipProposalOnEitherSide,
  assertTrustTaskExchangeMarkers,
  assertTspCarriageMarkers,
  assertVrcReceived,
  assertContactShields,
  assertWitnessCeremonyMarkers,
  assertWitnessShareMarkers,
  completeOnboarding,
  connectToWitness,
  enableHardwareAttestation,
  enableTspCarriage,
  showRelationshipInvitation,
} from "./flows.js";
import { startWitness } from "./witness.js";
import { printSuccess, printFailure } from "./banner.js";

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
/**
 * Report (never assert) what one wallet's locality peripheral did, for the
 * `offered`-policy variant where the VWC was issued either way.
 *
 * Android: the same `[TrustTasks:Witness] locality (not )?confirmed` markers
 * `assertLocalityConfirmedMarker` gates on, read from run-scoped logcat, but
 * a miss is printed rather than thrown.
 *
 * iOS: there is no adb; the peripheral's own NSLog lines
 * (`[Locality:Peripheral:iOS]`) come back through Appium's syslog. Every line
 * is saved, and `signingElapsedMs` — the one number the iOS design cannot
 * settle for itself (locality-plan/2026-09-12-al.md) — is pulled out and
 * printed on its own. A first live run of that peripheral is exactly what
 * this exists to capture.
 */
async function reportLocalityOutcome(driver, timeout = 60000) {
  const tag = `[e2e] ${driver.e2ePlatform}: locality`;
  if (driver.e2ePlatform === "android" && driver.e2eUdid) {
    const confirmed = /\[TrustTasks:Witness\] locality confirmed for session[^\n]*/;
    const notConfirmed = /\[TrustTasks:Witness\] locality not confirmed for session[^\n]*/;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const hit = log.match(confirmed) || log.match(notConfirmed);
      if (hit) {
        console.log(`${tag} → ${hit[0]}`);
        return;
      }
      await sleep(3000);
    }
    console.log(`${tag} → no marker within ${timeout}ms (the ceremony never reached the radio phase?)`);
    return;
  }
  if (driver.e2ePlatform === "ios") {
    try {
      const logs = await driver.getLogs("syslog");
      const lines = logs
        .map((l) => (typeof l === "string" ? l : l.message || ""))
        .filter((l) => /Locality:Peripheral:iOS|TrustTasks:Witness\] locality/.test(l));
      mkdirSync("artifacts", { recursive: true });
      const file = `artifacts/locality-ios-syslog-${Date.now()}.txt`;
      writeFileSync(file, lines.join("\n"));
      const elapsed = lines.map((l) => l.match(/signingElapsedMs=(\d+)/)).filter(Boolean).map((m) => Number(m[1]));
      const outcome = lines.find((l) => /locality (not )?confirmed/.test(l));
      console.log(`${tag} → ${outcome ? outcome.replace(/^.*\[TrustTasks/, "[TrustTasks") : "no ceremony marker seen"}`);
      console.log(
        `${tag} peripheral: ${lines.length} log line(s) saved to ${file}` +
          (elapsed.length ? ` — signingElapsedMs=${elapsed.join(",")} (bound: 400)` : " — no signingElapsedMs (assertion never generated)")
      );
    } catch (e) {
      console.warn(`${tag} → ios syslog capture failed (non-fatal): ${e.message}`);
    }
  }
}

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
 * The device-only gate: the VRC delivery must carry a hardware-attestation
 * evidence block ("Evidence block added" — Secure Enclave / StrongBox cert
 * chain, biometric-signed). Emulators/simulators silently skip this, which is
 * why only the devices run proves it. Android-side logcat covers only the
 * Android wallet's own issuance; a biometric decline or missing keystore
 * fails loudly here instead of silently downgrading the run.
 */
async function assertHardwareEvidenceMarker(driver, timeout = 120000) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  const deadline = Date.now() + timeout;
  for (;;) {
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const added = log.match(/Evidence block added \[[^\]]*\]/);
    if (added) {
      console.log(`[e2e] android: hardware-attestation evidence present — ${added[0]}`);
      return;
    }
    const downgraded = log.match(
      /proceeding without hardware attestation|issued without hardware attestation evidence/
    );
    if (downgraded) {
      throw new Error(`android: exchange downgraded to unattested: "${downgraded[0]}"`);
    }
    if (Date.now() > deadline) {
      throw new Error(`android: no hardware-attestation evidence marker after ${timeout}ms`);
    }
    await sleep(3000);
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
 * @param {string} opts.name - banner name, matching the npm script that invoked this
 *   (e.g. "vrc-exchange:witnessed:devices" or "vrc-exchange:witnessed:android-only").
 * @param {boolean} [opts.assertLocality] - locality-plan.md §10.3 item 12:
 *   additionally require BOTH sides' co-presence to be confirmed
 *   (`assertLocalityConfirmedMarker`), not merely attempted. The CALLER is
 *   responsible for setting `WITNESS_LOCALITY_REQUIRED=true` before this
 *   function runs (`startWitness` reads it from `process.env` itself) —
 *   this flag only controls whether the assertion runs, not the witness's
 *   policy, so a caller can't accidentally assert on a witness that was
 *   never actually going to enforce it.
 * @param {boolean} [opts.useTspCarriage] - carry the wallet-to-wallet Trust
 *   Task documents (discovery/propose/issue) over the real TSP envelope
 *   stack instead of the default DIDComm-v1 binding. Wallet-to-witness
 *   communication (session-request/challenge/VP) is a SEPARATE protocol —
 *   plain DIDComm basic messages (witnessed-vrc-manager.ts) — and is
 *   unaffected by this flag either way.
 */
export async function runWitnessedExchange({
  detectDevices,
  createSessionA,
  createSessionB,
  dumpWitnessLogs: dumpLogs,
  name,
  assertLocality = false,
  reportLocality = false,
  useTspCarriage = false,
}) {
  let sessionA, sessionB, witness;
  try {
    const { a: udidA, b: udidB } = detectDevices();
    console.log(`[e2e] device A: ${udidA}, device B: ${udidB}`);

    await ensureMetro();
    await ensureAppium();

    if (assertLocality && process.env.WITNESS_LOCALITY_REQUIRED !== "true") {
      // Asserting locality against a witness that was never going to enforce
      // it (or wasn't asked to attempt it at all) would just hang on
      // assertLocalityConfirmedMarker's timeout, or worse, pass vacuously —
      // fail fast with the actual cause instead.
      throw new Error(
        "assertLocality is set but WITNESS_LOCALITY_REQUIRED is not \"true\" — " +
          "export WITNESS_LOCALITY_REQUIRED=true before running this script."
      );
    }

    // The witness runs in direct mode behind a cloudflared HTTPS tunnel: the app
    // blocks cleartext http, and production witnesses are HTTPS (real mediators
    // like aaleon have SSL). The tunnel mirrors that locally without the
    // instability of routing the witness through the app's mediator.
    witness = await startWitness({ name: WITNESS_NAME });

    console.log(
      "\n[e2e] ATTENDED WITNESSED RUN — keep both phones unlocked and within reach.\n" +
        "[e2e] Witness is reachable via an HTTPS tunnel; no LAN needed.\n" +
        "[e2e] Authenticate at the OPERATOR banners.\n" +
        (assertLocality
          ? "[e2e] LOCALITY REQUIRED — keep both phones' Bluetooth on and within range of THIS machine's adapter;\n" +
            "[e2e] grant the Bluetooth permission prompt on each phone when it appears.\n"
          : "")
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

    // Both sides need the flag before either connects to anyone: it restarts
    // the app (required for the inbound TSP handler to register), and doing
    // that BEFORE the witness connection avoids any question of whether a
    // restart disrupts in-flight witness-protocol state (it doesn't need to
    // — DIDComm connections persist across a restart — but there's no
    // reason to find out under an attended run instead of before one starts).
    if (useTspCarriage) {
      await Promise.all([enableTspCarriage(sessionA), enableTspCarriage(sessionB)]);
    }

    // Both wallets connect to the witness FIRST — if either isn't connected when
    // the exchange starts, the 15s session-challenge timeout fires and the
    // exchange silently falls back to direct (no VWC). Confirm BOTH connections
    // completed via the witness's own log (no "connected" banner exists in the
    // app — witness participation only surfaces as a VWC after the exchange).
    if (assertLocality || reportLocality) {
      // The witness-connect locality pre-flight sheet (locality-plan.md §8.4)
      // fires on EACH phone right after ITS OWN connectToWitness resolves —
      // no automation taps it, and while it's up it blocks the rest of the
      // UI, so an operator who misses it stalls the whole run downstream
      // (surfacing much later as a confusing "could not land on Contacts").
      // Loud and up front, same as the biometric banner below, so the
      // operator is watching BOTH phones before either connects.
      console.log(
        "\n████████████████████████████████████████████████████████████\n" +
          "█  OPERATOR: a Bluetooth pre-flight sheet appears on EACH\n" +
          "█  phone right after it connects to the witness — tap Allow\n" +
          "█  on BOTH as soon as they appear, before continuing.\n" +
          "████████████████████████████████████████████████████████████\n"
      );
    }
    await connectToWitness(sessionA, witness.invitationUrl);
    if (assertLocality || reportLocality) await acceptLocalityPreflightIfPresent(sessionA);
    await connectToWitness(sessionB, witness.invitationUrl);
    if (assertLocality || reportLocality) {
      await acceptLocalityPreflightIfPresent(sessionB);
      // A slow phone can raise its sheet after the other's connect finished —
      // one short re-check on both before the exchange's first tap.
      await Promise.all([acceptLocalityPreflightIfPresent(sessionA, 3000), acceptLocalityPreflightIfPresent(sessionB, 3000)]);
    }
    await witness.waitForParticipants(2, 120000);
    console.log("[e2e] both wallets connected to the witness");

    const invitationUrl = await showRelationshipInvitation(sessionA);
    await acceptInvitationViaPaste(sessionB, invitationUrl);

    // v4 consent: one bottom-sheet on the non-proposer wallet, no
    // per-credential offers. The biometric prompts fire DURING the signed
    // delivery that follows consent.
    console.log(
      "\n[e2e] OPERATOR: a relationship proposal appears on one phone (auto-accepted);\n" +
        "[e2e] OPERATOR: then satisfy the BIOMETRIC prompt on EACH phone when it appears.\n"
    );
    await acceptRelationshipProposalOnEitherSide(sessionA, sessionB);

    // A locality leg adds a radio phase + attestation on EACH side, and on a
    // low-end phone the whole witnessed ceremony ran 3+ minutes after the
    // paste (Galaxy A03s, 2026-09-13: VWC stored and the contact rendered —
    // 16 s after the 120 s default expired). Attended runs can afford it.
    const vrcTimeout = assertLocality || reportLocality ? 300000 : 120000;
    await Promise.all([
      assertVrcReceived(sessionA, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`, vrcTimeout),
      assertVrcReceived(sessionB, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`, vrcTimeout),
    ]);

    // The crypto gates, from Android's run-scoped logcat (covers both
    // directions of the exchange; iOS has no logcat path).
    await Promise.all([
      assertTrustTaskExchangeMarkers(sessionA, 120000),
      assertTrustTaskExchangeMarkers(sessionB, 120000),
    ]);
    if (useTspCarriage) {
      await Promise.all([
        assertTspCarriageMarkers(sessionA),
        assertTspCarriageMarkers(sessionB),
      ]);
    }
    await Promise.all([
      assertWitnessCeremonyMarkers(sessionA, 180000),
      assertWitnessCeremonyMarkers(sessionB, 180000),
    ]);
    await Promise.all([
      assertHardwareEvidenceMarker(sessionA),
      assertHardwareEvidenceMarker(sessionB),
    ]);

    // Step 7: each wallet verifies the peer's shared bundle before the
    // Witnessed badge lights — gate the markers, then the badge itself.
    await Promise.all([
      assertWitnessShareMarkers(sessionA),
      assertWitnessShareMarkers(sessionB),
    ]);

    // locality-plan.md §10.3 item 12: both wallets' co-presence must be
    // CONFIRMED, not merely attempted — WITNESS_LOCALITY_REQUIRED=true is
    // the caller's job to have set before startWitness() ran above.
    if (assertLocality) {
      await Promise.all([
        assertLocalityConfirmedMarker(sessionA),
        assertLocalityConfirmedMarker(sessionB),
      ]);
    } else if (reportLocality) {
      // The `offered` variant: locality was attempted but nothing was gated on
      // it, so REPORT each side's outcome instead of asserting — the point of
      // that run is to see what each peripheral actually did.
      await Promise.all([reportLocalityOutcome(sessionA), reportLocalityOutcome(sessionB)]);
    }

    await assertContactShields(sessionA, `${IDENTITY_B.firstName} ${IDENTITY_B.lastName}`, 120000, {
      requireSecureExchange: false,
    });
    await assertContactShields(sessionB, `${IDENTITY_A.firstName} ${IDENTITY_A.lastName}`, 120000, {
      requireSecureExchange: false,
    });

    printSuccess(name);
    process.exitCode = 0;

    dumpLogs([udidA, udidB].filter(Boolean));
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
