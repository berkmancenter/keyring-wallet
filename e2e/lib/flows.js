import {
  acceptSystemAlertIfPresent,
  collapseNotificationShadeIfOpen,
  byTestId,
  byText,
  byTextContains,
  deviceTag,
  existsTestId,
  scrollToTestId,
  sleep,
  tapTestId,
  tapTestIdReliable,
  waitForTestId,
  screenshot,
} from "./driver.js";
export { sleep };
import { PIN, APP_ID } from "./config.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TEST_PHOTO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "test-rcard-photo.jpg"
);

/**
 * Drive a fresh install through the full onboarding:
 * tutorial carousel → PIN create → biometry → R-Card form → main tabs.
 */
/**
 * Wait for the app's own keyboard dismissal to finish (PINInput calls
 * Keyboard.dismiss() when the final PIN digit lands). Use this INSTEAD of
 * hideKeyboard() on screens presented inside an RN Modal: Appium's Android
 * hideKeyboard checks dumpsys for keyboard visibility and, racing the app's
 * own dismissal animation, concludes the keyboard is still up and sends
 * KEYCODE_ESC/KEYCODE_BACK — which an RN Modal (an android.app.Dialog)
 * receives as cancel, silently dismissing the modal. Seen deterministically
 * on Android 16 (SDK 36) as "element testID=Continue not found": the PIN
 * modal was gone before the harness looked for its Continue button.
 */
async function waitForKeyboardGone(driver, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (!(await driver.isKeyboardShown())) return;
    } catch {
      return; // treat "can't tell" as gone — same as hideKeyboard's catch-all
    }
    await sleep(250);
  }
}

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

function androidUdid(driver) {
  return (
    driver.capabilities.deviceUDID ||
    driver.capabilities["appium:udid"] ||
    driver.capabilities.udid
  );
}

/**
 * Seed a fixed test JPEG into the device's photo library so the R-Card photo
 * picker has something to select, and pre-grant the media permission so the
 * OS permission dialog doesn't block the picker. Best-effort/non-fatal (same
 * posture as createSession's iOS camera pre-grant): a failure here just means
 * pickRCardPhoto won't find a photo to pick, not a hard e2e failure.
 */
export async function seedTestPhoto(driver) {
  const { execSync } = await import("node:child_process");
  try {
    if (driver.e2ePlatform === "android") {
      const udid = androidUdid(driver);
      execSync(
        `adb -s ${udid} push "${TEST_PHOTO_PATH}" /sdcard/Pictures/rcard-e2e-test-photo.jpg`
      );
      execSync(
        `adb -s ${udid} shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/rcard-e2e-test-photo.jpg`
      );
      // READ_MEDIA_IMAGES (API 33+) — older API levels use READ_EXTERNAL_STORAGE,
      // granted at install time by default in the test build; this grant is a
      // no-op (and harmless) on those levels.
      execSync(
        `adb -s ${udid} shell pm grant ${APP_ID} android.permission.READ_MEDIA_IMAGES`
      );
      console.log(`[e2e] android: seeded test photo + granted media permission`);
    } else {
      execSync(`xcrun simctl addmedia booted "${TEST_PHOTO_PATH}"`);
      execSync(`xcrun simctl privacy booted grant photos ${APP_ID}`);
      console.log(`[e2e] ios: seeded test photo + granted photos permission`);
    }
  } catch (err) {
    console.log(
      `[e2e] ${driver.e2ePlatform}: seedTestPhoto failed (non-fatal — photo picker will have nothing to pick): ${err.message}`
    );
  }
}

/**
 * Drive the R-Card onboarding photo picker: tap the photo control, select the
 * (single) seeded test photo, and confirm the crop screen.
 *
 * UNVERIFIED: the native photo-grid-cell and crop-confirm selectors below are
 * best-effort guesses at the stock iOS PHPicker / Android UCrop UI (as wired
 * by expo-image-picker with allowsEditing:true) and have not been exercised
 * against a real simulator/emulator in this environment. If the native picker
 * UI doesn't match these selectors, this degrades to logging a warning and
 * returning without a photo (RCardOnboarding submits fine either way, since
 * the photo is optional) rather than hanging the run — but it means
 * assertContactPhotoReceived will then legitimately fail, which is the
 * correct signal that these selectors need updating against a real device.
 */
