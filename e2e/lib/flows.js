import {
  acceptSystemAlertIfPresent,
  byTestId,
  byText,
  byTextContains,
  existsTestId,
  scrollToTestId,
  sleep,
  tapTestId,
  waitForTestId,
  screenshot,
} from "./driver.js";
export { sleep };
import { PIN } from "./config.js";

/**
 * Drive a fresh install through the full onboarding:
 * tutorial carousel → PIN create → biometry → R-Card form → main tabs.
 */
async function hideKeyboard(driver, inputEl) {
  try {
    if (driver.e2ePlatform === "ios") {
      // XCUITest can't reliably hide the keyboard on home-button-less iPhones.
      // Text keyboards: press return. Numeric keypads have no return key, so
      // fall back to tapping a neutral spot (the nav header) to blur the input.
      if (inputEl) {
        try {
          await inputEl.addValue("\n");
        } catch {
          /* numeric keypad — no return key */
        }
      }
      // Tap inside the screen's content area (not the nav header): RN dismisses the
      // keyboard when the surrounding ScrollView is tapped.
      await driver.execute("mobile: tap", { x: 235, y: 240 });
    } else {
      await driver.hideKeyboard();
    }
  } catch {
    /* keyboard may not be shown */
  }
}

export async function completeOnboarding(driver, { firstName, lastName }) {
  // Screen-dispatch loop: onboarding step order varies (tutorial, PIN explainer, PIN,
  // biometry, wallet naming, R-Card). Handle whichever known screen is visible until
  // the main tab bar appears.
  const deadline = Date.now() + 5 * 60 * 1000;
  let lastAction = "";

  while (Date.now() < deadline) {
    if (await existsTestId(driver, "Contacts", 2000)) {
      console.log(`[e2e] ${driver.e2ePlatform}: onboarding complete`);
      return;
    }

    if (await existsTestId(driver, "GetStarted", 2000)) {
      await tapTestId(driver, "GetStarted");
      lastAction = "GetStarted";
      continue;
    }

    if (await existsTestId(driver, "EnterPIN", 2000)) {
      const enterPin = byTestId(driver, "EnterPIN");
      await enterPin.click();
      await enterPin.setValue(PIN);
      const reenterPin = await waitForTestId(driver, "ReenterPIN");
      await reenterPin.click();
      await reenterPin.setValue(PIN);
      await hideKeyboard(driver);
      await tapTestId(driver, "CreatePIN");
      lastAction = "CreatePIN";
      continue;
    }

    if (await existsTestId(driver, "NameInput", 2000)) {
      const name = byTestId(driver, "NameInput");
      await name.clearValue();
      await name.setValue(`${firstName} Wallet`);
      await hideKeyboard(driver, name);
      await tapTestId(driver, "Continue");
      lastAction = "NameWallet";
      continue;
    }

    if (await existsTestId(driver, "RCardFirstNameInput", 2000)) {
      const first = byTestId(driver, "RCardFirstNameInput");
      await first.setValue(firstName);
      const last = byTestId(driver, "RCardLastNameInput");
      await last.setValue(lastName);
      await hideKeyboard(driver, last);
      await tapTestId(driver, "RCardSubmit");
      lastAction = "RCardSubmit";
      // R-Card creation can take a while (key generation + signing)
      await waitForTestId(driver, "Contacts", 120000);
      console.log(`[e2e] ${driver.e2ePlatform}: onboarding complete`);
      return;
    }

    // interstitials: PIN explainer, biometry screen, etc.
    let tapped = false;
    for (const key of ["ContinueCreatePIN", "Continue"]) {
      if (await existsTestId(driver, key, 2000)) {
        await tapTestId(driver, key);
        lastAction = key;
        tapped = true;
        break;
      }
    }
    if (!tapped) {
      // real devices: an OS permission dialog (notifications, local network…)
      // may be blocking the screen underneath
      const hadAlert = await acceptSystemAlertIfPresent(driver);
      if (!hadAlert) await sleep(2000); // unknown/transitional screen — wait and re-dispatch
    }
  }
  throw new Error(
    `onboarding did not finish within 5min (last action: ${lastAction})`
  );
}

