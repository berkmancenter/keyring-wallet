/**
 * Two-wallet VRC exchange E2E over DIDComm v2 (didcomm_v2_subtask.md C14):
 *   fresh install → onboarding on both devices →
 *   enable the "DIDComm v2" developer setting on both (restarts each app:
 *   the agent comes back with didcommVersions ['v1','v2'] and provisions
 *   Coordinate Mediation 2.0 with the build's MEDIATOR_V2_URL) →
 *   wallet A generates an out-of-band/2.0 relationship invitation on
 *   did:peer:2 → wallet B pastes the URL → the relationship Trust Task runs
 *   over the binding/didcomm 0.2 envelope on a v2 connection, through the v2
 *   mediator (Pickup 4.0) → both wallets hold a VRC.
 *
 * What it proves: the wallet's DIDComm v2 stack live on devices — OOB 2.0,
 * did:peer:2, ECDH-1PU envelopes, Coordinate Mediation 2.0 + Pickup 4.0 —
 * carrying the same Trust Task documents the v1 carriage carries
 * (tsp-reference/ref-16: byte-identical). Not an ecosystem-interop claim:
 * the mediator is Keyring's own mediator-server in v2 mode, not the VTI
 * mediator (ref-18 covers that leg in Node).
 *
 * Both devices must be Android (logcat markers). Needs two AVDs and an APK
 * built against `yarn mediator --didcomm-v2` (MEDIATOR_V2_URL baked in).
 *
 * Usage:
 *   ANDROID_AVD2=<second-avd> node run-vrc-exchange-didcomm-v2.js
 */
import "./lib/cli-guard.js";
import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
} from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertDidCommV2CarriageMarkers,
  assertTrustTaskExchangeMarkers,
  assertV2MediationMarker,
  assertVrcReceived,
  completeOnboarding,
  enableDidCommV2,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { androidCaps, ANDROID_AVD2 } from "./lib/config.js";
import { printSuccess, printFailure } from "./lib/banner.js";

if (!ANDROID_AVD2) {
  console.error(
    "run-vrc-exchange-didcomm-v2 needs a second AVD — set ANDROID_AVD2 " +
      "(two emulators can't share one AVD; see e2e/README.md)"
  );
  process.exit(1);
}

let a, b;
try {
  await ensureAppium();

  console.log("[e2e] wallet A = android, wallet B = android (DIDComm v2)");
  a = await createSession("android");
  b = await createSession("android", androidCaps(ANDROID_AVD2));

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  // Both sides: the inviter needs v2 to mint an OOB 2.0 invitation, the
  // invitee needs v2 to accept one (a v1-only agent rejects it outright).
  await Promise.all([enableDidCommV2(a), enableDidCommV2(b)]);

  // Mediation 2.0 must be granted before the invitation is minted, or the
  // invitation routes unmediated and the mediated claim below is hollow.
  await Promise.all([assertV2MediationMarker(a), assertV2MediationMarker(b)]);

  const invitationUrl = await showRelationshipInvitation(a);
  if (!/[?&]_oob=/.test(invitationUrl)) {
    throw new Error(`expected an out-of-band/2.0 invitation (_oob=), got: ${invitationUrl.slice(0, 80)}…`);
  }
  await acceptInvitationViaPaste(b, invitationUrl);

  await acceptRelationshipProposalOnEitherSide(a, b);

  await Promise.all([
    assertVrcReceived(a, "Bob Baker"),
    assertVrcReceived(b, "Alice Anderson"),
  ]);

  await Promise.all([
    assertTrustTaskExchangeMarkers(a),
    assertTrustTaskExchangeMarkers(b),
    assertDidCommV2CarriageMarkers(a),
    assertDidCommV2CarriageMarkers(b),
  ]);

  printSuccess("vrc-exchange-didcomm-v2");
  process.exitCode = 0;
} catch (err) {
  printFailure("vrc-exchange-didcomm-v2", err);
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
  stopAppium();
}