export async function pickRCardPhoto(driver) {
  await tapTestId(driver, "RCardPhotoInput");
  await acceptSystemAlertIfPresent(driver);
  await sleep(2000);

  try {
    // Android's system Photo Picker (com.google.android.providers.media.module)
    // wraps each grid thumbnail in a clickable FrameLayout carrying a
    // "Photo taken on ..." content-desc; the ImageView thumbnail inside it
    // is NOT itself clickable, confirmed via a live uiautomator dump against
    // this exact picker on 2026-09-04.
    const photoCell =
      driver.e2ePlatform === "android"
        ? driver.$(
            'android=new UiSelector().clickable(true).descriptionContains("Photo")'
          )
        : driver.$("-ios class chain:**/XCUIElementTypeCell[1]");
    await photoCell.waitForExist({ timeout: 8000 });
    await photoCell.click();
  } catch (err) {
    console.log(
      `[e2e] ${driver.e2ePlatform}: could not find a photo to select in the native picker (non-fatal): ${err.message}`
    );
    // Back out of the native picker rather than leaving it open — a stuck
    // picker fails every later step in the flow with a confusing, unrelated
    // "element not found" error instead of this one legible message.
    try {
      const cancel =
        driver.e2ePlatform === "android"
          ? driver.$('android=new UiSelector().description("Cancel")')
          : byText(driver, "Cancel");
      if (await cancel.isExisting()) {
        await cancel.click();
      }
    } catch {
      /* best-effort dismissal only */
    }
    return;
  }

  await sleep(1500);
  if (driver.e2ePlatform === "android") {
    // android-image-cropper's own confirm button — confirmed via a live
    // uiautomator dump against this exact crop screen on 2026-09-04: its
    // visible label is "CROP" (all-caps, so a case-sensitive `text("Crop")`
    // UiSelector match never fires), but its resource-id is stable regardless
    // of label casing/localization, so prefer that.
    try {
      const cropButton = driver.$(
        'android=new UiSelector().resourceId("asml.bkc.harvard.wallet:id/crop_image_menu_crop")'
      );
      if (await cropButton.isExisting()) {
        await cropButton.click();
      }
    } catch {
      /* fall through to the generic label search below */
    }
  }
  // Try the plausible crop/selection confirm labels for each platform in turn
  // (covers the iOS PHPicker/UCrop-equivalent flow, and is a harmless no-op on
  // Android if the resource-id match above already confirmed the crop).
  const confirmLabels =
    driver.e2ePlatform === "ios"
      ? ["Choose", "Use Photo", "Done"]
      : ["CROP", "Crop", "Done", "OK", "Save"];
  for (const label of confirmLabels) {
    try {
      const el = byText(driver, label);
      if (await el.isExisting()) {
        await el.click();
        break;
      }
    } catch {
      /* try the next candidate label */
    }
  }

  await sleep(1500);
  if (!(await existsTestId(driver, "RCardPhotoPreview", 5000))) {
    console.log(
      `[e2e] ${driver.e2ePlatform}: photo picker did not produce a preview — continuing onboarding without a photo`
    );
  }
}

export async function completeOnboarding(
  driver,
  { firstName, lastName, photo = false }
) {
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
      if (photo) {
        await seedTestPhoto(driver);
        await pickRCardPhoto(driver);
      }
      await tapTestId(driver, "RCardSubmit");
      lastAction = "RCardSubmit";
      // R-Card creation can take a while (key generation + signing) — and the
      // app can be watchdog-killed and relaunched mid-creation under CPU
      // contention (observed with a cold emulator boot running beside the
      // simulator), landing on the unlock screen. Poll unlock-aware instead
      // of staring at a screen that will never show Contacts.
      const rcardDeadline = Date.now() + 120000;
      for (;;) {
        if (await existsTestId(driver, "Contacts", 3000)) break;
        if (Date.now() > rcardDeadline)
          throw new Error(`${driver.e2ePlatform}: Contacts did not appear within 120000ms after RCardSubmit`);
        await unlockIfLocked(driver);
      }
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
    // A dropped tap here (same class of flakiness tapTestIdReliable exists
    // for elsewhere in this file) leaves the wallet locked indefinitely —
    // verify the PIN screen actually went away, re-tapping if it didn't.
    // Generous timeout/settle: under heavy host contention (this sandbox
    // runs the emulators alongside a full, actively-used desktop — real
    // swap usage observed growing under load) a single webdriver round
    // trip (e.g. getElementTagName) has been observed to take 10+ seconds.
    await tapTestIdReliable(driver, "Enter", () => existsTestId(driver, "EnterPIN", 1500).then((v) => !v), {
      timeout: 90000,
      attempts: 6,
      settleMs: 5000,
    });
  } else {
    // Inactivity-lock variant: auto-submits on the final digit — just wait
    // for the PIN screen to clear.
    for (let i = 0; i < 10 && (await pinInput.isExisting()); i++) await sleep(500);
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
  // A fixed sleep here raced a slow cold JS boot on a real device (observed:
  // the restart right after enableTspCarriage — a heavier bundle, freshly
  // Metro-cache-reset — took long enough that unlockIfLocked's instant,
  // non-polling existence check ran before the PIN screen had even mounted,
  // silently missing it; the caller then searched for post-unlock UI on a
  // screen that was, moments later, still the lock screen). Wait for the
  // PIN screen to actually appear (or definitively not, within a generous
  // budget) before deciding whether to unlock — existsTestId's own polling,
  // not a fixed delay, absorbs however long this particular boot takes.
  await existsTestId(driver, "EnterPIN", 15000);
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
    await tapTestIdReliable(driver, "ToggleHardwareAttestation", () =>
      existsTestId(driver, "HardwareAttestationChangedEnterPIN", 3000)
    );
  }

  const pinInput = await waitForTestId(
    driver,
    "HardwareAttestationChangedEnterPIN",
    20000
  );
  await pinInput.click();
  await pinInput.setValue(PIN);
  // NOT hideKeyboard(): on Android its ESC/BACK fallback dismisses this PIN
  // modal outright (see waitForKeyboardGone) — the app hides the keyboard
  // itself once the 6th digit is typed.
  await waitForKeyboardGone(driver);

  // The switch's own checked state only flips once this PIN modal closes via
  // onAuthenticationComplete, so a dropped Continue tap here looks like "the
  // toggle never switched" even though the toggle tap itself was fine.
  await tapTestIdReliable(driver, "Continue", async () => !(await pinInput.isExisting()));
  await sleep(2000);
  console.log(`[e2e] ${driver.e2ePlatform}: hardware attestation enabled`);
  // back to the Contacts tab for the rest of the flow. A single "Back" pop
  // (out of the Settings stack) isn't always enough: if the peer's message
  // arrives in this window, the app auto-navigates into the Chat screen for
  // that connection (its own "BackButton", not the Settings stack's "Back"),
  // stranding a bare Contacts tap. returnToContacts() pops however many
  // screens deep that lands us and is robust to either case.
  if (await existsTestId(driver, "Back", 3000)) {
    await tapTestId(driver, "Back");
  }
  await returnToContacts(driver);
}

