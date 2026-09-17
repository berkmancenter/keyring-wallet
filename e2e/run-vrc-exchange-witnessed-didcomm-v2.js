/**
 * Witnessed VRC exchange over DIDComm v2, Android emulator + iOS simulator
 * (didcomm_v2_subtask.md C14, witnessed variant):
 *   witness-server started in DIDComm v1+v2 mode (direct HTTP via tunnel) →
 *   fresh install + onboarding on both devices → "Enable DIDComm v2" on both
 *   (restart; each wallet provisions Coordinate Mediation 2.0 with the
 *   build's MEDIATOR_V2_URL — asserted on BOTH before anything else) →
 *   both wallets accept the witness's out-of-band/2.0 invitation →
 *   wallet A mints an out-of-band/2.0 relationship invitation → wallet B
 *   pastes it → the relationship Trust Task and the witness ceremony run
 *   over v2 envelopes → both VRCs, Witnessed shields on both contact screens.
 *
 * What it adds over run-vrc-exchange-didcomm-v2.js: iOS on the v2 stack
 * (markers read from the simulator's unified log), and the witness leg on
 * v2 (the witness-server's own agent on didcommVersions ['v1','v2']).
 * Emulators/simulators cannot do hardware attestation, so the Secure
 * Exchange badge is not required.
 *
 * Requires: the APK and the iOS .app built against `yarn mediator
 * --didcomm-v2` (tunnel mode, so one MEDIATOR_V2_URL is reachable from both),
 * appium, cloudflared.
 */
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource } from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertContactShields,
  assertDidCommV2CarriageMarkers,
  assertTrustTaskExchangeMarkers,
  assertV2MediationMarker,
  assertWitnessCeremonyMarkers,
  assertWitnessShareMarkers,
  assertVrcReceived,
  completeOnboarding,
  connectToWitness,
  enableDidCommV2,
  showRelationshipInvitation,
  startIosLogCapture,
  stopIosLogCapture,
} from "./lib/flows.js";
import { startWitness } from "./lib/witness.js";
import { printSuccess, printFailure } from "./lib/banner.js";

let a, b, witness;
try {
  await ensureAppium();

  witness = await startWitness({ name: process.env.WITNESS_NAME || "e2e-witness", didcommV2: true });
  if (!witness.invitationV2Url) throw new Error("witness published no DIDComm v2 invitation");
  console.log(`[e2e] witness up (v1+v2) — v2 invitation: ${witness.invitationV2Url.slice(0, 60)}…`);

  console.log("[e2e] wallet A = android, wallet B = ios (DIDComm v2, witnessed)");
  a = await createSession("android");
  b = await createSession("ios");
  await startIosLogCapture(b);

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  await Promise.all([enableDidCommV2(a), enableDidCommV2(b)]);
  await Promise.all([assertV2MediationMarker(a), assertV2MediationMarker(b)]);

  // Both wallets connect to the witness over v2 before the exchange.
  await connectToWitness(a, witness.invitationV2Url);
  await connectToWitness(b, witness.invitationV2Url);
  await witness.waitForParticipants(2);
  console.log("[e2e] both wallets connected to the witness over DIDComm v2");

  const invitationUrl = await showRelationshipInvitation(a);
  if (!/[?&]_oob=/.test(invitationUrl)) {
    throw new Error(`expected an out-of-band/2.0 invitation (_oob=), got: ${invitationUrl.slice(0, 80)}…`);
  }
  await acceptInvitationViaPaste(b, invitationUrl);
  await acceptRelationshipProposalOnEitherSide(a, b);

  await Promise.all([assertVrcReceived(a, "Bob Baker"), assertVrcReceived(b, "Alice Anderson")]);

  await Promise.all([assertTrustTaskExchangeMarkers(a), assertTrustTaskExchangeMarkers(b)]);
  await Promise.all([assertWitnessCeremonyMarkers(a), assertWitnessCeremonyMarkers(b)]);
  await Promise.all([assertWitnessShareMarkers(a), assertWitnessShareMarkers(b)]);
  await Promise.all([assertDidCommV2CarriageMarkers(a), assertDidCommV2CarriageMarkers(b)]);

  await assertContactShields(a, "Bob Baker", 120000, { requireSecureExchange: false });
  await assertContactShields(b, "Alice Anderson", 120000, { requireSecureExchange: false });

  printSuccess("vrc-exchange-witnessed-didcomm-v2");
  process.exitCode = 0;
} catch (err) {
  printFailure("vrc-exchange-witnessed-didcomm-v2", err);
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
  stopIosLogCapture(b);
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
