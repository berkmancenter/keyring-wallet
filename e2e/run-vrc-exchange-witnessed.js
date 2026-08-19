/**
 * WITNESSED two-wallet VRC exchange on the SIMULATOR + EMULATOR pair,
 * unattended — the Trust Task dialect's witness ceremony (§9 step 5):
 *
 *   1. a local witness-server starts behind a cloudflared HTTPS tunnel;
 *   2. both wallets onboard and connect to the witness (same paste flow as
 *      adding a contact);
 *   3. the relationship exchange runs — discovery → propose (witnessed:true,
 *      since a witness is connected) → consent prompt → each side's witness
 *      session (challenge → challenge-bound VP → VWC with taskContext +
 *      taskDigestMultibase) → the signed issue legs;
 *   4. PASS requires the standard ceremony markers PLUS the witness-session
 *      markers from Android's logcat.
 *
 * Emulators cannot do hardware attestation, so the VWCs here record
 * hardwareAttestationIncluded=false — the attested variant remains
 * run-vrc-exchange-witnessed-devices.js (attended). What THIS run proves is
 * the task-dialect ceremony end-to-end: per-party sessions, proof-bearing
 * responses, task-bound VWCs, outcome-evidence retention.
 *
 * Usage: APPIUM_PORT=4750 WDA_LOCAL_PORT=8101 node run-vrc-exchange-witnessed.js
 */
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource } from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalIfPrompted,
  assertTrustTaskExchangeMarkers,
  assertVrcReceived,
  completeOnboarding,
  connectToWitness,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { startWitness } from "./lib/witness.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { execSync } from "node:child_process";

/** The witness-session markers, from Android's run-scoped logcat. */
async function assertWitnessCeremonyMarkers(driver, timeout = 90000) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  const required = [
    [/\[TrustTasks:Witness\] session opened/, "session opened"],
    [/\[TrustTasks:Witness\] challenge received/, "challenge received"],
    [/\[TrustTasks:Witness\] presentation submitted/, "presentation submitted"],
    [/\[TrustTasks:Witness\] VWC stored/, "VWC stored"],
    [/\[TrustTasks:Ceremony\] outcome evidence assembled and verified/, "outcome evidence self-check"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log("[e2e] android: witness ceremony markers all present (session → challenge → VP → VWC → evidence self-check)");
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    `android: witness ceremony markers missing after ${timeout}ms: ${missing.map(([, n]) => n).join(", ")}`
  );
}

let a, b, witness;
try {
  await ensureAppium();

  witness = await startWitness({ name: process.env.WITNESS_NAME || "e2e-witness" });
  console.log(`[e2e] witness up — invitation: ${witness.invitationUrl.slice(0, 60)}…`);

  console.log(`[e2e] wallet A = android, wallet B = ios`);
  a = await createSession("android");
  b = await createSession("ios");

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  // Both wallets connect to the witness before the exchange.
  await connectToWitness(a, witness.invitationUrl);
  await connectToWitness(b, witness.invitationUrl);
  await witness.waitForParticipants(2);
  console.log("[e2e] both wallets connected to the witness");

  const invitationUrl = await showRelationshipInvitation(a);
  await acceptInvitationViaPaste(b, invitationUrl);

  await Promise.all([
    acceptRelationshipProposalIfPrompted(a),
    acceptRelationshipProposalIfPrompted(b),
  ]);

  await Promise.all([
    assertVrcReceived(a, "Bob Baker"),
    assertVrcReceived(b, "Alice Anderson"),
  ]);

  await Promise.all([
    assertTrustTaskExchangeMarkers(a),
    assertTrustTaskExchangeMarkers(b),
  ]);
  await Promise.all([
    assertWitnessCeremonyMarkers(a),
    assertWitnessCeremonyMarkers(b),
  ]);

  printSuccess("vrc-exchange-witnessed");
  process.exitCode = 0;
} catch (err) {
  printFailure("vrc-exchange-witnessed", err);
  for (const d of [a, b].filter(Boolean)) {
    try {
      await screenshot(d, "failure");
      await dumpSource(d, "failure");
    } catch {
      /* session may be dead */
    }
  }
  process.exitCode = 1;
} finally {
  for (const d of [a, b].filter(Boolean)) {
    try {
      await d.deleteSession();
    } catch {
      /* ignore */
    }
  }
  try {
    await witness?.stop?.();
  } catch {
    /* ignore */
  }
  stopAppium();
}
