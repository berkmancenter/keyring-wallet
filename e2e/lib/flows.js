import {
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
      await sleep(2000); // unknown/transitional screen — wait and re-dispatch
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
  if (!(await existsTestId(driver, "Enter", 1500))) return false;
  const pinInput = byTestId(driver, "EnterPIN");
  if (!(await pinInput.isExisting())) return false;
  console.log(`[e2e] ${driver.e2ePlatform}: wallet locked — unlocking`);
  await pinInput.click();
  await pinInput.setValue(PIN);
  await hideKeyboard(driver);
  await tapTestId(driver, "Enter");
  await sleep(3000);
  return true;
}

/** Dismiss the post-onboarding feature tour popup if it's showing. */
export async function dismissTourIfPresent(driver) {
  if (await existsTestId(driver, "Close", 5000)) {
    await tapTestId(driver, "Close");
    console.log(`[e2e] ${driver.e2ePlatform}: tour popup dismissed`);
  }
}

/** Open the QR bottom sheet from the center tab and show "my QR" for a relationship exchange. */
export async function showRelationshipInvitation(driver) {
  await dismissTourIfPresent(driver);
  // The QR tab's testID is derived from the translated label; try common variants.
  const qrTabCandidates = ["QRCode", "QR Code", "Connect"];
  let opened = false;
  for (const key of qrTabCandidates) {
    if (await existsTestId(driver, key, 3000)) {
      await tapTestId(driver, key);
      opened = true;
      break;
    }
  }
  if (!opened) {
    // fallback: accessibility label from TabStack.QRCode translation
    await byText(driver, "QR Code").click();
  }

  await tapTestId(driver, "GenerateRelationshipQRCode", 15000);

  // QR view renders; the invitation URL is exposed via the __DEV__-only hidden text.
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
  const qrTabCandidates = ["QRCode", "QR Code", "Connect"];
  for (const key of qrTabCandidates) {
    if (await existsTestId(driver, key, 3000)) {
      await tapTestId(driver, key);
      break;
    }
  }
  // Bottom sheet → "Scan QR code" → Scan screen (camera) → header "paste URL" button
  await tapTestId(driver, "ScanQRCode", 15000);
  // First visit shows a camera-use disclosure; accept it (OS permission dialog is
  // auto-granted/accepted by the session caps).
  if (!(await existsTestId(driver, "PasteUrlButton", 8000))) {
    if (await existsTestId(driver, "Continue", 5000)) {
      await tapTestId(driver, "Continue");
    }
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
 * After the connection completes, the app opens the contact chat and a
 * "Credential offer received — Would you like to accept it? YES / NO" message
 * appears (both wallets: the VRC flow is bidirectional). Tap YES → CredentialOffer
 * screen → Accept → wait for "added to your wallet" → Done.
 */
export async function acceptCredentialOfferFromChat(driver, timeout = 300000) {
  const yesDeadline = Date.now() + timeout;
  const yes = byText(driver, "YES");
  while (!(await yes.isExisting())) {
    if (Date.now() > yesDeadline) {
      throw new Error(
        `${driver.e2ePlatform}: credential offer YES button not found in chat within ${timeout}ms`
      );
    }
    await unlockIfLocked(driver);
    await sleep(2000);
  }
  await yes.click();
  console.log(`[e2e] ${driver.e2ePlatform}: credential offer opened from chat`);

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