/**
 * Set the wallet's inactivity auto-lock to "Never" (Settings → Lockout,
 * a normal, always-visible row — not developer-only). The rest of the TSP
 * flow (QR sheet, invitation, relationship proposal) spans real network
 * round trips and a second device's own onboarding running concurrently
 * under CPU contention — easily long enough to exceed the default 5-minute
 * auto-lock and relock the app mid-flow. Must be called while already on
 * the Settings screen.
 */
async function setAutoLockNever(driver) {
  await tapTestId(driver, "Lockout", 15000);
  // Settings is a SectionList (virtualized) — "Never" is the last of 5
  // inline options and isn't mounted until scrolled into view.
  let neverEl;
  for (let i = 0; i < 6; i++) {
    neverEl = byText(driver, "Never");
    if ((await neverEl.isExisting()) && (await neverEl.isDisplayed())) break;
    const { width, height } = await driver.getWindowRect();
    await driver
      .action("pointer")
      .move({ x: Math.floor(width / 2), y: Math.floor(height * 0.7) })
      .down()
      .pause(100)
      .move({ x: Math.floor(width / 2), y: Math.floor(height * 0.25), duration: 400 })
      .up()
      .perform();
    await sleep(500);
  }
  await neverEl.click();
  console.log(`[e2e] ${driver.e2ePlatform}: auto-lock set to Never`);
}

/**
 * Enable the "Enable TSP envelope carriage" developer setting (OFF by
 * default) — the dev/test-only toggle for the real TSP envelope Carriage
 * (@bifold/trust-tasks's tsp.pack/unpack over @bifold/credo-tsp-adapter's
 * Askar-backed ports) as an alternative to the default DIDComm-v1 carriage.
 * See docs/plans/openvtc-integration-plan/2026-09-02-bam.md for why this
 * doesn't need vta-service or any ecosystem counterparty — it's wallet-to-
 * wallet only, delivered over the same existing DIDComm-v1 connection.
 *
 * The "Developer" row on Settings (testID DeveloperOptions) only exists
 * once `store.preferences.developerModeEnabled` is already persisted true
 * (bifold/packages/core/src/screens/Settings.tsx) — i.e. on a LATER visit
 * to Settings, after developer mode has already been turned on. Tripping
 * the tap counter for the FIRST time takes a different path entirely:
 * Settings' own onDevModeTriggered fires as soon as the threshold trips
 * and calls `navigation.navigate(Screens.Developer)` directly, so the app
 * jumps straight to the Developer screen — there is no "DeveloperOptions"
 * row to see or tap on Settings in that transition, only afterwards.
 * (bifold/packages/core/src/hooks/developer-mode.ts:
 * TOUCH_COUNT_TO_ENABLE_DEVELOPER_MODE = 10 taps on the version footer,
 * but the counter is checked BEFORE incrementing, so it only trips on the
 * 11th tap despite the constant's name.)
 * Toggling the switch updates outbound sends immediately, but
 * setupTrustTasksInbound only registers the TSP carriage's inbound handler
 * at agent setup — a restart is required for the inbound side to pick it
 * up (same restart-to-apply behavior as most developer toggles), so this
 * restarts the app before returning.
 */
