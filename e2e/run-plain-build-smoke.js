/**
 * Two-wallet VRC exchange E2E for a PLAIN build — `app/.env`'s
 * `ACTIVE_DEMO_PROFILE=none` (see app/.env.sample and
 * app/src/demo-profiles/README.md's own table) — proving neither installed
 * demo profile's UI leaks into a build that asked for none of them.
 *
 * Modeled directly on run-vrc-exchange-trading-card.js: same onboarding/
 * invitation/consent choreography, except BOTH wallets attach an R-Card
 * photo here (that runner only needs one side's photo to prove the field
 * survives an exchange; this one's positive default-ContactCard check —
 * see below — needs `ContactAvatarImage` to render on BOTH sides, since a
 * photo-less contact falls back to a plain icon regardless of which
 * COMPONENT_CONTACT_CARD renderer is active). Differs from that runner only
 * in what gets asserted at the end. This reuses that
 * already-proven two-wallet exchange path rather than inventing a new one,
 * because proving a NEGATIVE ("no demo UI anywhere") is cheapest to do
 * reliably by piggybacking on a flow already known to reach every screen a
 * demo profile could have touched — the exchanged-contact card render (where
 * `trading-card` would swap in `TradingCard`) and the Wallet tab's
 * credential-list footer (where `approver` would insert `ApproverHomeBanner`)
 * — in one real run, rather than trusting the unit test
 * (`selectDemoProfiles('none') === []`) alone to speak for the built app. A
 * single device can't stand this test up on its own: proving the negative
 * still means completing a real relationship exchange (so there's an
 * exchanged contact to render, and a "Wallet tab that actually did
 * something" to inspect the footer of), and that exchange itself needs a
 * peer wallet — so this is a two-wallet run like its trading-card/approver
 * precedents, not a single-device smoke check.
 *
 * Asserts NEGATIVELY and specifically:
 *   - the exchanged contact renders via the default `ContactCard`
 *     (`bifold/packages/core/src/modules/vrc/components/ContactCard.tsx`) —
 *     no dedicated container testID exists on that component (only its
 *     `ContactAvatarImage`, which `TradingCard` also reuses for its own
 *     portrait — see that file's own comment), so "default card" is proven
 *     by POSITIVE presence of the peer's name + `ContactAvatarImage` in the
 *     Contacts list — proving a card actually rendered with content, not
 *     just an empty screen — combined with the ABSENCE of `TradingCard` and
 *     `TradingCardRarity` (trading-card/TradingCard.tsx's own testIDs; the
 *     only other implementation of `COMPONENT_CONTACT_CARD` this app ships).
 *   - no Approver-demo testID (`ApproverHomeBanner` / `ApproverRequestAccess`
 *     — app/src/demo-profiles/approver/ApproverHomeBanner.tsx) exists
 *     anywhere on the Wallet tab, guarded the same way: alongside the
 *     negative check, assert the Wallet tab's own default empty-credentials
 *     state (`NoCredentials` — Keyring's own `EmptyList` override, see
 *     `app/src/keyring-theme/components/EmptyList.tsx`, registered on
 *     bifold's `ListCredentials.tsx`'s `ListEmptyComponent`; bifold's stock
 *     `EmptyList` uses a different testID, `NoneYet`, which this app never
 *     renders) is actually showing, so a screen that failed to render at all
 *     (or is still transitioning) can't produce a false pass by testing
 *     negative before there was anything on screen to test.
 *
 * Requires a debug APK BUILT with `app/.env`'s `ACTIVE_DEMO_PROFILE=none` —
 * unlike the trading-card/approver runners (which tolerate an APK built with
 * `ACTIVE_DEMO_PROFILE` unset, since they only need THEIR OWN profile
 * registered and don't care what else is), this one specifically needs BOTH
 * demo profiles absent from the running container, and `App.tsx` reads
 * `Config.ACTIVE_DEMO_PROFILE` from `react-native-config`, which bakes
 * `app/.env` into the native build at COMPILE time, not JS runtime (same
 * rule as `MEDIATOR_URL` — see e2e/README.md's "Build the app binaries
 * first"). Editing `.env` and re-running this suite against an
 * already-built APK silently keeps testing the OLD `ACTIVE_DEMO_PROFILE`.
 * Before running this script:
 *
 *   1. Set `ACTIVE_DEMO_PROFILE=none` in `app/.env`.
 *   2. Rebuild: `cd app/android && ./gradlew assembleDebug` (or `yarn
 *      android` from `app/`, which also installs — a fresh install isn't
 *      needed here since Appium's `fullReset` caps reinstall for every run).
 *   3. Restore `app/.env` to whatever you want a plain `yarn android` build
 *      to mean afterward — this script does not touch `.env` itself, and
 *      leaving `ACTIVE_DEMO_PROFILE=none` in place silently changes what the
 *      next default `yarn android`/`yarn demo:android` build produces.
 *
 * Usage:
 *   node run-plain-build-smoke.js                 # android emulator + iOS simulator
 *   PLATFORMS=android,android ANDROID_AVD2=<second-avd> \
 *     node run-plain-build-smoke.js                # two android emulators (no macOS/Xcode)
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
  byTextContains,
} from "./lib/driver.js";
import {
  acceptInvitationViaPaste,
  acceptRelationshipProposalOnEitherSide,
  assertTrustTaskExchangeMarkers,
  assertVrcReceived,
  completeOnboarding,
  dismissTourIfPresent,
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
 * Assert the peer's exchanged R-Card rendered as the default `ContactCard`
 * in the Contacts list, NOT the trading-card profile's `TradingCard`. Proves
 * the positive (a card with the peer's name + photo actually rendered)
 * before trusting the negative (no `TradingCard`/`TradingCardRarity`) — see
 * this file's header comment on why the positive check can't be skipped.
 */
