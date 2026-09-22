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
  tapText,
  tapTestId,
  tapTestIdByCoordinates,
  tapTestIdReliable,
  waitForTestId,
  screenshot,
} from "./driver.js";
export { sleep };
import { PIN, APP_ID, TEST_ID_PREFIX } from "./config.js";
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
      const { width, height } = await driver.getWindowRect();
      if (Math.min(width, height) >= 700) {
        await hideTabletKeyboard(driver, width, height);
        return;
      }
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

/**
 * iPad (iPadOS 26, 2026-09-15). The iPhone recipe misfires twice here: return
 * moves focus to the NEXT field (the R-Card's email) instead of closing the
 * keyboard, and a fixed tap point lands on the keyboard — the full keyboard
 * covers the bottom ~40% in landscape and the PIN pad floats over the form —
 * typing a character instead of dismissing. So: the system hide action first
 * (the iPad keyboard has a dismiss key), and only if a keyboard is still up,
 * one tap on the right margin ABOVE the keyboard's own frame.
 */
async function hideTabletKeyboard(driver, width, height) {
  const shown = async () => {
    try {
      return await driver.isKeyboardShown();
    } catch {
      return false;
    }
  };
  if (!(await shown())) return;
  await driver.execute("mobile: hideKeyboard", {}).catch(() => {});
  await sleep(700);
  if (!(await shown())) return;
  let keyboardTop = Math.round(height * 0.5);
  try {
    const keyboard = await driver.$("-ios class chain:**/XCUIElementTypeKeyboard");
    if (await keyboard.isExisting()) {
      const rect = await driver.getElementRect(keyboard.elementId);
      // A full-width keyboard: tap just above it. A floating pad (narrow):
      // its top says nothing about free space, so keep the mid-height default.
      if (rect.width >= width * 0.8) keyboardTop = Math.round(rect.y);
    }
  } catch {
    /* keep the default */
  }
  await driver.execute("mobile: tap", { x: width - 24, y: Math.max(Math.round(height * 0.2), keyboardTop - 40) });
  await sleep(700);
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
    // Android ships two different system photo pickers and their view trees
    // are INVERTED with respect to each other, so do not constrain on
    // clickable() here:
    //
    //   com.google.android.providers.media.module (seen 2026-09-04) wraps each
    //     grid thumbnail in a CLICKABLE FrameLayout that carries the
    //     "Photo taken on ..." content-desc.
    //   com.google.android.photopicker (seen 2026-09-11, API 36) puts the
    //     content-desc on a NON-clickable View, whose clickable parent carries
    //     no description at all.
    //
    // Matching on the description alone works for both: the described node and
    // its clickable ancestor share identical bounds, so a tap on either lands
    // on the same pixel and the picker receives it. Both confirmed via live
    // uiautomator dumps.
    const photoCell =
      driver.e2ePlatform === "android"
        ? driver.$(
            'android=new UiSelector().descriptionContains("Photo taken on")'
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
  // 45 s, not 15: a real iPhone/iPad relaunching a baked JS bundle while
  // another device runs beside it took longer than 15 s to mount the PIN
  // screen, so the unlock below was skipped and the wallet sat locked
  // (2026-09-15). 120 s, not 45: a debug build loads its JS from metro, and a
  // cold metro bundle took 54 s to reach both devices later that day (the
  // runners now warm it first; this is the backstop). existsTestId returns as
  // soon as the screen appears.
  await existsTestId(driver, "EnterPIN", 120000);
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
  // The preference persists across app restarts, so once per session is
  // enough — and a second visit to Settings (developer toggles one after the
  // other) starts from a list this helper already scrolled, where "Lockout"
  // can be off-screen (iOS, 2026-09-14).
  if (driver.e2eAutoLockNeverSet) return;
  // Each dropdown option (Settings.tsx) has its own stable testID
  // (AutoLockTime<Id>) rather than relying on matching its visible label
  // text — added after a blind swipe-and-check search for the "Never" text
  // proved unreliable on a real device (see below).
  const neverKey = "AutoLockTimeNever";
  let neverEl;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Always bring the row into view first: on a real iPhone Settings can open
    // with "Auto lock time" under the tab bar — present but not displayed, so
    // the tap times out (2026-09-15).
    await findRowEitherDirection(driver, "Lockout");
    // The row's onPress TOGGLES its dropdown open/closed (Settings.tsx). If
    // attempt 1's tap actually opened it but the lookup below was too slow
    // to catch it in time, blindly re-tapping "Lockout" on retry closes the
    // dropdown instead of helping. Only tap it if it looks collapsed.
    if (!(await byTestId(driver, neverKey).isExisting())) {
      if (driver.e2ePlatform === "android") {
        // This row renders as a native android.widget.Button. On at least
        // one real device, uiautomator2's plain .click() on it never
        // reached React Native's gesture responder at all — onPress simply
        // never fired, confirmed via a temporary debug log in the handler
        // itself, no matter how many times it was retried. A raw coordinate
        // touch gesture (a real synthetic finger tap, not an accessibility
        // click action) worked immediately.
        await tapTestIdByCoordinates(driver, "Lockout", 15000);
      } else {
        await tapTestId(driver, "Lockout", 15000);
      }
      // Let the dropdown's expand animation settle before searching for its
      // options — on a slower real device the row's re-render can lag well
      // behind the tap, and querying immediately can miss it even though
      // it's about to render (seen on an older Android phone specifically;
      // a newer phone with identical code needed no such wait).
      await sleep(500);
    }
    for (let i = 0; i < 3; i++) {
      if (driver.e2ePlatform === "android") {
        // A blind swipe-and-check loop here could overshoot straight past a
        // just-collapsed/re-rendering Lockout row to the bottom of the whole
        // Settings list (seen on a real device: 6 scrolls landed on "About
        // this App"/"Export Wallet", nowhere near Lockout). UiAutomator's own
        // UiScrollable knows how to scroll a SectionList to a specific
        // resource-id directly — far more reliable than guessing gesture
        // distances against an unknown current scroll position.
        neverEl = driver.$(
          `android=new UiScrollable(new UiSelector().scrollable(true).instance(0))` +
            `.scrollIntoView(new UiSelector().resourceId("${TEST_ID_PREFIX}${neverKey}"))`
        );
      } else {
        // XCUITest scrolls an off-screen-but-existing element into view on
        // interaction on its own — no manual scroll needed here.
        neverEl = byTestId(driver, neverKey);
      }
      if (await neverEl.isExisting()) break;
      // UiScrollable's scrollIntoView runs against the NATIVE view hierarchy
      // and can outrun React Native's JS thread mounting newly-scrolled-into-
      // view rows of a virtualized SectionList — on a slower real device the
      // native scroll can finish and report "not found" before the JS side
      // has actually rendered the row that would have appeared a moment
      // later. 2s (not 500ms) gives that cross-thread render room to
      // land before the next scrollIntoView attempt.
      await sleep(2000);
    }
    if (await neverEl.isExisting()) break;
    console.log(`[e2e] ${deviceTag(driver)}: "${neverKey}" not found after Lockout tap, retrying once`);
  }
  if (!(await neverEl.isExisting())) {
    throw new Error(`${deviceTag(driver)}: "${neverKey}" option never appeared after opening the Lockout dropdown`);
  }
  if (!(await neverEl.isExisting())) {
    // On a reused install the preference is already "Never", and the expanded
    // row can render without a tappable option. Not worth failing a run over:
    // the wallet either locks (and unlockIfLocked recovers it) or it doesn't.
    console.log(`[e2e] ${deviceTag(driver)}: leaving auto-lock as it is — "Never" never appeared`);
    driver.e2eAutoLockNeverSet = true;
    return;
  }
  await neverEl.click();
  driver.e2eAutoLockNeverSet = true;
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
  await openDeveloperScreen(driver);

  // Near the bottom of the Developer screen's long ScrollView — same
  // scroll-into-view need as the Version footer above.
  const tspToggle = await scrollToTestId(driver, "ToggleEnableTspCarriage");
  await tspToggle.click();
  console.log(`[e2e] ${driver.e2ePlatform}: TSP envelope carriage enabled (developer setting)`);
  // The toggle's dispatch updates React state immediately, but persisting it
  // to disk is a separate async side effect — restartApp's terminateApp()
  // below is a hard force-kill, and on a slow real device (or a fast
  // returnToContacts that leaves little natural buffer) it can race ahead of
  // that write, silently losing the toggle (confirmed via device logcat
  // reading the flag back as still "off" post-restart).
  await sleep(1000);

  await returnToContacts(driver);
  await restartApp(driver);
}

