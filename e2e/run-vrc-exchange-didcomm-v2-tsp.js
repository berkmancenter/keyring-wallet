/**
 * Two-wallet VRC exchange with the TSP envelope carried over DIDComm v2
 * connections (didcomm_v2_subtask.md V2T, step T5):
 *   fresh install → onboarding on both → the "DIDComm v2", "wallet mailbox"
 *   and "TSP envelope carriage" developer settings confirmed on (all on by
 *   default; a switch found off is tapped and the app restarted) → each
 *   wallet's mailbox open at Keyring's mailbox mediator → wallet A mints an
 *   out-of-band/2.0 invitation through its mailbox → wallet B pastes it → the
 *   relationship Trust Task runs with every document sealed as a TSP envelope
 *   and delivered on the v2 connection through the two mailboxes → both VRCs.
 *
 * Proves the carriage selection (TSP flag on + v2 connection → TSP) and the
 * adapter's v2 key agreement on devices. Not interop: Keyring's own TSP on
 * both ends, double-wrapped inside DIDComm v2 authcrypt by design.
 *
 * Two Android emulators (logcat markers). The APK's app/.env must carry
 * MAILBOX_MEDIATOR_DID (the store configuration; Test and OTA-gate builds
 * write it blank) and MEDIATOR_URL. MEDIATOR_V2_URL is gone (#1166).
 *
 * Usage: ANDROID_AVD2=<second-avd> node run-vrc-exchange-didcomm-v2-tsp.js
 */
import "./lib/cli-guard.js";
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource } from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertTrustTaskExchangeMarkers,
  assertTspOverDidCommV2Markers,
  assertWalletMailboxOpen,
  assertVrcReceived,
  completeOnboarding,
  enableDidCommV2,
  enableTspCarriage,
  enableV2Mailbox,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { androidCaps, ANDROID_AVD2 } from "./lib/config.js";
import { printSuccess, printFailure, printSkipped } from "./lib/banner.js";
import { expectV2Invitation, RunSkipped, SKIPPED_EXIT_CODE } from "./lib/v2Mint.js";

if (!ANDROID_AVD2) {
  console.error("run-vrc-exchange-didcomm-v2-tsp needs a second AVD — set ANDROID_AVD2");
  process.exit(1);
}

let a, b;
try {
  await ensureAppium();
  console.log("[e2e] wallet A = android, wallet B = android (TSP envelope over DIDComm v2)");
  a = await createSession("android");
  b = await createSession("android", androidCaps(ANDROID_AVD2));

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  await Promise.all([enableDidCommV2(a), enableDidCommV2(b)]);
  await Promise.all([enableV2Mailbox(a), enableV2Mailbox(b)]);
  await Promise.all([enableTspCarriage(a), enableTspCarriage(b)]);
  await Promise.all([assertWalletMailboxOpen(a, 90000), assertWalletMailboxOpen(b, 90000)]);

  // A 1.x invitation here is 282's kill of v2 minting (#1018), and the run is SKIPPED with that reason (lib/v2Mint.js).
  const invitationUrl = expectV2Invitation(await showRelationshipInvitation(a));
  await acceptInvitationViaPaste(b, invitationUrl);
  await acceptRelationshipProposalOnEitherSide(a, b);

  await Promise.all([assertVrcReceived(a, "Bob Baker"), assertVrcReceived(b, "Alice Anderson")]);
  await Promise.all([assertTrustTaskExchangeMarkers(a), assertTrustTaskExchangeMarkers(b)]);
  await Promise.all([assertTspOverDidCommV2Markers(a), assertTspOverDidCommV2Markers(b)]);

  printSuccess("vrc-exchange-didcomm-v2-tsp");
  process.exitCode = 0;
} catch (err) {
  if (err instanceof RunSkipped) {
    // Not run on this build, for the reason the banner says: no screenshots; exit 77, the skip code, beside a SKIPPED banner.
    printSkipped("vrc-exchange-didcomm-v2-tsp", err.message);
    process.exitCode = SKIPPED_EXIT_CODE;
  } else {
    printFailure("vrc-exchange-didcomm-v2-tsp", err);
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