async function assertDefaultContactCardRendered(driver, peerName, timeout = 60000) {
  // Same overlay-dismissal dance run-vrc-exchange-trading-card.js does:
  // whichever side just tapped ProposalAccept lands on Chat.tsx's
  // "Relationship confirmed" overlay, not the Contacts list.
  if (await byTextContains(driver, "View contacts").isExisting().catch(() => false)) {
    await byTextContains(driver, "View contacts").click();
    console.log(`[e2e] ${driver.e2ePlatform}: dismissed relationship-confirmed overlay via "View contacts"`);
  }
  await returnToContacts(driver).catch(() => {});
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const cardRenderedWithContent =
      (await existsTestId(driver, "ContactAvatarImage", 4000)) &&
      (await byTextContains(driver, peerName).isExisting());
    if (cardRenderedWithContent) {
      // Positive proof established — now the negative check actually means
      // something (the screen is up, populated, and specifically NOT the
      // trading-card renderer).
      const tradingCardLeaked = await existsTestId(driver, "TradingCard", 2000);
      const rarityLeaked = await existsTestId(driver, "TradingCardRarity", 2000);
      if (tradingCardLeaked || rarityLeaked) {
        throw new Error(
          `${driver.e2ePlatform}: ACTIVE_DEMO_PROFILE=none build still rendered the trading-card ` +
            `demo's TradingCard component for "${peerName}" (TradingCard=${tradingCardLeaked}, ` +
            `TradingCardRarity=${rarityLeaked}) — the trading-card profile leaked into a plain build`
        );
      }
      console.log(
        `[e2e] ${driver.e2ePlatform}: default ContactCard rendered for "${peerName}" ` +
          `(no TradingCard leak)`
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await screenshot(driver, "default-contact-card-missing");
  throw new Error(
    `${driver.e2ePlatform}: no card (default ContactCard or otherwise) rendered for "${peerName}" ` +
      `within ${timeout}ms — can't tell a plain build apart from a broken one`
  );
}

/**
 * Assert the Wallet tab shows no trace of the Approver demo
 * (`ApproverHomeBanner`/`ApproverRequestAccess` — its two own testIDs, see
 * ApproverHomeBanner.tsx), guarded by the SAME positive-first pattern as
 * above: confirm the Wallet tab's default empty-credentials state
 * (`NoCredentials` — Keyring's own `EmptyList` override) is actually showing
 * before trusting the absence checks — this run issues no credentials, so
 * `NoCredentials` is what a correctly-rendered, demo-free Wallet tab looks
 * like.
 */
async function assertNoApproverBanner(driver, timeout = 30000) {
  if (await byTextContains(driver, "View contacts").isExisting().catch(() => false)) {
    await byTextContains(driver, "View contacts").click();
    console.log(`[e2e] ${driver.e2ePlatform}: dismissed relationship-confirmed overlay via "View contacts"`);
  }
  await returnToContacts(driver).catch(() => {});
  await waitForTestId(driver, "Wallet", 30000);
  await tapTestId(driver, "Wallet");
  // Same tour-overlay caveat run-approver-exchange.js documents: the
  // credential-list tour auto-starts the first time this screen renders with
  // zero credentials, which is always true here (no issuance in this run).
  await dismissTourIfPresent(driver);

  const emptyStateShown = await existsTestId(driver, "NoCredentials", timeout);
  if (!emptyStateShown) {
    await screenshot(driver, "wallet-tab-not-rendered");
    throw new Error(
      `${driver.e2ePlatform}: Wallet tab's default empty-credentials state (NoCredentials) never ` +
        `appeared within ${timeout}ms — can't trust an absence check on a screen that may not have rendered`
    );
  }

  const bannerLeaked = await existsTestId(driver, "ApproverHomeBanner", 2000);
  const requestButtonLeaked = await existsTestId(driver, "ApproverRequestAccess", 2000);
  if (bannerLeaked || requestButtonLeaked) {
    throw new Error(
      `${driver.e2ePlatform}: ACTIVE_DEMO_PROFILE=none build still rendered the Approver demo's ` +
        `credential-list footer (ApproverHomeBanner=${bannerLeaked}, ApproverRequestAccess=` +
        `${requestButtonLeaked}) — the approver profile leaked into a plain build`
    );
  }
  console.log(`[e2e] ${driver.e2ePlatform}: Wallet tab confirmed clean of Approver demo UI`);
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
    // BOTH wallets attach a photo — unlike run-vrc-exchange-trading-card.js
    // (which only needs one side's photo to prove the field survives the
    // exchange), this run's positive check (ContactAvatarImage rendered)
    // has to hold on BOTH sides' Contacts list, since it asserts the default
    // ContactCard on both. A contact with no photo renders the fallback
    // account icon instead of ContactAvatarImage — a false "TradingCard
    // absent" reading on that side would prove nothing.
    completeOnboarding(a, { firstName: "Alice", lastName: "Anderson", photo: true }),
    completeOnboarding(b, { firstName: "Bob", lastName: "Baker", photo: true }),
  ]);

  const invitationUrl = await showRelationshipInvitation(a);
  await acceptInvitationViaPaste(b, invitationUrl);

  // v4 pairs: consent is the RELATIONSHIP PROPOSAL — same as every other
  // trust-task VRC runner.
  await acceptRelationshipProposalOnEitherSide(a, b);

  await Promise.all([
    assertVrcReceived(a, "Bob Baker"),
    assertVrcReceived(b, "Alice Anderson"),
  ]);

  await Promise.all([
    assertTrustTaskExchangeMarkers(a),
    assertTrustTaskExchangeMarkers(b),
  ]);

  // The point of this run: the exchanged card is the plain default on BOTH
  // sides, and the Wallet tab on BOTH sides is free of the Approver demo —
  // proving `ACTIVE_DEMO_PROFILE=none` actually kept both installed demo
  // profiles out of the running container, not just out of the unit test.
  await assertDefaultContactCardRendered(a, "Bob Baker");
  await assertDefaultContactCardRendered(b, "Alice Anderson");
  await assertNoApproverBanner(a);
  await assertNoApproverBanner(b);

  printSuccess("plain-build-smoke");
  process.exitCode = 0;
} catch (err) {
  printFailure("plain-build-smoke", err);
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