/**
 * Enable the "DIDComm v2" developer setting (didcomm_v2_subtask.md C12/C14):
 * the agent restarts with didcommVersions ['v1','v2'], provisions Coordinate
 * Mediation 2.0 with MEDIATOR_V2_URL when the build has one, and new
 * relationship invitations become out-of-band/2.0 on did:peer:2. Restarts the
 * app: the agent's DIDComm versions are fixed at construction.
 */
export async function enableDidCommV2(driver) {
  await openDeveloperScreen(driver);

  const toggle = await scrollToTestId(driver, "ToggleEnableDidCommV2");
  await toggle.click();
  console.log(`[e2e] ${driver.e2ePlatform}: DIDComm v2 enabled (developer setting)`);
  // See the same wait in enableTspCarriage above: the toggle's persistence
  // write is async and can race restartApp's hard force-kill, silently
  // losing the flag on a slow device (confirmed via device logcat reading
  // the flag back as still "off" post-restart, on a real witnessed run).
  await sleep(1000);

  await returnToContacts(driver);
  await restartApp(driver);
}

/**
 * Is Settings' "Developer" row present? Settings is a virtualized SectionList,
 * and setAutoLockNever leaves it scrolled to the bottom, so on a second visit
 * (developer mode already on) the row can be unmounted above the viewport —
 * and tapping Version then does nothing, because developer mode is already
 * on. Search upward first, then downward, before concluding it is absent.
 */
async function findDeveloperOptionsRow(driver) {
  return findRowEitherDirection(driver, "DeveloperOptions");
}

/** Bring a Settings row into view, searching upward then downward. */
async function findRowEitherDirection(driver, testId) {
  // DISPLAYED, not merely present: XCUITest reports rows scrolled off-screen
  // as existing (Android's virtualized list unmounts them instead), and a tap
  // on an off-screen row times out (iOS, 2026-09-14).
  const displayed = async () => {
    const el = byTestId(driver, testId);
    return (await el.isExisting()) && (await el.isDisplayed());
  };
  await existsTestId(driver, testId, 2000);
  if (await displayed()) return true;
  const { width, height } = await driver.getWindowRect();
  const swipe = async (fromY, toY) =>
    driver
      .action("pointer")
      .move({ x: Math.floor(width / 2), y: Math.floor(height * fromY) })
      .down()
      .pause(100)
      .move({ x: Math.floor(width / 2), y: Math.floor(height * toY), duration: 400 })
      .up()
      .perform();
  for (const [fromY, toY] of [[0.3, 0.75], [0.7, 0.25]]) {
    for (let i = 0; i < 5; i++) {
      await swipe(fromY, toY);
      await sleep(400);
      if (await displayed()) return true;
    }
  }
  return false;
}

/**
 * Settings → Developer screen (Auto-lock off on the way), whether developer
 * mode is already on or has to be tripped by tapping the Version footer.
 */