/**
 * The wallet locks after 5 min of inactivity (long mediator round-trips can exceed it).
 * If the PIN unlock screen is showing, enter the PIN and unlock.
 */
export async function unlockIfLocked(driver) {
  // Detect by the PIN field: the inactivity-lock screen ("You were locked
  // out after N minutes") has NO Enter button — it auto-submits on the final
  // digit — while the cold-start unlock screen has one. Checking for the
  // Enter button first (as this used to) made inactivity locks undetectable
  // and long waits died staring at the PIN screen.
  const pinInput = byTestId(driver, "EnterPIN");
  if (!(await pinInput.isExisting())) return false;
  console.log(`[e2e] ${driver.e2ePlatform}: wallet locked — unlocking`);
  await pinInput.click();
  await pinInput.setValue(PIN);
  if (await existsTestId(driver, "Enter", 1500)) {
    await hideKeyboard(driver);
    await tapTestId(driver, "Enter");
  }
  await sleep(3000);
  return true;
}

/** Dismiss the post-onboarding feature tour popup if it's showing. */
export async function dismissTourIfPresent(driver) {
  if (await existsTestId(driver, "Close", 5000)) {
    await tapTestId(driver, "Close");
    console.log(`[e2e] ${driver.e2ePlatform}: tour popup dismissed`);
    // Let the tour modal's dismissal animation fully release the presentation
    // slot: on real iPhones, presenting another RN Modal (the QR sheet) while
    // the dismissal is in flight fails SILENTLY and leaves the app in a stuck
    // state (visible=true but no window) that only an app restart clears.
    await sleep(2500);
  }
}

/**
 * Terminate + relaunch the app, then unlock and clear the tour. Recovery for
 * the stuck-RN-Modal state above (restart remounts everything with modal
 * state reset). Wallet data persists — only the session is lost.
 */
export async function restartApp(driver) {
  const { APP_ID } = await import("./config.js");
  console.log(
    `[e2e] ${driver.e2ePlatform}: restarting app (stuck modal recovery)`
  );
  await driver.terminateApp(APP_ID).catch(() => {});
  await sleep(2000);
  await driver.activateApp(APP_ID);
  await sleep(5000);
  await unlockIfLocked(driver);
  await dismissTourIfPresent(driver);
}

/**
 * Enable the "Hardware Attestation" preference (OFF by default on fresh
 * installs). Settings tab → Secure Exchanges toggle → confirm PIN on the
 * dedicated screen. Without this, VRC issuance skips biometric/hardware
 * evidence and the Secure Exchange banner can never appear.
 *
 * On iOS the Settings row uses accessible=true which sometimes hides the
 * inner switch from automation; prefer the explicit `-toggle` testID when
 * present, then fall back to the row itself.
 */
export async function enableHardwareAttestation(driver) {
  await dismissTourIfPresent(driver); // tour popup shows right after onboarding
  await tapTestId(driver, "Settings", 15000);

  // Open the ToggleHardwareAttestation screen (PIN-gated preference change).
  if (await existsTestId(driver, "HardwareAttestation-toggle", 5000)) {
    await tapTestId(driver, "HardwareAttestation-toggle");
  } else {
    await tapTestId(driver, "HardwareAttestation", 15000);
  }

  // Screen with the in-page ToggleButton (testID ToggleHardwareAttestation).
  // If we're already past it somehow, skip straight to the PIN field.
  if (await existsTestId(driver, "ToggleHardwareAttestation", 15000)) {
    await tapTestId(driver, "ToggleHardwareAttestation");
  }

  const pinInput = await waitForTestId(
    driver,
    "HardwareAttestationChangedEnterPIN",
    20000
  );
  await pinInput.click();
  await pinInput.setValue(PIN);
  await hideKeyboard(driver);
  await tapTestId(driver, "Continue", 15000);
  await sleep(2000);
  console.log(`[e2e] ${driver.e2ePlatform}: hardware attestation enabled`);
  // back to the Contacts tab for the rest of the flow
  if (await existsTestId(driver, "Back", 3000)) {
    await tapTestId(driver, "Back");
  }
  await tapTestId(driver, "Contacts", 15000);
}

