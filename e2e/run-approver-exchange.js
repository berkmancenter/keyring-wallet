/**
 * Two-wallet Approver demo E2E (app/src/demo-profiles/approver/): fresh
 * install → onboarding on both devices → an established VRC relationship
 * (same handshake every other VRC runner uses) → wallet A proposes an
 * `approver/access-request` Trust Task from the counterparty's Contact
 * Details screen → wallet B renders it via the generic
 * `TrustTaskApprovalCard`, also on that contact's Contact Details screen,
 * and taps Approve → wallet A observes the signed decision land, back on
 * the same screen.
 *
 * Modeled directly on run-vrc-exchange-trading-card.js: same onboarding/
 * invitation/consent choreography, differing only in what happens after the
 * relationship is established and what gets asserted.
 *
 * Requires the approver profile actually be registered on the running
 * container — see app/App.tsx (`registerDemoProfiles(bcwContainer,
 * selectDemoProfiles(Config.ACTIVE_DEMO_PROFILE))`) — and a built debug APK
 * whose app/.env baked MEDIATOR_URL matches a currently-running local
 * mediator (`yarn mediator`). Since Android debug builds load JS from Metro,
 * no rebuild is needed for this profile's JS-only addition as long as the
 * already-built APK's `.env` (MEDIATOR_URL, ACTIVE_DEMO_PROFILE) is still
 * what's wanted — `ACTIVE_DEMO_PROFILE` unset registers both profiles, which
 * is what this test needs (it uses neither the trading-card renderer nor a
 * DI token that profile owns).
 *
 * Usage:
 *   node run-approver-exchange.js                 # android emulator + iOS simulator
 *   PLATFORMS=android,android ANDROID_AVD2=<second-avd> \
 *     node run-approver-exchange.js                # two android emulators (no macOS/Xcode)
 */
import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
  existsTestId,
  tapTestId,
  waitForTestId,
} from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertTrustTaskExchangeMarkers,
  assertVrcReceived,
  completeOnboarding,
  openContactDetail,
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

/**
 * Wallet A: open the counterparty's Contact Details screen (openContactDetail
 * handles dismissing the "Relationship confirmed" overlay and any
 * chat-vs-details routing on its own) and tap the Approver demo's own
 * "Request access" button, rendered there by `ApproverContactSection` via
 * `COMPONENT_CONTACT_DETAILS_FOOTER` — see ApproverProfile.ts's own comment
 * on why this token, not the old Wallet-tab footer.
 */
async function requestAccess(driver, peerName) {
  await openContactDetail(driver, peerName);
  await waitForTestId(driver, "ApproverRequestAccess", 30000);
  await tapTestId(driver, "ApproverRequestAccess");
  console.log(`[e2e] ${driver.e2ePlatform}: access request sent`);
}

/** Wallet B: open the requester's Contact Details screen and wait for the generic TrustTaskApprovalCard to render the pending request, then tap Approve. */
async function approveIncomingRequest(driver, peerName, timeout = 60000) {
  await openContactDetail(driver, peerName);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await existsTestId(driver, "TrustTaskApprovalCard", 4000)) {
      console.log(`[e2e] ${driver.e2ePlatform}: TrustTaskApprovalCard rendered`);
      await tapTestId(driver, "TrustTaskApprove");
      console.log(`[e2e] ${driver.e2ePlatform}: approved`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await screenshot(driver, "approver-card-missing");
  throw new Error(
    `${driver.e2ePlatform}: no TrustTaskApprovalCard rendered within ${timeout}ms ` +
      `(approver profile may not be registered, or the access request never arrived)`
  );
}

/** Wallet A: back on the counterparty's Contact Details screen, assert the signed decision landed — ApproverContactSection's own "Last decision" line. */
async function assertDecisionReceived(driver, peerName, expected = "approved", timeout = 60000) {
  await openContactDetail(driver, peerName);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await existsTestId(driver, "ApproverLastDecision", 4000)) {
      console.log(`[e2e] ${driver.e2ePlatform}: signed decision received (${expected})`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await screenshot(driver, "approver-decision-missing");
  throw new Error(
    `${driver.e2ePlatform}: no signed decision observed (ApproverLastDecision) within ${timeout}ms`
  );
}

let a, b;
try {
  await ensureAppium();

  console.log(`[e2e] wallet A (requester) = ${platforms[0]}, wallet B (approver) = ${platforms[1]}`);
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

  // v4 pairs: consent is the RELATIONSHIP PROPOSAL — same as every other
  // trust-task VRC runner. The Approver demo's access-request task rides
  // the relationship DID this establishes; it cannot run before this.
  await acceptRelationshipProposalOnEitherSide(a, b);

  await Promise.all([
    assertVrcReceived(a, "Bob Baker"),
    assertVrcReceived(b, "Alice Anderson"),
  ]);
  await Promise.all([
    assertTrustTaskExchangeMarkers(a),
    assertTrustTaskExchangeMarkers(b),
  ]);

  // The point of this demo: wallet A asks, wallet B answers, wallet A sees
  // the signed answer.
  await requestAccess(a, "Bob Baker");
  await approveIncomingRequest(b, "Alice Anderson");
  await assertDecisionReceived(a, "Bob Baker", "approved");

  printSuccess("approver-exchange");
  process.exitCode = 0;
} catch (err) {
  printFailure("approver-exchange", err);
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
