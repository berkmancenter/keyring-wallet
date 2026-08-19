/**
 * Two-wallet VRC exchange E2E:
 *   fresh install (uninstall first) → onboarding on both devices →
 *   wallet A generates a relationship invitation → wallet B pastes the URL →
 *   both wallets end up holding a Verifiable Relationship Credential.
 *
 * Usage:
 *   node run-vrc-exchange.js                 # android emulator + iOS simulator
 *   PLATFORMS=android,ios node run-vrc-exchange.js
 *   PLATFORMS=android,android ANDROID_AVD2=<second-avd> node run-vrc-exchange.js
 *
 * Requires: hosted mediator/witness reachable (baked into the app via app/.env),
 * appium with uiautomator2 + xcuitest drivers, built .apk/.app (see lib/config.js).
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
  acceptRelationshipProposalIfPrompted,
  assertTrustTaskExchangeMarkers,
  assertVrcReceived,
  completeOnboarding,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { androidCaps, ANDROID_AVD2 } from "./lib/config.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const platforms = (process.env.PLATFORMS || "android,ios")
  .split(",")
  .map((s) => s.trim());
if (platforms.length !== 2) {
  console.error("PLATFORMS must list exactly two entries, e.g. android,ios");
  process.exit(1);
}
const bothAndroid = platforms[0] === "android" && platforms[1] === "android";
if (bothAndroid && !ANDROID_AVD2) {
  console.error(
    "PLATFORMS=android,android needs a second AVD — set ANDROID_AVD2 " +
      "(two emulators can't share one AVD; see e2e/README.md)"
  );
  process.exit(1);
}

let a, b;
try {
  await ensureAppium();

  console.log(`[e2e] wallet A = ${platforms[0]}, wallet B = ${platforms[1]}`);
  // Sessions created sequentially: simulator + emulator booting in parallel can starve CPU.
  a = await createSession(platforms[0]);
  b = await createSession(
    platforms[1],
    bothAndroid ? androidCaps(ANDROID_AVD2) : undefined
  );

  await Promise.all([
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

  const invitationUrl = await showRelationshipInvitation(a);
  await acceptInvitationViaPaste(b, invitationUrl);

  // v4 pairs: consent is the RELATIONSHIP PROPOSAL — one side gets the
  // "wants to form a relationship" prompt; on Accept both signed VRCs flow
  // automatically as trust tasks (no per-credential offers to accept).
  await Promise.all([
    acceptRelationshipProposalIfPrompted(a),
    acceptRelationshipProposalIfPrompted(b),
  ]);

  await Promise.all([
    assertVrcReceived(a, "Bob Baker"),
    assertVrcReceived(b, "Alice Anderson"),
  ]);

  // v4 pairs also run the Trust Task relationship exchange (propose + issue
  // shadow legs) — assert its markers from the Android side's logcat.
  await Promise.all([
    assertTrustTaskExchangeMarkers(a),
    assertTrustTaskExchangeMarkers(b),
  ]);

  printSuccess("vrc-exchange");
  process.exitCode = 0;
} catch (err) {
  printFailure("vrc-exchange", err);
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