/** The QR exchange bottom sheet is open if any of its content is visible. */
async function qrSheetIsOpen(driver, timeout = 4000) {
  for (const key of ["ScanQRCode", "QRCodeExchangeTitle"]) {
    if (await existsTestId(driver, key, timeout)) return true;
  }
  return false;
}

/**
 * Open the QR exchange bottom sheet. Preferred path: the "Invite Contact"
 * button on the empty Contacts list (a plain Button — reliable across app
 * versions; the center QR tab's custom tabBarButton misses synthetic taps on
 * some builds). Fallback: the QR tab (testID derived from translated label).
 *
 * IMPORTANT: never tap the opener while the sheet is already up — the tap
 * lands on the sheet's dark overlay and CLOSES it (open/close toggle loop).
 */
async function openQrSheet(driver) {
  if (await qrSheetIsOpen(driver, 1500)) return;
  if (await existsTestId(driver, "InviteContact", 3000)) {
    await tapTestId(driver, "InviteContact");
    return;
  }
  const qrTabCandidates = ["QRCode", "QR Code", "Connect"];
  for (const key of qrTabCandidates) {
    if (await existsTestId(driver, key, 3000)) {
      await tapTestId(driver, key);
      return;
    }
  }
  // fallback: accessibility label from TabStack.QRCode translation
  await byText(driver, "QR Code").click();
}

/** Open the QR bottom sheet from the center tab and show "my QR" for a relationship exchange. */
export async function showRelationshipInvitation(driver) {
  await dismissTourIfPresent(driver);
  // A lingering tour overlay can swallow the first tab tap (older builds attach
  // tour steps to the tab bar) — retry until the bottom sheet actually shows.
  let sheetOpen = false;
  for (let attempt = 0; attempt < 4 && !sheetOpen; attempt++) {
    if (attempt > 0) {
      // a failed attempt leaves the RN Modal state stuck (visible=true, never
      // presented) — only an app restart resets it
      await restartApp(driver);
    }
    await acceptSystemAlertIfPresent(driver);
    await dismissTourIfPresent(driver);
    await openQrSheet(driver);
    sheetOpen = await existsTestId(driver, "GenerateRelationshipQRCode", 8000);
  }
  await tapTestId(driver, "GenerateRelationshipQRCode", 15000);

  // QR view renders; the invitation URL is exposed via the __DEV__-only hidden text.
  // The Scan screen occasionally comes up blank on iOS (camera-disclosure Modal
  // fails to present when mounted mid animation) — back out and re-enter.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await existsTestId(driver, "InvitationUrl", 20000)) break;
    if (await existsTestId(driver, "Continue", 3000)) {
      await tapTestId(driver, "Continue");
      continue;
    }
    console.log(
      `[e2e] ${driver.e2ePlatform}: QR view blank — re-entering Scan screen`
    );
    if (await existsTestId(driver, "Back", 3000)) {
      await tapTestId(driver, "Back");
    }
    await openQrSheet(driver);
    await tapTestId(driver, "GenerateRelationshipQRCode", 15000);
  }
  const el = await waitForTestId(driver, "InvitationUrl", 60000);
  const url =
    driver.e2ePlatform === "android"
      ? await el.getText()
      : await el.getAttribute("label");
  if (!url || !url.includes("oob=")) {
    await screenshot(driver, "invitation-missing");
    throw new Error(
      `could not read invitation URL (got: ${String(url).slice(0, 80)}…)`
    );
  }
  console.log(
    `[e2e] ${driver.e2ePlatform}: invitation URL captured (${url.length} chars)`
  );
  return url;
}