export async function openDeveloperScreen(driver) {
  await dismissTourIfPresent(driver);
  await tapTestId(driver, "Settings", 15000);
  await setAutoLockNever(driver);

  if (await findDeveloperOptionsRow(driver)) {
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
    // for a Developer-screen-only element, not a Settings row. The VTA probe
    // (VTI_PROBE_ON_START) fires as the screen mounts and reports with an
    // alert, which hides the toggle from a lookup until it is dismissed.
    if (!reachedDeveloperScreen) {
      for (let i = 0; i < 3; i++) if (!(await driver.acceptAlert().then(() => true, () => false))) break;
      await waitForTestId(driver, "ToggleDeveloper", 5000);
    }
  }
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
  // fallback: accessibility label from TabStack.QRCode translation. All
  // four call sites wrap this function in their own retry loop that checks
  // for the sheet's actual content afterward and restarts on a miss — none
  // of them catch an exception from here, so throwing on a plain "nothing
  // rendered in time yet" miss (seen on a real device under heavier
  // combined load: attestation + DIDComm v2 + locality) killed the whole
  // attempt outright instead of letting that retry loop do its job. No-op
  // here instead; the caller's own follow-up check surfaces the miss.
  const qrCodeText = byText(driver, "QR Code");
  if (await qrCodeText.isExisting()) {
    await qrCodeText.click();
  }
}