export async function enableTspCarriage(driver) {
  await dismissTourIfPresent(driver);
  await tapTestId(driver, "Settings", 15000);
  await setAutoLockNever(driver);

  if (await existsTestId(driver, "DeveloperOptions", 3000)) {
    // Developer mode was already enabled in a prior session (persisted store).
    await tapTestId(driver, "DeveloperOptions", 15000);
  } else {
    // useDeveloperMode's counter (bifold/packages/core/src/hooks/developer-
    // mode.ts) has no time-window reset — any 11 taps that land trip it,
    // however spaced out. So a plain "click 11 times" loop assumes every
    // click lands, but real devices under load occasionally drop a tap
    // silently (the same class of flake tapTestIdReliable exists to work
    // around elsewhere in this file) — losing even one of the 11 here
    // leaves the counter one short with no visible symptom until the
    // ToggleDeveloper wait afterward times out. Fix: overshoot the tap
    // count and poll for the Developer screen after each one, so a few
    // dropped taps just cost a few extra clicks instead of failing the run.
    const versionEl = await scrollToTestId(driver, "Version");
    const maxTaps = 20;
    let reachedDeveloperScreen = false;
    for (let i = 0; i < maxTaps; i++) {
      await versionEl.click().catch(() => {});
      if (await existsTestId(driver, "ToggleDeveloper", 300)) {
        reachedDeveloperScreen = true;
        console.log(`[e2e] ${deviceTag(driver)}: reached Developer screen after ${i + 1} Version taps`);
        break;
      }
      await sleep(150);
    }
    // Settings navigates to the Developer screen itself on the trip — wait
    // for a Developer-screen-only element, not a Settings row.
    if (!reachedDeveloperScreen) {
      await waitForTestId(driver, "ToggleDeveloper", 5000);
    }
  }

  // Near the bottom of the Developer screen's long ScrollView — same
  // scroll-into-view need as the Version footer above.
  const tspToggle = await scrollToTestId(driver, "ToggleEnableTspCarriage");
  await tspToggle.click();
  console.log(`[e2e] ${driver.e2ePlatform}: TSP envelope carriage enabled (developer setting)`);

  await returnToContacts(driver);
  await restartApp(driver);
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
  // A process-level watchdog kill can relock the wallet at any moment,
  // independent of the in-app inactivity timer (autoLockTime doesn't
  // prevent this — a fresh process always needs the PIN again) — check
  // every time this is called, not just once per showRelationshipInvitation
  // retry loop iteration.
  await unlockIfLocked(driver);
  // Same idea for a real notification pulling the shade down over the app
  // mid-run (observed on a real device: a "QR Code" click failure whose
  // page-source dump showed only status-bar content, no app UI at all).
  await collapseNotificationShadeIfOpen(driver);
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
  // The app can be watchdog-restarted between onboarding and this step under
  // CPU contention, landing on the unlock screen — recover before tapping.
  await unlockIfLocked(driver);
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
    // The wallet's own inactivity auto-lock can fire between attempts too —
    // e.g. while this device sits idle waiting on a peer device under CPU
    // contention — independent of the watchdog-restart case above.
    await unlockIfLocked(driver);
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
  // XCUITest's simulated typing occasionally drops characters on ~1000-char
  // strings, corrupting the base64 payload — the app then shows the
  // "URL not recognized" ErrorModal. Clear, retype and resubmit until it takes.
  for (let attempt = 0; attempt < 4; attempt++) {
    const input = await waitForTestId(driver, "PastedUrl", 15000);
    if (attempt > 0) await input.clearValue();
    await input.setValue(invitationUrl);
    // multiline input: don't send \n — tap a neutral spot to dismiss the keyboard
    await hideKeyboard(driver);
    // the long URL grows the input; the button may be below the fold
    const submit = await scrollToTestId(driver, "ScanPastedUrl");
    await submit.click();
    // detect the rejection via the modal's CTA button — RN Modal testIDs
    // (ErrorModal) don't reliably surface on iOS, but children do
    if (!(await existsTestId(driver, "Try Again", 5000))) break;
    if (attempt === 3) {
      await screenshot(driver, "paste-url-rejected");
      throw new Error("invitation URL rejected 4 times (ErrorModal persisted)");
    }
    console.log(
      `[e2e] ${driver.e2ePlatform}: URL not recognized (typing flake) — retrying`
    );
    await tapTestId(driver, "Try Again", 5000);
  }
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

  // Reported to the caller so a later, separate check of the SAME underlying
  // fact (e.g. assertContactShields' Secure Exchange badge) can be told not
  // to require full verification when this device already saw the evidence
  // arrive but only as a warning — see the comment below.
  let attestationOutcome;

  if (options.expectAttestation) {
    // Banner renders once BiometricSignatureVerifier finishes the native
    // verification (cert chain to Apple/Google roots + signature) — proof the
    // PEER attempted hardware evidence. This test exercises the EXCHANGE FLOW
    // (evidence was built, sent, and locally checked) — it isn't a test of
    // whether that specific physical device's attestation root cert is still
    // within its validity window, which we don't control (e.g. Google's
    // legacy Android attestation root expired 2026-05-24; see
    // docs/HARDWARE_ATTESTATION_FLOW.md "Known limitations" #5). So a
    // warning (evidence present, chain didn't validate) is an accepted
    // outcome, not a failure — only "evidence never showed up at all" is.
    let banner = null;
    const deadline = Date.now() + 60000;
    while (!banner && Date.now() < deadline) {
      if (await existsTestId(driver, "AttestationVerified", 2000)) banner = "verified";
      else if (await existsTestId(driver, "AttestationWarning", 2000)) banner = "warning";
    }
    attestationOutcome = banner;
    if (banner === "verified") {
      console.log(
        `[e2e] ${driver.e2ePlatform}: ✅ Secure Exchange banner — peer hardware attestation VERIFIED`
      );
      await screenshot(driver, "attestation-verified");
    } else if (banner === "warning") {
      console.log(
        `[e2e] ${driver.e2ePlatform}: ⚠️ Hardware Verification Issue banner — peer evidence present but ` +
          `didn't chain-validate (commonly an aging/legacy attestation root on older hardware, not a flow ` +
          `regression); continuing`
      );
      await screenshot(driver, "attestation-warning");
    } else {
      await screenshot(driver, "attestation-missing");
      throw new Error(
        `${driver.e2ePlatform}: neither AttestationVerified nor AttestationWarning shown — peer evidence appears entirely absent`
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
        return attestationOutcome;
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
/**
 * Connect a wallet to the witness. Connecting to a witness is the SAME
 * scan/paste flow as adding a contact — the witness replies with a
 * `witness-announcement` that the app processes silently (there is NO
 * "connected to witness" banner in the UI; witness participation only
 * surfaces later as a VWC/witness-record on a contact after a witnessed
 * exchange). So this just pastes the invitation; the CALLER confirms the
 * connection completed via the witness server's own log
 * (witness.waitForParticipants). See e2e/README.md for usage.
 */
export async function connectToWitness(driver, witnessInvitationUrl) {
  await acceptInvitationViaPaste(driver, witnessInvitationUrl);
  console.log(`[e2e] ${driver.e2ePlatform}: witness invitation submitted`);
  // Connecting lands on the witness's chat screen (it sends a reporting-
  // pseudonym message). Return to the Contacts tab so the subsequent
  // relationship-invitation flow finds the QR opener in a known state.
  await returnToContacts(driver);
}

/** True once a stacked (non-tab-root) screen has been left behind. */
async function leftStackedScreen(driver) {
  return !(await byTestId(driver, "BackButton").isExisting());
}

/**
 * Pop any stacked screens and land on the Contacts tab.
 *
 * The witness sends a bounded burst of protocol messages (at most 5) right in
 * this window, and each one can auto-navigate the app back into the Chat
 * screen for that connection — bouncing us straight back out of Contacts the
 * moment we land on it. So reaching Contacts once isn't enough: confirm it
 * STAYS reached before declaring success, and retry past the worst case
 * (5 bounces) rather than giving up after a handful of attempts. On exhaustion,
 * throw — silently returning while still stuck on Chat just moves the failure
 * to whatever step runs next, with a much more confusing error.
 */
export async function returnToContacts(driver) {
  const MAX_ATTEMPTS = 10; // comfortably more than the witness's <=5-message burst
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await existsTestId(driver, "Contacts", 3000)) {
      try {
        await tapTestIdReliable(driver, "Contacts", () => leftStackedScreen(driver));
      } catch (err) {
        // The bottom tab bar's CURRENTLY SELECTED button appears to drop out
        // of the accessibility tree (its testID becomes unqueryable) once
        // active — seen after connectToWitness's chat screen: existsTestId
        // just confirmed "Contacts" above, then this re-lookup inside the
        // tap helper times out anyway. Since existsTestId only just found
        // it, that almost always means we've already landed on the Contacts
        // tab (nothing left to tap) rather than a real failure.
        if (!/not found in \d+ms/.test(err.message)) throw err;
      }
      // A witness message landing right now can bounce us back into Chat —
      // wait a beat and confirm Contacts is still there before returning.
      await sleep(1500);
      if (await existsTestId(driver, "Contacts", 2000)) return;
      continue;
    }
    await unlockIfLocked(driver);
    if (await existsTestId(driver, "BackButton", 2000)) {
      await tapTestIdReliable(driver, "BackButton", () => leftStackedScreen(driver)).catch(() => {});
    } else {
      await sleep(1500);
    }
  }
  throw new Error(
    `${driver.e2ePlatform}: could not land on Contacts within ${MAX_ATTEMPTS} attempts (witness messages may keep bouncing the app back into Chat)`
  );
}

/**
 * Open a stored contact's DETAIL screen. Tapping a Contacts row either opens
 * the CHAT (then the VRC ContactDetails screen — shields, Witness Records —
 * sits behind the chat header's ContactMenu → "View Contact") or opens
 * Contact Details directly; the helper detects which. If the chat is already
 * open for this peer, it starts from the menu.
 */
export async function openContactDetail(driver, peerName) {
  // Already on the peer's chat? (header menu present + peer name visible)
  const alreadyOnPeerChat =
    (await existsTestId(driver, "ContactMenu", 2000)) &&
    (await byTextContains(driver, peerName).isExisting());
  if (!alreadyOnPeerChat) {
    let onTab = false;
    for (let backs = 0; backs < 3 && !onTab; backs++) {
      if (await existsTestId(driver, "Contacts", 3000)) {
        await tapTestId(driver, "Contacts");
        onTab = true;
        break;
      }
      await unlockIfLocked(driver);
      if (await existsTestId(driver, "BackButton", 2000)) {
        await tapTestIdReliable(driver, "BackButton", () => leftStackedScreen(driver)).catch(() => {});
      }
    }
    const row = byTextContains(driver, peerName);
    await row.waitForExist({ timeout: 30000 });
    await row.click();
  }
  // Two shapes: the row opens the CHAT (header ContactMenu → View Contact),
  // or it opens Contact Details directly — detect which, don't assume.
  if (await existsTestId(driver, "ContactMenu", 5000)) {
    await tapTestId(driver, "ContactMenu", 5000);
    const viewContact = byTextContains(driver, "View Contact");
    await viewContact.waitForExist({ timeout: 10000 });
    await viewContact.click();
  }
}

/**
 * The culminating assertion: open the peer's contact and confirm the shields
 * the full stack produces —
 *   • "Secure Exchange" (hwVerified): the peer's DEVICE ATTESTATION on the
 *     received VRC, re-validated on-device (cert chain to Apple/Google roots).
 *   • "Verified" + a Witness Records section (witnessRecords > 0): a VWC issued
 *     by the WITNESS for this contact.
 * Together they prove VC 2.0 + eddsa-rdfc-2022 DI + attestation + witnessed all
 * landed on one credential. Text-based (works on baked-in iOS builds); the
 * testIDs SecureExchangeBadge / WitnessedBadge / WitnessSection are preferred
 * when present.
 *
 * options.requireSecureExchange (default true): pass false when the caller
 * already saw acceptCredentialOfferFromChat report a "warning" outcome for
 * this same peer — this contact-detail screen has no separate warning state
 * (ContactDetails.tsx just omits the badge, same as if there were no evidence
 * at all), so re-requiring it here would fail the run over the same
 * uncontrollable hardware/root-expiry fact already accepted upstream.
 */
/** A testID declared WITHOUT the com.ariesbifold:id/ prefix (raw accessibility id / resource-id). */
async function existsRawId(driver, key, timeout = 2000) {
  const el =
    driver.e2ePlatform === "android"
      ? driver.$(`android=new UiSelector().resourceId("${key}")`)
      : driver.$(`~${key}`);
  try {
    await el.waitForExist({ timeout });
    return true;
  } catch {
    return false;
  }
}

export async function assertContactShields(driver, peerName, timeout = 240000, options = {}) {
  const requireSecureExchange = options.requireSecureExchange ?? true;
  const deadline = Date.now() + timeout;
  let sawAttestation = false;
  let sawWitness = false;
  while (Date.now() < deadline) {
    await openContactDetail(driver, peerName);
    // ContactDetails declares these testIDs BARE (no com.ariesbifold:id/
    // prefix), so check the raw accessibility id too — the prefixed lookup
    // misses them on iOS, and the text fallback fails there because the
    // section header renders uppercased ("WITNESS RECORDS").
    sawAttestation =
      (await existsTestId(driver, "SecureExchangeBadge", 3000)) ||
      (await existsRawId(driver, "SecureExchangeBadge", 2000)) ||
      (await byTextContains(driver, "Secure Exchange").isExisting());
    sawWitness =
      (await existsTestId(driver, "WitnessSection", 3000)) ||
      (await existsRawId(driver, "WitnessSection", 2000)) ||
      (await existsRawId(driver, "WitnessedBadge", 2000)) ||
      (await byTextContains(driver, "Witness Records").isExisting());
    if ((sawAttestation || !requireSecureExchange) && sawWitness) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: "${peerName}" shows Witnessed` +
          (sawAttestation
            ? " + Secure Exchange"
            : " (Secure Exchange not required — peer reported a hardware verification warning upstream)")
      );
      return;
    }
    // Either shield may lag (VWC is issued after the VRC; hw verify is async) —
    // pop back to the list and re-open the contact to re-render.
    if (await existsTestId(driver, "BackButton", 2000)) {
      await tapTestId(driver, "BackButton");
    }
    await sleep(3000);
  }
  await screenshot(driver, "shields-missing");
  throw new Error(
    `${driver.e2ePlatform}: "${peerName}" missing a shield — Secure Exchange=${sawAttestation}, Witnessed=${sawWitness}`
  );
}

/**
 * ContactDetails renders SecureExchangeBadge only on a fully-validated chain
 * — a warning outcome (evidence present, chain didn't validate — e.g. an
 * aging attestation root, see docs/HARDWARE_ATTESTATION_FLOW.md "Known
 * limitations" #5) omits the badge exactly like no evidence at all (see
 * assertContactShields' comment). The old per-credential-offer screen used
 * to distinguish the two via its own AttestationWarning banner; v4's
 * automatic flow has no chat-screen equivalent, so Android's own
 * verification log is the only remaining signal. No equivalent surfaces on
 * iOS — this is a no-op there, same as assertTrustTaskExchangeMarkers.
 */
async function androidSawAttestationAttempt(driver) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return false;
  try {
    const { execSync } = await import("node:child_process");
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return /\[VRC:Verify\]|\[VRC:Badge\]/.test(log);
  } catch {
    return false;
  }
}

/**
 * Assert the "Secure Exchange" badge (peer device-attestation, re-validated
 * on-device) landed for the peer — attestation shield only, no witness
 * involved. For the plain (non-witnessed) real-device VRC exchange, where
 * assertContactShields' witness requirement can never be satisfied.
 *
 * options.requireSecureExchange (default true): pass false to tolerate the
 * warning outcome unconditionally instead of falling back to the Android
 * log check below (e.g. when the caller already knows the peer's evidence
 * was attempted through some other signal).
 */
export async function assertSecureExchangeBadge(driver, peerName, timeout = 120000, options = {}) {
  const requireSecureExchange = options.requireSecureExchange ?? true;
  const deadline = Date.now() + timeout;
  let sawAttestation = false;
  while (Date.now() < deadline) {
    await openContactDetail(driver, peerName);
    sawAttestation =
      (await existsTestId(driver, "SecureExchangeBadge", 3000)) ||
      (await existsRawId(driver, "SecureExchangeBadge", 2000)) ||
      (await byTextContains(driver, "Secure Exchange").isExisting());
    if (sawAttestation || !requireSecureExchange) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: "${peerName}" shows` +
          (sawAttestation
            ? " Secure Exchange"
            : " no Secure Exchange badge (not required — hardware verification warning accepted)")
      );
      return;
    }
    if (await existsTestId(driver, "BackButton", 2000)) {
      await tapTestId(driver, "BackButton");
    }
    await sleep(3000);
  }
  // Badge never rendered — tell "evidence never attempted" (real failure)
  // apart from "attempted, chain didn't validate" (tolerated) via Android's
  // own verification log before failing the run.
  if (await androidSawAttestationAttempt(driver)) {
    console.log(
      `[e2e] ${driver.e2ePlatform}: ⚠️ no Secure Exchange badge for "${peerName}", but the verification log ` +
        `shows evidence was attempted (commonly an aging/legacy attestation root, not a flow regression); continuing`
    );
    return;
  }
  await screenshot(driver, "secure-exchange-missing");
  throw new Error(`${driver.e2ePlatform}: "${peerName}" missing Secure Exchange badge after ${timeout}ms`);
}