/** On the receiving wallet: open scan → paste URL → connect. */
export async function acceptInvitationViaPaste(driver, invitationUrl) {
  await dismissTourIfPresent(driver);
  // A lingering tour overlay can swallow the first tab tap — retry until the
  // bottom sheet actually shows.
  let sheetOpen = false;
  for (let attempt = 0; attempt < 4 && !sheetOpen; attempt++) {
    if (attempt > 0) {
      await restartApp(driver);
    }
    await acceptSystemAlertIfPresent(driver);
    await openQrSheet(driver);
    sheetOpen = await existsTestId(driver, "ScanQRCode", 8000);
  }
  // Bottom sheet → "Scan QR code" → Scan screen (camera) → header "paste URL" button.
  // First visit shows a camera-use disclosure modal; accept it (OS permission dialog
  // is auto-granted/accepted by the session caps). On iOS the RN Modal occasionally
  // fails to present when it mounts mid push-animation (blank Scan screen, disclosure
  // window empty) — back out and re-enter the screen to re-present it.
  await tapTestId(driver, "ScanQRCode", 15000);
  let pasteReady = false;
  for (let attempt = 0; attempt < 4 && !pasteReady; attempt++) {
    // real devices: camera mount fires the OS permission prompt here
    await acceptSystemAlertIfPresent(driver);
    if (await existsTestId(driver, "PasteUrlButton", 8000)) {
      pasteReady = true;
      break;
    }
    if (await existsTestId(driver, "Continue", 5000)) {
      await tapTestId(driver, "Continue");
      pasteReady = await existsTestId(driver, "PasteUrlButton", 10000);
      if (pasteReady) break;
    }
    // blank Scan screen (disclosure modal never presented): back out — or
    // restart if even Back is unreachable — then re-open the sheet and re-enter
    console.log(
      `[e2e] ${driver.e2ePlatform}: Scan screen blank — backing out and re-entering`
    );
    if (await existsTestId(driver, "Back", 3000)) {
      await tapTestId(driver, "Back");
      await sleep(2000); // let the pop animation finish before re-presenting
    } else {
      await restartApp(driver);
    }
    await openQrSheet(driver);
    await tapTestId(driver, "ScanQRCode", 15000);
  }
  await tapTestId(driver, "PasteUrlButton", 30000);
  const input = await waitForTestId(driver, "PastedUrl", 15000);
  await input.setValue(invitationUrl);
  // multiline input: don't send \n — tap a neutral spot to dismiss the keyboard
  await hideKeyboard(driver);
  // the long URL grows the input; the button may be below the fold
  const submit = await scrollToTestId(driver, "ScanPastedUrl");
  await submit.click();
  console.log(`[e2e] ${driver.e2ePlatform}: invitation pasted & submitted`);
}

/**
 * Real devices only: the issuer side shows the in-app biometric confirmation
 * modal (hardware attestation) while the VRC is being issued in the background.
 * Tap Confirm, then hand off to the human operator for the OS biometric prompt
 * (fingerprint / Face ID / device PIN) — Appium cannot satisfy those.
 * No-op on emulators/simulators: hardware signing is unavailable there, so the
 * modal never appears.
 */
export async function handleBiometricConfirmIfPresent(driver) {
  if (!(await existsTestId(driver, "ConfirmBiometric", 1500))) return false;
  console.log(
    `[e2e] ${driver.e2ePlatform}: biometric confirmation modal — tapping Confirm`
  );
  await tapTestId(driver, "ConfirmBiometric");
  const deviceLabel =
    driver.e2ePlatform === "android" ? "ANDROID PHONE" : "IPHONE";
  console.log(
    `\n[e2e] ${"█".repeat(60)}\n` +
      `[e2e] █  OPERATOR: authenticate on the ${deviceLabel} NOW\n` +
      `[e2e] █  (fingerprint / Face ID, or fall back to device PIN)\n` +
      `[e2e] ${"█".repeat(60)}\n`
  );
  // give the OS prompt + human a moment before the caller's loop resumes
  await sleep(5000);
  return true;
}

/**
 * After the connection completes, the app opens the contact chat and a
 * "Credential offer received — Would you like to accept it? YES / NO" message
 * appears (both wallets: the VRC flow is bidirectional). Tap YES → CredentialOffer
 * screen → Accept → wait for "added to your wallet" → Done.
 *
 * options.expectAttestation (real-device runs): require the "Secure Exchange"
 * banner (testID AttestationVerified) on the offer screen — i.e. the peer's
 * hardware-attestation evidence chain-validated on THIS device — and fail if
 * it's absent.
 */
