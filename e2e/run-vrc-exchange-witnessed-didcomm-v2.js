/**
 * Witnessed VRC exchange over DIDComm v2, Android emulator + iOS simulator
 * (didcomm_v2_subtask.md C14, witnessed variant):
 *   witness-server started (direct HTTP via tunnel; v1 only by default, see
 *   WITNESS_LEG) → fresh install + onboarding on both devices → the
 *   "DIDComm v2" and "wallet mailbox" developer settings confirmed on (both
 *   on by default; a switch found off is tapped and the app restarted) →
 *   each wallet's mailbox open at Keyring's mailbox mediator, asserted on
 *   BOTH before anything else → both wallets accept the witness's
 *   invitation → wallet A mints an out-of-band/2.0 relationship invitation
 *   through its mailbox → wallet B pastes it → the relationship Trust Task
 *   runs over v2 envelopes through the two mailboxes, the witness ceremony
 *   on the witness leg → both VRCs, the Witnessed shield on both contact
 *   screens (assertContactShields).
 *
 * WITNESS_LEG: "v1" (default) connects both wallets to the witness's v1
 * invitation, the witness serving v1 only; "v2" starts it on v1+v2 and uses
 * its out-of-band/2.0 invitation. The witness stays on v1 for now (product
 * decision of 2026-11-25, with the move to v2 owed soon): the wallet-to-
 * wallet leg is what the mailbox changes, and the first witnessed run with
 * the mailbox on keeps the witness leg as it was in production.
 *
 * What it adds over run-vrc-exchange-didcomm-v2.js: iOS on the v2 stack
 * (markers read from the simulator's unified log), and the witness ceremony
 * beside a mailbox-routed exchange. Emulators/simulators cannot do hardware
 * attestation, so the Secure Exchange badge is not required.
 *
 * Requires: the APK and the iOS .app built with app/.env carrying
 * MAILBOX_MEDIATOR_DID (the store configuration; Test and OTA-gate builds
 * write it blank) and MEDIATOR_URL; appium; cloudflared. Coordinate
 * Mediation 2.0 and MEDIATOR_V2_URL are gone (#1166).
 */
import "./lib/cli-guard.js";
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource } from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertContactShields,
  assertDidCommV2CarriageMarkers,
  assertTrustTaskExchangeMarkers,
  assertWalletMailboxOpen,
  assertWitnessCeremonyMarkers,
  assertWitnessShareMarkers,
  assertVrcReceived,
  completeOnboarding,
  connectToWitness,
  enableDidCommV2,
  enableV2Mailbox,
  showRelationshipInvitation,
  startIosLogCapture,
  stopIosLogCapture,
} from "./lib/flows.js";
import { startWitness, witnessLegFromEnv } from "./lib/witness.js";
import { printSuccess, printFailure, printSkipped } from "./lib/banner.js";
import { expectV2Invitation, RunSkipped, SKIPPED_EXIT_CODE } from "./lib/v2Mint.js";

let a, b, witness;
try {
  await ensureAppium();

  const witnessLeg = witnessLegFromEnv();
  witness = await startWitness({ name: process.env.WITNESS_NAME || "e2e-witness", didcommV2: witnessLeg === "v2" });
  const witnessInvitationUrl = witnessLeg === "v2" ? witness.invitationV2Url : witness.invitationUrl;
  if (!witnessInvitationUrl) throw new Error(`witness published no DIDComm ${witnessLeg} invitation`);
  console.log(`[e2e] witness up (leg ${witnessLeg}) — invitation: ${witnessInvitationUrl.slice(0, 60)}…`);

  console.log("[e2e] wallet A = android, wallet B = ios (DIDComm v2 + mailbox, witnessed)");
  a = await createSession("android");
  b = await createSession("ios");
  await startIosLogCapture(b);

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  await Promise.all([enableDidCommV2(a), enableDidCommV2(b)]);
  await Promise.all([enableV2Mailbox(a), enableV2Mailbox(b)]);
  await Promise.all([assertWalletMailboxOpen(a), assertWalletMailboxOpen(b)]);

  // Both wallets connect to the witness before the exchange.
  await connectToWitness(a, witnessInvitationUrl);
  await connectToWitness(b, witnessInvitationUrl);
  await witness.waitForParticipants(2);
  console.log(`[e2e] both wallets connected to the witness over DIDComm ${witnessLeg}`);

  // A 1.x invitation here is 282's kill of v2 minting (#1018), and the run is SKIPPED with that reason (lib/v2Mint.js).
  const invitationUrl = expectV2Invitation(await showRelationshipInvitation(a));
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
  if (err instanceof RunSkipped) {
    // Not run on this build, for the reason the banner says: no screenshots; exit 77, the skip code, beside a SKIPPED banner.
    printSkipped("vrc-exchange-witnessed-didcomm-v2", err.message);
    process.exitCode = SKIPPED_EXIT_CODE;
  } else {
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
  }
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