/**
 * Assert a Verifiable Witness Credential (VWC) landed for the peer (witness
 * shield only). Kept for witness-focused checks; the full run uses
 * assertContactShields to require BOTH shields together.
 */
export async function assertWitnessCredential(driver, peerName, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await openContactDetail(driver, peerName);
    if (
      (await existsTestId(driver, "WitnessSection", 4000)) ||
      (await byTextContains(driver, "Witness Records").isExisting())
    ) {
      console.log(`[e2e] ${driver.e2ePlatform}: VWC present for "${peerName}"`);
      return;
    }
    if (await existsTestId(driver, "BackButton", 2000)) {
      await tapTestId(driver, "BackButton");
    }
    await sleep(3000);
  }
  await screenshot(driver, "vwc-missing");
  throw new Error(
    `${driver.e2ePlatform}: no VWC (Witness Records) shown for "${peerName}" within ${timeout}ms`
  );
}

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
    // Real devices only: the signed delivery that follows consent may still
    // be in flight here, requesting biometric confirmation. No-op elsewhere.
    await handleBiometricConfirmIfPresent(driver);
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
    await handleBiometricConfirmIfPresent(driver);
    await unlockIfLocked(driver);
    await sleep(3000);
  }
  await screenshot(driver, "vrc-missing");
  throw new Error(
    `${driver.e2ePlatform}: contact "${peerName}" did not appear within ${timeout}ms`
  );
}