export async function acceptCredentialOfferFromChat(
  driver,
  timeout = 300000,
  options = {}
) {
  const yesDeadline = Date.now() + timeout;
  while (!(await byText(driver, "YES").isExisting())) {
    if (Date.now() > yesDeadline) {
      throw new Error(
        `${driver.e2ePlatform}: credential offer YES button not found in chat within ${timeout}ms`
      );
    }
    await acceptSystemAlertIfPresent(driver);
    await handleBiometricConfirmIfPresent(driver);
    await unlockIfLocked(driver);
    await sleep(2000);
  }

  // Incoming chat messages re-render the inverted list and can shift YES between
  // find and click, so the tap may land on nothing. Re-tap until the offer screen opens.
  let opened = false;
  for (let attempt = 0; attempt < 10 && !opened; attempt++) {
    const yes = byText(driver, "YES");
    if (await yes.isExisting()) {
      await yes.click().catch(() => {});
    }
    opened = await existsTestId(driver, "AcceptCredentialOffer", 5000);
  }
  if (!opened) {
    throw new Error(
      `${driver.e2ePlatform}: offer screen did not open after tapping YES 10 times`
    );
  }
  console.log(`[e2e] ${driver.e2ePlatform}: credential offer opened from chat`);

  if (options.expectAttestation) {
    // Banner renders once BiometricSignatureVerifier finishes the native
    // verification (cert chain to Apple/Google roots + signature) — proof the
    // PEER's hardware evidence validated on this device.
    if (await existsTestId(driver, "AttestationVerified", 60000)) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: ✅ Secure Exchange banner — peer hardware attestation VERIFIED`
      );
      await screenshot(driver, "attestation-verified");
    } else {
      await screenshot(driver, "attestation-missing");
      throw new Error(
        `${driver.e2ePlatform}: AttestationVerified banner not shown — peer evidence missing or chain validation failed`
      );
    }
  }

  const accept = await scrollToTestId(driver, "AcceptCredentialOffer");
  await accept.click();
  console.log(`[e2e] ${driver.e2ePlatform}: credential offer accepted`);

  // issuance round-trip over the mediator can be slow; screen title differs by flow
  // ("Credential added…" vs "Contact added…"). Poll both and recover from auto-lock.
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    for (const key of [
      "CredentialAddedToYourWallet",
      "ContactAddedToYourWallet",
    ]) {
      if (await existsTestId(driver, key, 3000)) {
        await tapTestId(driver, "Done", 30000);
        console.log(`[e2e] ${driver.e2ePlatform}: credential added to wallet`);
        return;
      }
    }
    // our own outbound issuance may request biometric signing while we wait
    await handleBiometricConfirmIfPresent(driver);
    await unlockIfLocked(driver);
  }
  throw new Error(
    `${driver.e2ePlatform}: credential-added confirmation not seen within 300000ms`
  );
}

/**
 * VRCs are intentionally HIDDEN from the Wallet credential list
 * (ListCredentials.shouldHideFromWallet filters RelationshipCredential/DTGCredential);
 * they surface as Contacts. So verify the exchange by finding the peer in the
 * Contacts tab. (The strong completion signal — credential state CredentialReceived/Done —
 * was already asserted by acceptCredentialOfferFromChat's "added to your wallet" wait.)
 */
export async function assertVrcReceived(driver, peerName, timeout = 120000) {
  const deadline = Date.now() + timeout;
  // we may still be on a stacked screen (chat) — pop back until the tab bar is reachable
  let onTab = false;
  for (let backs = 0; backs < 3 && !onTab; backs++) {
    if (await existsTestId(driver, "Contacts", 3000)) {
      await tapTestId(driver, "Contacts");
      onTab = true;
      break;
    }
    await unlockIfLocked(driver);
    if (await existsTestId(driver, "BackButton", 2000)) {
      await tapTestId(driver, "BackButton");
    }
  }
  // The contact row shows the peer's R-card name once the VRC is stored —
  // proves the credential (not just the connection) made it across.
  while (Date.now() < deadline) {
    if (await byTextContains(driver, peerName).isExisting()) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: VRC contact "${peerName}" visible in Contacts list`
      );
      return;
    }
    await unlockIfLocked(driver);
    await sleep(3000);
  }
  await screenshot(driver, "vrc-missing");
  throw new Error(
    `${driver.e2ePlatform}: contact "${peerName}" did not appear within ${timeout}ms`
  );
}
