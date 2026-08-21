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
  assertContactShields,
  assertTrustTaskExchangeMarkers,
  assertWitnessCeremonyMarkers,
  assertWitnessShareMarkers,
  assertVrcReceived,
  completeOnboarding,
  connectToWitness,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { startWitness } from "./lib/witness.js";
import { printSuccess, printFailure } from "./lib/banner.js";

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
  await Promise.all([
    assertWitnessShareMarkers(a),
    assertWitnessShareMarkers(b),
  ]);

  // The user-visible payoff: the Witnessed badge on BOTH contact screens,
  // earned by each wallet verifying the peer's shared bundle.
  await assertContactShields(a, "Bob Baker", 120000, { requireSecureExchange: false });
  await assertContactShields(b, "Alice Anderson", 120000, { requireSecureExchange: false });

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