/**
 * Assert the Trust Task relationship exchange ran alongside the legacy flow
 * (integration M2: propose + the issue leg in shadow mode), from the Android
 * side's logcat. One android device sees the whole exchange regardless of
 * which peer was the deterministic proposer:
 *  - a propose marker (sent, accepted, or #response consumed),
 *  - "issue sent"            — this side delivered its VRC on the exchange,
 *  - "issue receipt sent"    — it receipted the peer's delivery,
 *  - "issue receipt matched" — the peer's receipt correlated to our delivery.
 * No-op on iOS drivers (no logcat; the Android log covers both directions).
 */
export async function assertTrustTaskExchangeMarkers(driver, timeout = 60000) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  const { execSync } = await import("node:child_process");
  const required = [
    [/\[TrustTasks:Ceremony\] discovery (sent|answered|confirmed propose support)/, "discovery"],
    [/\[TrustTasks:Ceremony\] propose (sent|accepted|received|#response consumed)/, "propose"],
    [/\[TrustTasks:Ceremony\] issue sent/, "issue sent"],
    [/\[TrustTasks:Ceremony\] issue (stored|already stored)/, "issue stored"],
    [/\[TrustTasks:Ceremony\] issue receipt sent/, "issue receipt sent"],
    [/\[TrustTasks:Ceremony\] issue receipt matched/, "issue receipt matched"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(
        "[e2e] android: trust-task exchange markers all present (propose + issue legs)"
      );
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `android: trust-task markers missing after ${timeout}ms: ${missing
      .map(([, name]) => name)
      .join(", ")}`
  );
}

/**
 * Confirm the TSP envelope carriage specifically ran (not just that a
 * document arrived, which either carriage would show) — from the Android
 * side's logcat, distinct from assertTrustTaskExchangeMarkers's
 * [TrustTasks:Ceremony] markers. Requires enableTspCarriage() to have been
 * run (and the app restarted) on the device(s) under test first. No-op on
 * iOS drivers (no logcat; the Android log covers both directions).
 */
export async function assertTspCarriageMarkers(driver, timeout = 60000) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  const { execSync } = await import("node:child_process");
  const required = [
    [/\[TrustTasks:TspCarriage\] envelope sent/, "envelope sent"],
    [/\[TrustTasks:TspCarriage\] envelope received/, "envelope received"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(
        "[e2e] android: TSP envelope carriage markers present (sent + received)"
      );
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `android: TSP carriage markers missing after ${timeout}ms: ${missing
      .map(([, name]) => name)
      .join(", ")}`
  );
}

/**
 * The witness-session markers of a witnessed exchange (§9 step 5), from
 * Android's run-scoped logcat: session → challenge → VP → VWC, plus the
 * outcome-evidence self-check (presentation assembled from the retained pair
 * and verified). No-op on iOS drivers.
 */
export async function assertWitnessCeremonyMarkers(driver, timeout = 90000) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  const { execSync } = await import("node:child_process");
  const required = [
    [/\[TrustTasks:Witness\] session opened/, "session opened"],
    [/\[TrustTasks:Witness\] challenge received/, "challenge received"],
    [/\[TrustTasks:Witness\] presentation submitted/, "presentation submitted"],
    [/\[TrustTasks:Witness\] VWC stored/, "VWC stored"],
    [/\[TrustTasks:Ceremony\] outcome evidence assembled and verified/, "outcome evidence self-check"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(
        "[e2e] android: witness ceremony markers all present (session → challenge → VP → VWC → evidence self-check)"
      );
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `android: witness ceremony markers missing after ${timeout}ms: ${missing.map(([, n]) => n).join(", ")}`
  );
}

/**
 * The witness-share markers (step 7), from Android's run-scoped logcat.
 * Android's log covers all four directions: its own share sent, the peer's
 * share verified AND stored, our receipt sent, and the peer's receipt
 * matched back to our share. No-op on iOS drivers.
 */
export async function assertWitnessShareMarkers(driver, timeout = 120000) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  const { execSync } = await import("node:child_process");
  const required = [
    [/\[TrustTasks:Ceremony\] witness-share sent/, "witness-share sent"],
    [/\[TrustTasks:Ceremony\] witness-share verified and stored/, "witness-share verified and stored"],
    [/\[TrustTasks:Ceremony\] witness-share receipt sent/, "witness-share receipt sent"],
    [/\[TrustTasks:Ceremony\] witness-share receipt matched/, "witness-share receipt matched"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log("[e2e] android: witness-share markers all present (shared → verified → stored → receipted)");
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `android: witness-share markers missing after ${timeout}ms: ${missing.map(([, n]) => n).join(", ")}`
  );
}

/**
 * v4 pairs: consent is the RELATIONSHIP PROPOSAL, not per-credential offers.
 * One side (whichever wallet did not deterministically propose) gets the
 * "wants to form a relationship" bottom-sheet — find and accept it. Returns
 * true if this driver was the one prompted. The un-prompted side returns
 * false after the wait, which is expected.
 */
export async function acceptRelationshipProposalIfPrompted(driver, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await existsTestId(driver, "ProposalAccept", 3000)) {
      await tapTestId(driver, "ProposalAccept");
      console.log(`[e2e] ${driver.e2ePlatform}: relationship proposal accepted`);
      return true;
    }
    // Real devices only: signing may request biometric confirmation while
    // we're still waiting for the proposal prompt (e.g. the peer proposed
    // and is already issuing). No-op on emulators/simulators.
    await handleBiometricConfirmIfPresent(driver);
    await unlockIfLocked(driver);
    await sleep(2000);
  }
  console.log(`[e2e] ${driver.e2ePlatform}: no proposal prompt (peer side proposed)`);
  return false;
}