/** Open the QR bottom sheet from the center tab and show "my QR" for a relationship exchange. */
export async function showRelationshipInvitation(driver) {
  // The app can be watchdog-restarted between onboarding and this step under
  // CPU contention, landing on the unlock screen — recover before tapping.
  await ensureAppForeground(driver);
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
/**
 * Bring Keyring back to the foreground if something else took the screen —
 * on an attended real-device run a tapped notification opened Mail mid-paste
 * and cost the run (iPhone, 2026-09-15). XCUITest app state 4 = foreground.
 * Returns whether it had to.
 */
export async function ensureAppForeground(driver) {
  const { APP_ID } = await import("./config.js");
  try {
    const state = await driver.queryAppState(APP_ID);
    if (state === 4) return false;
    console.log(`[e2e] ${driver.e2ePlatform}: Keyring was not in the foreground (state ${state}) — reactivating`);
    await driver.activateApp(APP_ID);
    await sleep(3000);
    await unlockIfLocked(driver);
    return true;
  } catch {
    return false;
  }
}

export async function acceptInvitationViaPaste(driver, invitationUrl) {
  await ensureAppForeground(driver);
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
  // Simulated typing corrupts long strings on both platforms, differently:
  // XCUITest occasionally drops characters mid-string; Android's single
  // `setText` of a ~700-char URL into RN's controlled TextInput lost the
  // FIRST 159 characters outright on a slow phone (Galaxy A03s, 2026-09-12 —
  // scheme, host and `?oob=` all gone, so the app's "URL not recognized" was
  // correct). Android therefore types in chunks, giving RN's state a moment
  // to settle between them. Either way the field is READ BACK and compared
  // to the URL before submitting: the earlier version inferred success from
  // the ErrorModal not appearing within 5s, and on that same phone the modal
  // simply appeared later — the harness walked off with it still up and the
  // run died 10 steps downstream as "could not land on Contacts".
  for (let attempt = 0; attempt < 4; attempt++) {
    await ensureAppForeground(driver);
    const input = await waitForTestId(driver, "PastedUrl", 15000);
    if (attempt > 0) await input.clearValue();
    if (driver.e2ePlatform === "android") {
      // A real paste, not simulated typing. Chunked typing was tried first
      // (2026-09-12, same phone): the native field then read back the full
      // URL while the app still rejected it — React Native's controlled
      // TextInput had lost part of the string in JS state even though the
      // native view showed all of it, and no read-back can see that split.
      // A clipboard paste lands as ONE change event with the whole string,
      // which is what a person does on this screen anyway.
      await driver.setClipboard(Buffer.from(invitationUrl, "utf8").toString("base64"), "plaintext");
      await input.click();
      await driver.pressKeyCode(279); // KEYCODE_PASTE
      await sleep(800);
    } else {
      await input.setValue(invitationUrl);
    }
    // multiline input: don't send \n — tap a neutral spot to dismiss the keyboard
    await hideKeyboard(driver);
    let typed = "";
    try {
      typed = (await input.getText()) ?? "";
    } catch {
      /* fall through to the modal check below */
    }
    if (typed && typed !== invitationUrl) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: field holds ${typed.length}/${invitationUrl.length} chars of the URL — retyping (attempt ${attempt + 1}/4)`
      );
      if (attempt === 3) {
        await screenshot(driver, "paste-url-mangled");
        throw new Error(`invitation URL could not be entered intact after 4 attempts (last: ${typed.length}/${invitationUrl.length} chars)`);
      }
      continue;
    }
    // the long URL grows the input; the button may be below the fold
    const submit = await scrollToTestId(driver, "ScanPastedUrl");
    await submit.click();
    // detect the rejection via the modal's CTA button — RN Modal testIDs
    // (ErrorModal) don't reliably surface on iOS, but children do. 20s, not
    // 5: the modal appears when credo's mediator wait times out (~14s on a
    // slow phone, 2026-09-13), and mistaking "not yet" for "never" is the
    // failure this whole block exists to prevent.
    if (!(await existsTestId(driver, "Try Again", 20000))) break;
    if (attempt === 3) {
      await screenshot(driver, "paste-url-rejected");
      throw new Error("invitation URL rejected 4 times (ErrorModal persisted)");
    }
    // "URL not recognized" is the app's label for ANY failure inside
    // connectFromScanOrDeepLink — PasteUrl.tsx catches everything and shows
    // this one message. On 2026-09-12 it was a mediator round trip timing
    // out (credo TimeoutError), and three attempts went into the URL and the
    // paste before anyone read the app's own log. Read it here, once, so the
    // real reason is in the run output next to the retry.
    await dumpConnectStrategyError(driver);
    console.log(`[e2e] ${driver.e2ePlatform}: URL not recognized — retrying`);
    await tapTestId(driver, "Try Again", 5000);
  }
  console.log(`[e2e] ${driver.e2ePlatform}: invitation pasted & submitted`);
}

/**
 * Android only (iOS syslog is captured elsewhere): the app logs the actual
 * exception behind "URL not recognized" as `Problem during connect strategy`.
 * Print the most recent one — name, message, first stack frame — and never
 * throw: this is diagnostics for a failure already in progress.
 */
async function dumpConnectStrategyError(driver) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  try {
    const { execSync } = await import("node:child_process");
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const idx = log.lastIndexOf("Problem during connect strategy");
    if (idx < 0) {
      console.log(`[e2e] android: no "Problem during connect strategy" in logcat — the rejection was not from connectFromScanOrDeepLink`);
      return;
    }
    const block = log.slice(idx, idx + 1200).split("\n").slice(0, 8)
      .map((l) => l.replace(/^.*ReactNativeJS:\s*/, ""))
      .filter((l) => /Problem during|"name"|"message"|"at /.test(l))
      .slice(0, 4);
    console.log(`[e2e] android: app-side reason →\n      ${block.join("\n      ")}`);
  } catch (e) {
    console.log(`[e2e] android: could not read logcat for the reason (${e.message})`);
  }
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
    // Same overlay race as assertVrcReceived/openContactDetail: a peer's VRC
    // landing right around a witness message can leave the "Relationship
    // confirmed" overlay up, and its pointerEvents="auto" swallows a
    // Contacts-tab/BackButton tap underneath — dismiss it before anything
    // else so this loop doesn't spin for the full MAX_ATTEMPTS.
    if (await byTextContains(driver, "Relationship confirmed").isExisting()) {
      await dismissVrcConfirmationOverlayIfPresent(driver);
      if (await existsTestId(driver, "Contacts", 2000)) return;
      continue;
    }
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
    // The witness-connect Bluetooth pre-flight sheet (Android) can be up by
    // the time we get here — on a phone that keeps up with the mediator it
    // appears the moment the witness connection completes, i.e. mid-landing,
    // and it blocks everything under it (attempt 13, 2026-09-13).
    if (await acceptLocalityPreflightIfPresent(driver, 1500)) continue;
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
      // Same overlay race as assertVrcReceived: a "Relationship confirmed"
      // overlay's pointerEvents="auto" swallows a Contacts-tab/BackButton
      // tap underneath, spinning this loop until it gives up and the row
      // lookup below times out — even though the peer is already there.
      if (await byTextContains(driver, "Relationship confirmed").isExisting()) {
        await dismissVrcConfirmationOverlayIfPresent(driver);
        onTab = true;
        break;
      }
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
  // The contact screen's three badges (ContactDetails.tsx): "Secure Exchange"
  // (SecureExchangeBadge — the peer's hardware attestation verified here),
  // "Verified" (WitnessedBadge — a witness credential exists for the contact)
  // and "In-Person" (LocalityConfirmedBadge — the witness confirmed Bluetooth
  // co-presence). Each is required by its own option; the badges themselves
  // are checked, not the witness section below them.
  const requireSecureExchange = options.requireSecureExchange ?? true;
  const requireLocality = options.requireLocality ?? false;
  const deadline = Date.now() + timeout;
  let sawAttestation = false;
  let sawWitness = false;
  let sawLocality = false;
  // ContactDetails declares these testIDs BARE (no com.ariesbifold:id/ prefix),
  // so the raw accessibility id is checked as well as the prefixed one.
  const badge = async (id) => (await existsTestId(driver, id, 2000)) || (await existsRawId(driver, id, 2000));
  while (Date.now() < deadline) {
    await openContactDetail(driver, peerName);
    sawAttestation = await badge("SecureExchangeBadge");
    sawWitness = await badge("WitnessedBadge");
    sawLocality = await badge("LocalityConfirmedBadge");
    if ((sawAttestation || !requireSecureExchange) && sawWitness && (sawLocality || !requireLocality)) {
      const shown = [sawAttestation && "Secure Exchange", "Verified (Witnessed)", sawLocality && "In-Person"].filter(Boolean);
      console.log(
        `[e2e] ${driver.e2ePlatform}: "${peerName}" badges: ${shown.join(" + ")}` +
          (sawAttestation || !requireSecureExchange ? "" : "") +
          (!sawAttestation && !requireSecureExchange ? " (Secure Exchange not required)" : "") +
          (!sawLocality && !requireLocality ? " (In-Person not required: no locality check on this run)" : "")
      );
      return;
    }
    // Any badge may lag (VWC is issued after the VRC; hw verify is async) —
    // pop back to the list and re-open the contact to re-render.
    if (await existsTestId(driver, "BackButton", 2000)) {
      await tapTestId(driver, "BackButton");
    }
    await sleep(3000);
  }
  await screenshot(driver, "badges-missing");
  throw new Error(
    `${driver.e2ePlatform}: "${peerName}" missing a badge — Secure Exchange=${sawAttestation}, Verified=${sawWitness}, In-Person=${sawLocality}`
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
    // The "Relationship confirmed" overlay (Chat.tsx) sits on top of the tab
    // bar with no way past it except its own "View contacts" button — a
    // stray "Contacts"/"BackButton" tap underneath is swallowed by the
    // overlay's pointerEvents="auto" and leaves this loop spinning until
    // timeout even though the VRC already landed (seen on real devices).
    if (await byTextContains(driver, "Relationship confirmed").isExisting()) {
      await dismissVrcConfirmationOverlayIfPresent(driver);
      onTab = true;
      break;
    }
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
    // Same overlay race as above: it can still appear here if the peer's
    // delivery lands mid-loop, after the initial nav attempts above gave up.
    await dismissVrcConfirmationOverlayIfPresent(driver);
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
 * `assertVrcReceived`'s text match isn't scoped to the Contacts list — the
 * moment the VRC lands, Chat.tsx auto-pushes the peer's chat screen (header
 * text: the peer's own name) on top of the Contacts tab with a "Relationship
 * confirmed" overlay, and `byTextContains(driver, peerName)` matches that
 * header just as well as the contacts-list row. So the assertion can return
 * successfully while the device is actually sitting on this overlay, not the
 * Contacts tab — invisible to callers who only need "the VRC arrived" (every
 * existing flow), but a real problem for one that needs to drive the UI
 * further afterward. Dismiss it (its "View contacts" button has no testID,
 * only an accessibilityLabel — byText/tapText is the only way to reach it)
 * before any such follow-on navigation. A no-op if the overlay isn't showing.
 */
export async function dismissVrcConfirmationOverlayIfPresent(driver, timeout = 5000) {
  if (await byTextContains(driver, "Relationship confirmed").isExisting()) {
    await tapText(driver, "View contacts", timeout);
    console.log(`[e2e] ${driver.e2ePlatform}: dismissed the VRC confirmation overlay`);
  }
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
    const log = await readAppJsLog(driver);
    if (log === null) return;
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: trust-task exchange markers all present (propose + issue legs)`
      );
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `${driver.e2ePlatform}: trust-task markers missing after ${timeout}ms: ${missing
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
  const required = [
    [/\[TrustTasks:TspCarriage\] envelope sent/, "envelope sent"],
    [/\[TrustTasks:TspCarriage\] envelope received/, "envelope received"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = await readAppJsLog(driver);
    if (log === null) return;
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: TSP envelope carriage markers present (sent + received)`
      );
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `${driver.e2ePlatform}: TSP carriage markers missing after ${timeout}ms: ${missing
      .map(([, name]) => name)
      .join(", ")}`
  );
}

