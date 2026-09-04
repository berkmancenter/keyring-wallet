/**
 * Two-wallet VRC exchange E2E, over the real TSP envelope carriage:
 *   fresh install (uninstall first) → onboarding on both devices →
 *   enable the "TSP envelope carriage" developer setting on both (restarts
 *   each app so the setting takes effect for inbound too) →
 *   wallet A generates a relationship invitation → wallet B pastes the URL →
 *   both wallets end up holding a Verifiable Relationship Credential,
 *   carried over TSP (HPKE-Auth, Askar custody, CESR framing) instead of
 *   the default DIDComm-v1 basic-message binding.
 *
 * This proves the real TSP crypto stack live, on real devices — it is NOT
 * an ecosystem-interop claim (no vta-service/openvtc/pnm-cli counterpart is
 * involved; the envelope is still physically delivered over the existing
 * DIDComm-v1 connection). See
 * docs/plans/openvtc-integration-plan/2026-09-02-bam.md for the scope
 * correction this rests on.
 *
 * Both devices must be Android: assertTspCarriageMarkers reads adb logcat,
 * which iOS drivers don't have (same constraint assertTrustTaskExchangeMarkers
 * already has). Needs two AVDs — see e2e/README.md.
 *
 * Usage:
 *   ANDROID_AVD2=<second-avd> node run-vrc-exchange-tsp.js
 *
 * Requires: hosted mediator/witness reachable (baked into the app via app/.env),
 * appium with uiautomator2, built .apk (see lib/config.js).
 */
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
  assertTrustTaskExchangeMarkers,
  assertTspCarriageMarkers,
  assertVrcReceived,
  completeOnboarding,
  enableTspCarriage,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { androidCaps, ANDROID_AVD2 } from "./lib/config.js";
import { printSuccess, printFailure } from "./lib/banner.js";

if (!ANDROID_AVD2) {
  console.error(
    "run-vrc-exchange-tsp needs a second AVD — set ANDROID_AVD2 " +
      "(two emulators can't share one AVD; see e2e/README.md)"
  );
  process.exit(1);
}

let a, b;
try {
  await ensureAppium();

  console.log("[e2e] wallet A = android, wallet B = android (TSP envelope carriage)");
  // Sessions created sequentially: two emulators booting in parallel can starve CPU.
  a = await createSession("android");
  b = await createSession("android", androidCaps(ANDROID_AVD2));

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  // Both sides need the flag: sendTrustTaskDocument picks a carriage from
  // its OWN local flag, and setupTrustTasksInbound only registers the TSP
  // carriage's inbound handler when it's enabled — a peer with the flag off
  // has no handler at all for a TSP-enveloped message.
  await Promise.all([enableTspCarriage(a), enableTspCarriage(b)]);

  const invitationUrl = await showRelationshipInvitation(a);
  await acceptInvitationViaPaste(b, invitationUrl);

  // v4 pairs: consent is the RELATIONSHIP PROPOSAL — one side gets the
  // "wants to form a relationship" prompt; on Accept both signed VRCs flow
  // automatically as trust tasks (no per-credential offers to accept).
  await acceptRelationshipProposalOnEitherSide(a, b);

  await Promise.all([
    assertVrcReceived(a, "Bob Baker"),
    assertVrcReceived(b, "Alice Anderson"),
  ]);

  // The Trust Task relationship exchange itself still ran (propose + issue
  // shadow legs) — same markers as the default carriage, plus the TSP-
  // specific envelope markers proving THIS carriage carried them.
  await Promise.all([
    assertTrustTaskExchangeMarkers(a),
    assertTrustTaskExchangeMarkers(b),
    assertTspCarriageMarkers(a),
    assertTspCarriageMarkers(b),
  ]);

  printSuccess("vrc-exchange-tsp");
  process.exitCode = 0;
} catch (err) {
  printFailure("vrc-exchange-tsp", err);
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