/**
 * Run acceptRelationshipProposalIfPrompted on both sides of an exchange and
 * assert that at least one of them actually saw the proposal. If discovery
 * failed and neither side was ever prompted, both calls return false and the
 * run would otherwise fall through into assertVrcReceived's generic
 * "contact never appeared" timeout — fail loudly here instead, with the
 * specific cause.
 */
export async function acceptRelationshipProposalOnEitherSide(driverA, driverB, timeout = 90000) {
  const [acceptedA, acceptedB] = await Promise.all([
    acceptRelationshipProposalIfPrompted(driverA, timeout),
    acceptRelationshipProposalIfPrompted(driverB, timeout),
  ]);
  if (!acceptedA && !acceptedB) {
    throw new Error(
      `${driverA.e2ePlatform}/${driverB.e2ePlatform}: neither side saw a relationship proposal prompt within ${timeout}ms — discovery likely failed`
    );
  }
}

/**
 * Assert the peer's R-Card photo made it through the exchange: opens the
 * contact's detail screen and checks for the ContactAvatarImage element
 * (rendered only when resolveContactDisplayInfo found a photo attribute on
 * the received RCard — see rcardDisplayUtils.ts). This checks the data
 * arrived, not what it looks like — no pixel/visual assertion is made.
 */
export async function assertContactPhotoReceived(driver, peerName, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await openContactDetail(driver, peerName);
    if (await existsTestId(driver, "ContactAvatarImage", 4000)) {
      console.log(`[e2e] ${driver.e2ePlatform}: photo present for "${peerName}"`);
      return;
    }
    if (await existsTestId(driver, "BackButton", 2000)) {
      await tapTestId(driver, "BackButton");
    }
    await sleep(3000);
  }
  await screenshot(driver, "photo-missing");
  throw new Error(
    `${driver.e2ePlatform}: no photo (ContactAvatarImage) shown for "${peerName}" within ${timeout}ms`
  );
}
