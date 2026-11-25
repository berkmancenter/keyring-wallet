/**
 * Two-wallet VRC exchange E2E over DIDComm v2 (didcomm_v2_subtask.md C14):
 *   fresh install → onboarding on both devices →
 *   make sure the "DIDComm v2" and "wallet mailbox" developer settings are on
 *   (both on by default; a switch found off is tapped and the app restarted) →
 *   each wallet's mailbox is open at Keyring's mailbox mediator (log marker) →
 *   wallet A generates an out-of-band/2.0 relationship invitation on
 *   did:peer:2 whose service is its mailbox → wallet B pastes the URL → the
 *   relationship Trust Task runs over the binding/didcomm 0.2 envelope on a
 *   v2 connection, through the two mailboxes → both wallets hold a VRC.
 *
 * What it proves: the wallet's DIDComm v2 stack live on devices — OOB 2.0,
 * did:peer:2, ECDH-1PU envelopes, one mailbox per phone at the mailbox
 * mediator (wallet-to-wallet forwarding, live socket + pickup) — carrying the
 * same Trust Task documents the v1 carriage carries (tsp-reference/ref-16:
 * byte-identical). Not an ecosystem-interop claim: the Farm's VTI mediator is
 * never asked by the phone (ref-18 covers that leg in Node).
 *
 * Both devices must be Android (logcat markers). Needs two AVDs and an APK
 * whose app/.env carries MAILBOX_MEDIATOR_DID (the store configuration; Test
 * and OTA-gate builds write it blank and open no mailbox) and MEDIATOR_URL
 * for the v1 fallback. Coordinate Mediation 2.0 and MEDIATOR_V2_URL are gone
 * (#1166): `yarn mediator --didcomm-v2` is no longer a prerequisite.
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
  assertWalletMailboxOpen,
  assertVrcReceived,
  completeOnboarding,
  enableDidCommV2,
  enableV2Mailbox,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { androidCaps, ANDROID_AVD2 } from "./lib/config.js";
import { printSuccess, printFailure, printSkipped } from "./lib/banner.js";
import { expectV2Invitation, RunSkipped } from "./lib/v2Mint.js";

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
  // Both are on by default; this only taps a switch found off.
  await Promise.all([enableDidCommV2(a), enableDidCommV2(b)]);
  await Promise.all([enableV2Mailbox(a), enableV2Mailbox(b)]);

  // The mailbox must be open before the invitation is minted, or the
  // invitation routes unmediated and the mediated claim below is hollow.
  await Promise.all([assertWalletMailboxOpen(a), assertWalletMailboxOpen(b)]);

  // A 1.x invitation here is 282's kill of v2 minting (#1018), and the run is SKIPPED with that reason (lib/v2Mint.js).
  const invitationUrl = expectV2Invitation(await showRelationshipInvitation(a));
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
  if (err instanceof RunSkipped) {
    // Not run on this build, for the reason the banner says: no screenshots, exit 0 beside a SKIPPED banner.
    printSkipped("vrc-exchange-didcomm-v2", err.message);
    process.exitCode = 0;
  } else {
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
  }
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