/**
 * The app's JS log for marker assertions: Android's run-scoped logcat, or —
 * for the iOS SIMULATOR — the unified log, where the app's logger lines land
 * as `[com.facebook.react.log:javascript]` entries (verified 2026-09-14).
 * Physical iPhones have neither from the host; returns null there, and the
 * v2 marker assertions below skip on null (same as they do for logcat-less
 * drivers elsewhere in this file).
 */
export async function readAppJsLog(driver) {
  const { execSync } = await import("node:child_process");
  if (driver.e2ePlatform === "android" && driver.e2eUdid) {
    return execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  if (driver.e2ePlatform === "ios" && driver.e2eIosLogFile) {
    const { readFileSync } = await import("node:fs");
    try {
      return readFileSync(driver.e2eIosLogFile, "utf8");
    } catch {
      return "";
    }
  }
  return null;
}

/**
 * Start capturing the iOS SIMULATOR app's JS log with `log stream` into a
 * file the marker assertions read. Needed because the unified log does not
 * persist the app's info-level lines: `log show` minutes later returns only
 * the last few seconds (observed 2026-09-14), so a post-hoc read misses the
 * markers. Call right after createSession("ios"); stopIosLogCapture in the
 * runner's finally. No-op for physical iPhones (no simctl).
 */
export async function startIosLogCapture(driver, deviceUdid) {
  if (driver.e2ePlatform !== "ios") return;
  if (deviceUdid) return startIosDeviceLogCapture(driver, deviceUdid);
  const { spawn } = await import("node:child_process");
  const { openSync, mkdirSync } = await import("node:fs");
  mkdirSync("artifacts", { recursive: true });
  const file = `artifacts/ios-js-${Date.now()}.log`;
  const fd = openSync(file, "a");
  const sim = process.env.IOS_UDID || "booted";
  const proc = spawn(
    "xcrun",
    [
      "simctl", "spawn", sim, "log", "stream", "--level", "info", "--style", "compact",
      "--predicate", 'process == "KeyRing" AND subsystem == "com.facebook.react.log"',
    ],
    { stdio: ["ignore", fd, fd] }
  );
  driver.e2eIosLogFile = file;
  driver.e2eIosLogProc = proc;
  console.log(`[e2e] ios: JS log capture started (${file})`);
}

/**
 * Real iPhone/iPad: `idevicesyslog -u <udid>` (libimobiledevice) into a file
 * the marker assertions read. Appium's own `syslog` log type evicts the app's
 * lines on a real device (device-run notes, 2026-09-13), and os_log's
 * info-level JS lines do reach the syslog relay for this app. Only the app's
 * own process lines are kept.
 */
async function startIosDeviceLogCapture(driver, udid) {
  const { spawn, execSync } = await import("node:child_process");
  const { createWriteStream, mkdirSync } = await import("node:fs");
  try {
    execSync("which idevicesyslog", { stdio: "ignore" });
  } catch {
    throw new Error("idevicesyslog is required for iOS device marker assertions: brew install libimobiledevice");
  }
  mkdirSync("artifacts", { recursive: true });
  const file = `artifacts/ios-device-${udid.slice(-8)}-${Date.now()}.log`;
  const out = createWriteStream(file, { flags: "a" });
  const proc = spawn("idevicesyslog", ["-u", udid], { stdio: ["ignore", "pipe", "ignore"] });
  // A syslog entry starts with its timestamp ("Sep 15 13:35:44.396093 …");
  // a logger that pretty-prints JSON continues on unprefixed lines, which
  // belong to the entry above them — keep them when that entry was ours.
  let partial = "";
  let keeping = false;
  proc.stdout.on("data", (chunk) => {
    const parts = (partial + chunk.toString()).split("\n");
    partial = parts.pop();
    for (const line of parts) {
      if (/^[A-Z][a-z]{2} +\d+ \d\d:\d\d:\d\d/.test(line)) keeping = /\bKeyRing\(KeyRing/.test(line);
      if (keeping) out.write(line + "\n");
    }
  });
  proc.on("error", () => {});
  driver.e2eIosLogFile = file;
  driver.e2eIosLogProc = proc;
  console.log(`[e2e] ios (${udid.slice(-8)}): device log capture started (${file})`);
}

export function stopIosLogCapture(driver) {
  try {
    driver?.e2eIosLogProc?.kill();
  } catch {
    /* already gone */
  }
}

/**
 * The DIDComm v2 carriage's own markers (binding/didcomm 0.2 envelope over a
 * v2 connection): [TrustTasks:DidCommV2Carriage] envelope sent + received,
 * from the device's JS log. Requires enableDidCommV2() on the device(s)
 * under test. No-op where no log is reachable (physical iPhones).
 */
export async function assertDidCommV2CarriageMarkers(driver, timeout = 60000) {
  const required = [
    [/\[TrustTasks:DidCommV2Carriage\] envelope sent/, "envelope sent"],
    [/\[TrustTasks:DidCommV2Carriage\] envelope received/, "envelope received"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = await readAppJsLog(driver);
    if (log === null) return;
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(`[e2e] ${driver.e2ePlatform}: DIDComm v2 carriage markers present (sent + received)`);
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `${driver.e2ePlatform}: DIDComm v2 carriage markers missing after ${timeout}ms: ${missing
      .map(([, name]) => name)
      .join(", ")}`
  );
}

/**
 * The TSP envelope rode a DIDComm v2 connection (didcomm_v2_subtask.md T5/T6):
 * `[TrustTasks:TspCarriage] envelope sent/received on v2 connection`, and no
 * `[TrustTasks:DidCommV2Carriage]` envelope lines — with the TSP flag on, no
 * Trust Task document may have taken the plain v2 binding. No-op where no
 * log is reachable (physical iPhones).
 */
export async function assertTspOverDidCommV2Markers(driver, timeout = 90000) {
  const required = [
    [/\[TrustTasks:TspCarriage\] envelope sent on v2 connection/, "TSP envelope sent on v2"],
    [/\[TrustTasks:TspCarriage\] envelope received on v2 connection/, "TSP envelope received on v2"],
  ];
  const forbidden = /\[TrustTasks:DidCommV2Carriage\] envelope (sent|received)/;
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = await readAppJsLog(driver);
    if (log === null) return;
    if (forbidden.test(log)) {
      throw new Error(`${driver.e2ePlatform}: a Trust Task document took the plain DIDComm v2 binding with TSP carriage on`);
    }
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(`[e2e] ${driver.e2ePlatform}: TSP envelope over DIDComm v2 markers present (sent + received, no plain v2 binding)`);
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `${driver.e2ePlatform}: TSP-over-v2 markers missing after ${timeout}ms: ${missing.map(([, n]) => n).join(", ")}`
  );
}

/**
 * The v2 mediation marker: the wallet provisioned Coordinate Mediation 2.0
 * with MEDIATOR_V2_URL ([TrustTasks:V2Mediation] ... granted). Proves the
 * exchange went through the v2 mediator rather than unmediated routing.
 * No-op where no log is reachable (physical iPhones).
 */
export async function assertV2MediationMarker(driver, timeout = 60000) {
  const re = /\[TrustTasks:V2Mediation\] Coordinate Mediation 2\.0 granted/;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // Provisioning runs at agent start, which only happens after unlock: a
    // wallet left on its PIN screen would make this wait pointless.
    await unlockIfLocked(driver).catch(() => false);
    const log = await readAppJsLog(driver);
    if (log === null) return;
    if (re.test(log)) {
      console.log(`[e2e] ${driver.e2ePlatform}: Coordinate Mediation 2.0 provisioned`);
      return;
    }
    await sleep(3000);
  }
  throw new Error(`${driver.e2ePlatform}: no Coordinate Mediation 2.0 grant marker after ${timeout}ms`);
}

/**
 * The witness-session markers of a witnessed exchange (§9 step 5), from
 * Android's run-scoped logcat: session → challenge → VP → VWC, plus the
 * outcome-evidence self-check (presentation assembled from the retained pair
 * and verified). No-op on iOS drivers.
 */
export async function assertWitnessCeremonyMarkers(driver, timeout = 90000) {
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
    const log = await readAppJsLog(driver);
    if (log === null) return;
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: witness ceremony markers all present (session → challenge → VP → VWC → evidence self-check)`
      );
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `${driver.e2ePlatform}: witness ceremony markers missing after ${timeout}ms: ${missing.map(([, n]) => n).join(", ")}`
  );
}

/**
 * The witness-share markers (step 7), from Android's run-scoped logcat.
 * Android's log covers all four directions: its own share sent, the peer's
 * share verified AND stored, our receipt sent, and the peer's receipt
 * matched back to our share. No-op on iOS drivers.
 */
export async function assertWitnessShareMarkers(driver, timeout = 120000) {
  const required = [
    [/\[TrustTasks:Ceremony\] witness-share sent/, "witness-share sent"],
    [/\[TrustTasks:Ceremony\] witness-share verified and stored/, "witness-share verified and stored"],
    [/\[TrustTasks:Ceremony\] witness-share receipt sent/, "witness-share receipt sent"],
    [/\[TrustTasks:Ceremony\] witness-share receipt matched/, "witness-share receipt matched"],
  ];
  const deadline = Date.now() + timeout;
  let missing = required;
  while (Date.now() < deadline) {
    const log = await readAppJsLog(driver);
    if (log === null) return;
    missing = required.filter(([re]) => !re.test(log));
    if (missing.length === 0) {
      console.log(`[e2e] ${driver.e2ePlatform}: witness-share markers all present (shared → verified → stored → receipted)`);
      return;
    }
    await sleep(3000);
  }
  throw new Error(
    `${driver.e2ePlatform}: witness-share markers missing after ${timeout}ms: ${missing.map(([, n]) => n).join(", ")}`
  );
}

/**
 * The locality co-presence marker (locality-plan.md §10.3 item 12), from
 * Android's run-scoped logcat: `witnessCeremony.ts` logs a dedicated
 * "locality confirmed"/"locality not confirmed" line once it has processed
 * the witness's `#response` — distinct from the earlier "radio phase
 * produced a transcript" line, which only reports what the DEVICE itself
 * produced, not what the witness ultimately confirmed. No-op on iOS drivers
 * (no native peripheral exists there; see locality-plan.md §10.3 item 9).
 *
 * Fails loudly on a "not confirmed" line rather than merely on a missing
 * one — a silent fallback to unconfirmed is exactly the failure mode this
 * assertion exists to catch, not something to wait out.
 */
/**
 * The witness-connect Bluetooth pre-flight sheet (locality-plan.md §8.4,
 * `LocalityPreflightModal`) appears on each phone right after its own
 * connectToWitness resolves against a witness whose policy is `offered` or
 * `required`, and blocks the UI until answered. It was left to the operator
 * on purpose (the flow's own banner) — and on 2026-09-13 the first run that
 * got both phones connected died at the very next tap because the sheet was
 * still up on one of them. The OS-level prompts that follow are already
 * automatic (`autoGrantPermissions` on Android, `autoAcceptAlerts` on iOS),
 * so this is the one remaining manual step, and it has a testID. Tap Allow
 * if the sheet is showing; do nothing if it is not (a witness with locality
 * `off` never shows it).
 */
export async function acceptLocalityPreflightIfPresent(driver, timeout = 20000) {
  if (!(await existsTestId(driver, "LocalityPreflightAllow", timeout))) return false;
  await tapTestId(driver, "LocalityPreflightAllow", 5000);
  console.log(`[e2e] ${driver.e2ePlatform}: Bluetooth pre-flight sheet — tapped Allow`);
  await sleep(1500); // let the sheet dismiss and any OS prompt auto-resolve
  return true;
}

export async function assertLocalityConfirmedMarker(driver, timeout = 60000) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  const { execSync } = await import("node:child_process");
  const confirmed = /\[TrustTasks:Witness\] locality confirmed for session/;
  const notConfirmed = /\[TrustTasks:Witness\] locality not confirmed for session[^\n]*/;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const log = execSync(`adb -s ${driver.e2eUdid} logcat -d -s ReactNativeJS:*`, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (confirmed.test(log)) {
      console.log(`[e2e] android: locality confirmed`);
      return;
    }
    const failure = log.match(notConfirmed);
    if (failure) {
      throw new Error(`android: locality was NOT confirmed — "${failure[0]}"`);
    }
    await sleep(3000);
  }
  throw new Error(`android: no locality marker (confirmed or not) appeared within ${timeout}ms`);
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
    // The whole ceremony (propose → accept → sign → confirm) can complete
    // before this loop's first ProposalAccept check ever catches the bottom
    // sheet — seen on a real device with attestation on, where the extra
    // biometric round trip changes the timing enough that BOTH sides can
    // race straight to "Relationship confirmed" and neither ever reports
    // true, which the caller (acceptRelationshipProposalOnEitherSide) reads
    // as "discovery failed" despite the exchange having genuinely succeeded.
    if (await byTextContains(driver, "Relationship confirmed").isExisting()) {
      console.log(
        `[e2e] ${driver.e2ePlatform}: relationship already confirmed (proposal was accepted before this loop caught it)`
      );
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

/**
 * With the Scan screen already open (e.g. from My Agent's "Link your agent"),
 * hand it a link through its paste-URL button — the same path a person with
 * no working camera takes, and how a simulator "scans" (plan UT). Accepts the
 * camera disclosure on a first visit. Returns once the link was submitted and
 * not refused; the caller waits for wherever the link leads.
 */
export async function pasteLinkOnScanScreen(driver, url) {
  let pasteReady = false;
  for (let attempt = 0; attempt < 4 && !pasteReady; attempt++) {
    await acceptSystemAlertIfPresent(driver);
    if (await existsTestId(driver, "PasteUrlButton", 8000)) {
      pasteReady = true;
      break;
    }
    if (await existsTestId(driver, "Continue", 5000)) {
      await tapTestId(driver, "Continue");
      pasteReady = await existsTestId(driver, "PasteUrlButton", 10000);
    }
  }
  if (!pasteReady) {
    await screenshot(driver, "scan-no-paste-button");
    throw new Error(`${driver.e2ePlatform}: the Scan screen never showed its paste-URL button`);
  }
  await tapTestId(driver, "PasteUrlButton", 15000);
  const input = await waitForTestId(driver, "PastedUrl", 15000);
  if (driver.e2ePlatform === "android") {
    await driver.setClipboard(Buffer.from(url, "utf8").toString("base64"), "plaintext");
    await input.click();
    await driver.pressKeyCode(279); // KEYCODE_PASTE
    await sleep(800);
  } else {
    await input.setValue(url);
  }
  let typed = (await input.getText().catch(() => "")) ?? "";
  // A slow phone now and then drops or reorders a key in a long link typed in
  // one go (a ~6 KB invitation on the iPhone 11): clear the field and type it
  // again.
  for (let attempt = 1; driver.e2ePlatform === "ios" && typed && typed !== url && attempt <= 4; attempt++) {
    console.log(`[e2e] ios: the link went in wrong (${typed.length}/${url.length}) — typing it again (${attempt}/4)`);
    await input.clearValue().catch(() => undefined);
    await sleep(500);
    await input.setValue(url);
    typed = (await input.getText().catch(() => "")) ?? "";
  }
  await hideKeyboard(driver);
  if (driver.e2ePlatform === "ios" && (await driver.isKeyboardShown().catch(() => false))) {
    // The helper's fixed tap point can land inside this screen's tall paste
    // field; tap the instruction text above it, which blurs the field.
    const hint = driver.$('-ios predicate string:type == "XCUIElementTypeStaticText" AND label BEGINSWITH "Paste a URL below"');
    if (await hint.isExisting().catch(() => false)) await hint.click().catch(() => undefined);
    await sleep(800);
  }
  if (typed && typed !== url) {
    await screenshot(driver, "paste-link-mangled");
    throw new Error(`${driver.e2ePlatform}: the link was not entered intact (${typed.length}/${url.length} chars)`);
  }
  // On a slow phone the first tap can land before React has the pasted text,
  // while Continue is still disabled — it is ignored without a word. Tap
  // until the paste screen is gone (or the app says why it refused).
  for (let attempt = 1; attempt <= 3; attempt++) {
    const submit = await scrollToTestId(driver, "ScanPastedUrl");
    await submit.click();
    if (await existsTestId(driver, "Try Again", 8000)) {
      await screenshot(driver, "paste-link-refused");
      throw new Error(`${driver.e2ePlatform}: the app refused the pasted link`);
    }
    if (!(await existsTestId(driver, "PastedUrl", 2000))) break;
    if (attempt === 3) {
      await screenshot(driver, "paste-link-stuck");
      throw new Error(`${driver.e2ePlatform}: Continue on the paste screen did nothing, three times`);
    }
    console.log(`[e2e] ${driver.e2ePlatform}: still on the paste screen — tapping Continue again`);
  }
  console.log(`[e2e] ${driver.e2ePlatform}: link pasted & submitted`);
}

/**
 * A person leaving a community, in the app (UI/UX plan U1): My Agent → the
 * community → Leave community → confirm. Replaces the Developer screen's
 * "forget this community" as the harness's reset. Returns false when this
 * phone has no community row to leave (nothing to reset).
 */
export async function leaveCommunityInApp(driver) {
  await dismissTourIfPresent(driver);
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await sleep(1500);
  // My Agent lists its communities once the agent session is up; a cold
  // start offers "Connect my agent" first (as openVetting in the runner does).
  const connect = byTestId(driver, "ConnectMyAgentButton");
  if (await connect.isExisting().catch(() => false)) await connect.click();
  // Tell "nothing to leave" (connected, no community row) apart from "could
  // not look" (never connected, or the row never rendered). The second must
  // fail loudly: an applicant silently NOT reset carries "meets the published
  // requirements" into the next run, which then fails much later as "the
  // vetter never accepted" (three runs lost on 2026-09-20).
  const until = Date.now() + 180000;
  let connectedSince;
  let row;
  // Android's UiAutomator does not report off-screen children, and scrollToTestId
  // looks down N swipes then back up N — so each look covers the WHOLE screen
  // (8 each way), never a couple of swipes that return to where they began.
  const seen = async (key, swipes = 8) => {
    const el = await scrollToTestId(driver, key, swipes).catch(() => undefined);
    return el && (await el.isExisting().catch(() => false)) ? el : undefined;
  };
  while (Date.now() < until) {
    // Any way into the community screen, where Leave lives: the non-member
    // row, the membership card, or the identity card's "Open this community".
    row =
      (await seen("MyAgentCommunityRow")) ||
      (await seen("MyAgentMembershipCard", 4)) ||
      (await seen("MyAgentOpenCommunity", 4));
    if (row) break;
    const connected = await seen("MyAgentCard", 3);
    if (connected) {
      connectedSince ??= Date.now();
      // Whether the phone HOLDS a community is read from what it shows, not
      // from the row: the row appears only once the community session is up.
      // An identity, a vetting entry or "Reach the community" means there is
      // one — bring its session up so the row renders, then leave it.
      const reach = await seen("ConnectCommunityButton", 3);
      const holdsOne =
        Boolean(reach) ||
        Boolean(await seen("MyAgentVettingRow", 4)) ||
        Boolean(await seen("MyAgentIdentityCard", 4)) ||
        Boolean(await seen("MyAgentPersonaDid", 4));
      if (holdsOne) {
        if (reach) {
          await reach.click().catch(() => undefined);
          console.log(`[e2e] ${driver.e2ePlatform}: reaching the community before leaving it`);
        }
      } else if (Date.now() - connectedSince > 20000) {
        console.log(`[e2e] ${driver.e2ePlatform}: agent connected and holds no community — nothing to leave`);
        return false;
      }
    }
    await sleep(2000);
  }
  if (!row) {
    await screenshot(driver, "leave-community-no-row");
    throw new Error(
      `${driver.e2ePlatform}: could not reach the community to leave it — ` +
        (connectedSince ? "the community row never rendered" : "the agent never connected") +
        " within 180s; refusing to skip the reset"
    );
  }
  await row.click();
  const leave = await scrollToTestId(driver, "LeaveCommunityButton", 8);
  await leave.click();
  const confirm = await scrollToTestId(driver, "LeaveCommunityConfirm", 4);
  await confirm.click();
  // Leaving returns to My Agent.
  await waitForTestId(driver, "MyAgent", 30000);
  await sleep(1500);
  console.log(`[e2e] ${driver.e2ePlatform}: left the community (persona, membership, invitations, vetting)`);
  return true;
}

/**
 * From anywhere in the app: open the scanner from the QR tab and hand it a
 * link through its paste-URL button — how a real device receives a link the
 * runner cannot deep-link into (there is no `simctl openurl` for a phone),
 * and how a long invitation gets past iOS truncating it as a deep link
 * (VTI-32): the paste carries the whole text.
 */
export async function pasteLinkFromHome(driver, link) {
  await ensureAppForeground(driver);
  await dismissTourIfPresent(driver);
  await openQrSheet(driver);
  await tapTestId(driver, "ScanQRCode", 15000);
  await pasteLinkOnScanScreen(driver, link);
}
