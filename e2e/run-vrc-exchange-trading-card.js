/**
 * Two-wallet VRC exchange E2E for the trading-card demo profile
 * (app/src/demo-profiles/trading-card/): fresh install → onboarding on both
 * devices (wallet A attaches an R-Card photo, so the avatar field is actually
 * exercised) → wallet A generates a relationship invitation → wallet B pastes
 * it → both wallets end up holding a Verifiable Relationship Credential → and
 * on both sides the exchanged R-Card renders as a trading card (the
 * `TradingCard` component the profile registers on
 * `TOKENS.COMPONENT_CONTACT_CARD`, skinned via the OCA bundle in
 * trading-card/ocaBundles.ts), not the default contact row.
 *
 * The exchange itself is Keyring's ordinary VRC/Trust-Task flow — this test
 * differs from run-vrc-exchange-photo.js only in what it asserts at the end:
 * the trading-card-specific testIDs (`TradingCard`, `TradingCardRarity`,
 * `ContactAvatarImage` on the card face) rather than the default ContactCard.
 *
 * Requires the trading-card profile actually be registered on the running
 * container — see app/App.tsx (`registerDemoProfiles(bcwContainer,
 * installedDemoProfiles)`) — and a built debug APK whose app/.env baked
 * MEDIATOR_URL matches a currently-running local mediator (`yarn mediator`).
 *
 * Usage:
 *   node run-vrc-exchange-trading-card.js                 # android emulator + iOS simulator
 *   PLATFORMS=android,android ANDROID_AVD2=<second-avd> \
 *     node run-vrc-exchange-trading-card.js                # two android emulators (no macOS/Xcode)
 */
import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
  existsTestId,
  byTextContains,
} from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertTrustTaskExchangeMarkers,
  assertVrcReceived,
  completeOnboarding,
  openContactDetail,
  returnToContacts,
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
 * Assert the peer's exchanged R-Card rendered as a trading card in the
 * Contacts list — the `TradingCard` component the profile registers on
 * `TOKENS.COMPONENT_CONTACT_CARD`, not the default `ContactCard`. Checks the
 * card's own testID plus the rarity badge `rarityFor` always renders
 * (COMMON at minimum — emulators can't produce hardware attestation or a
 * witness, so RARE/HOLO RARE grades are not reachable here; see
 * TradingCard.tsx's `rarityFor`).
 */
async function assertTradingCardRendered(driver, peerName, timeout = 60000) {
  // Whichever side just tapped ProposalAccept lands on the "Relationship
  // confirmed" overlay on top of that contact's Chat screen, not the
  // Contacts LIST — the screen that actually renders
  // COMPONENT_CONTACT_CARD rows (Chat.tsx's vrcConfirmed overlay, "View
  // contacts" button, no dedicated testID — text only). Dismiss it via its
  // own affirmative action first; fall back to the generic recovery loop
  // for any other stacked screen (e.g. the non-proposer side, which never
  // saw this overlay at all).
  if (await byTextContains(driver, "View contacts").isExisting().catch(() => false)) {
    await byTextContains(driver, "View contacts").click();
    console.log(`[e2e] ${driver.e2ePlatform}: dismissed relationship-confirmed overlay via "View contacts"`);
  }
  await returnToContacts(driver).catch(() => {});
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (
      (await existsTestId(driver, "TradingCard", 4000)) &&
      (await byTextContains(driver, peerName).isExisting())
    ) {
      const hasRarity = await existsTestId(driver, "TradingCardRarity", 2000);
      console.log(
        `[e2e] ${driver.e2ePlatform}: trading card rendered for "${peerName}"` +
          (hasRarity ? " (rarity badge present)" : " (rarity badge NOT found)")
      );
      if (!hasRarity) {
        throw new Error(
          `${driver.e2ePlatform}: TradingCard rendered for "${peerName}" but TradingCardRarity badge is missing`
        );
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await screenshot(driver, "trading-card-missing");
  throw new Error(
    `${driver.e2ePlatform}: no TradingCard rendered for "${peerName}" within ${timeout}ms ` +
      `(contact list still shows the default ContactCard? trading-card profile may not be registered)`
  );
}

/**
 * Assert the avatar/image field survived onto the trading card face itself
 * (not just the core ContactDetails screen — see assertContactPhotoReceived
 * in lib/flows.js for that check). TradingCard.tsx reuses the
 * `ContactAvatarImage` testID for its own portrait `<Image>`, so this opens
 * the contact detail (which also shares the list row's photo state) and
 * confirms the image element exists.
 */
async function assertTradingCardPhoto(driver, peerName, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await existsTestId(driver, "ContactAvatarImage", 4000)) {
      console.log(`[e2e] ${driver.e2ePlatform}: trading card portrait photo present for "${peerName}"`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await screenshot(driver, "trading-card-photo-missing");
  throw new Error(
    `${driver.e2ePlatform}: no photo (ContactAvatarImage) on the trading card for "${peerName}" within ${timeout}ms`
  );
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
    // Wallet A attaches a photo during R-Card onboarding — the avatar/image
    // field the trading-card profile's plan calls out (photo, name plate).
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson", photo: true }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker" }),
  ]);

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

  // The trust-task relationship exchange ran alongside the legacy VRC leg —
  // same markers assertion every other VRC runner uses.
  await Promise.all([
    assertTrustTaskExchangeMarkers(a),
    assertTrustTaskExchangeMarkers(b),
  ]);

  // The point of this profile: the exchanged R-Card renders as a trading
  // card (COMPONENT_CONTACT_CARD override), on BOTH sides.
  await Promise.all([
    assertTradingCardRendered(a, "Bob Baker"),
    assertTradingCardRendered(b, "Alice Anderson"),
  ]);

  // Only wallet A attached a photo — only wallet B (the receiver of A's
  // card) should see a portrait rendered instead of the "?" placeholder.
  await openContactDetail(b, "Alice Anderson");
  await assertTradingCardPhoto(b, "Alice Anderson");

  printSuccess("vrc-exchange-trading-card");
  process.exitCode = 0;
} catch (err) {
  printFailure("vrc-exchange-trading-card", err);
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
