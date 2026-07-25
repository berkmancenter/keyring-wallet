// Shared Askar 0.2→0.6 store-migration flow (Phase 3 gate):
//
//   1. Install the BASELINE apk (credo 0.5.17 / aries-askar 0.2.3, JS bundled
//      into the apk) on the android emulator. Onboard it and run a VRC exchange
//      against a peer wallet so the old-format store holds a real credential.
//   2. `adb install -r` the NEW apk (credo 0.6.3 / askar 0.6.0, same debug
//      keystore) over it — wallet data is preserved across the upgrade.
//   3. Relaunch, unlock with the same PIN, and verify the agent opens the old
//      store and the VRC contact + credential survived.
//
// The peer wallet's platform is injected by the caller (iOS simulator or a
// second Android emulator) — nothing here depends on which.
import { execSync } from "node:child_process";
import { remote } from "webdriverio";

import {
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
  sleep,
  byTestId,
  existsTestId,
  waitForTestId,
  tapTestId,
} from "./driver.js";
import { APP_ID, APPIUM_PORT, ANDROID_APK, ANDROID_AVD, PIN } from "./config.js";
import {
  acceptCredentialOfferFromChat,
  assertVrcReceived,
  completeOnboarding,
  dismissTourIfPresent,
  showRelationshipInvitation,
} from "./flows.js";

const PEER = { firstName: "Alice", lastName: "Anderson" }; // peer wallet (new build)
const HOLDER = { firstName: "Bob", lastName: "Baker" }; // android (old → new build)

function adb(cmd, udid) {
  return execSync(`adb ${udid ? `-s ${udid}` : ""} ${cmd}`, {
    encoding: "utf8",
  });
}

/**
 * Android session that does NOT manage the app install: noReset keeps wallet
 * data across sessions, and install/uninstall is done manually with adb so the
 * upgrade (install -r) path is exactly what a real device update does.
 */
async function createAndroidSession() {
  const driver = await remote({
    hostname: "127.0.0.1",
    port: APPIUM_PORT,
    connectionRetryTimeout: 600000,
    connectionRetryCount: 1,
    capabilities: {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:avd": ANDROID_AVD,
      "appium:appPackage": APP_ID,
      "appium:appWaitActivity": "*",
      "appium:noReset": true,
      "appium:autoLaunch": false,
      "appium:newCommandTimeout": 300,
      "appium:autoGrantPermissions": true,
      "appium:adbExecTimeout": 120000,
      "appium:uiautomator2ServerLaunchTimeout": 120000,
    },
  });
  driver.e2ePlatform = "android";
  const udid =
    driver.capabilities.deviceUDID ||
    driver.capabilities["appium:udid"] ||
    driver.capabilities.udid;
  driver.e2eUdid = udid;
  // new build is a dev build that loads JS from metro on the host
  adb("reverse tcp:8081 tcp:8081", udid);
  return driver;
}

async function launchApp(driver) {
  await driver.activateApp(APP_ID);
}

/** Unlock the PIN screen shown when an existing wallet (re)opens. */
async function unlockWallet(driver, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await existsTestId(driver, "EnterPIN", 5000)) {
      const pinInput = byTestId(driver, "EnterPIN");
      await pinInput.click();
      await pinInput.setValue(PIN);
      try {
        await driver.hideKeyboard();
      } catch {
        /* keyboard may not be shown */
      }
      try {
        await tapTestId(driver, "Enter", 15000);
      } catch {
        /* PIN may auto-submit once all digits are entered */
      }
      console.log(`[e2e] android: PIN entered`);
      return;
    }
    // already unlocked?
    if (await existsTestId(driver, "Contacts", 3000)) return;
    await sleep(2000);
  }
  throw new Error(`PIN unlock screen not seen within ${timeout}ms`);
}

/**
 * Run the full store-migration flow.
 *
 * @param {object} opts
 * @param {string} opts.baselineApk - path to the baseline (old) release apk
 * @param {() => Promise<import('webdriverio').Browser>} opts.createPeerSession -
 *   builds and returns a ready session for the peer wallet; must set
 *   `driver.e2ePlatform` itself.
 * @param {(peerDriver: import('webdriverio').Browser) => Promise<void>} opts.primePeer -
 *   called once right after the peer session is created (e.g. to pre-grant a
 *   camera permission the peer platform needs); pass an async no-op if
 *   nothing is needed.
 */
export async function runStoreMigration({ baselineApk, createPeerSession, primePeer }) {
  let android, peer;
  try {
    await ensureAppium();

    // ---------- Phase 1: populate the old-format store ----------
    console.log(`[e2e] installing BASELINE apk: ${baselineApk}`);
    try {
      adb(`uninstall ${APP_ID}`);
    } catch {
      /* not installed */
    }
    adb(`install -t "${baselineApk}"`);
    // appium's autoGrantPermissions only applies when appium does the install —
    // grant runtime permissions manually or the OS camera dialog blocks the flow
    for (const perm of ["CAMERA", "POST_NOTIFICATIONS", "RECORD_AUDIO"]) {
      try {
        adb(`shell pm grant ${APP_ID} android.permission.${perm}`);
      } catch {
        /* permission may not be declared/grantable on this API level */
      }
    }

    android = await createAndroidSession();
    await launchApp(android);
    console.log("[e2e] baseline app launched");

    peer = await createPeerSession();
    await primePeer(peer);

    await Promise.all([
      completeOnboarding(android, HOLDER),
      completeOnboarding(peer, PEER),
    ]);

    // New peer wallet shows the invitation (the baseline build lacks the
    // __DEV__ InvitationUrl hidden text). Deliver it to the old android build
    // via deep link (the manifest registers the https://…/invite host) — the
    // old release build's QR bottom-sheet doesn't respond to appium's synthetic
    // taps, and the deep-link path is what real users hit anyway.
    const invitationUrl = await showRelationshipInvitation(peer);
    await dismissTourIfPresent(android);
    // inner single quotes survive the local shell and keep the URL's &/? intact
    // in the device-side shell
    adb(
      `shell am start -a android.intent.action.VIEW -d "'${invitationUrl}'" ${APP_ID}`,
      android.e2eUdid
    );
    console.log("[e2e] android: invitation delivered via deep link");

    await Promise.all([
      acceptCredentialOfferFromChat(android),
      acceptCredentialOfferFromChat(peer),
    ]);
    await assertVrcReceived(android, `${PEER.firstName} ${PEER.lastName}`);
    console.log("[e2e] ✅ old-format store populated with a real VRC");

    // ---------- Phase 2: upgrade in place ----------
    const udid = android.e2eUdid;
    await android.terminateApp(APP_ID);
    await android.deleteSession(); // noReset: data stays
    android = null;

    console.log(`[e2e] upgrading in place: adb install -r ${ANDROID_APK}`);
    adb(`install -r -t "${ANDROID_APK}"`, udid);

    android = await createAndroidSession();
    await launchApp(android);
    console.log("[e2e] NEW app launched over old data — waiting for PIN screen");

    // ---------- Phase 3: verify the store opened and data survived ----------
    await unlockWallet(android);

    // agent init + (potential) store migration happens behind the splash;
    // main tabs appearing means the askar store opened with the same key
    await waitForTestId(android, "Contacts", 300000);
    console.log("[e2e] ✅ store opened after upgrade (agent initialized)");

    await assertVrcReceived(
      android,
      `${PEER.firstName} ${PEER.lastName}`,
      120000
    );
    console.log(
      "\n[e2e] ✅ askar 0.2→0.6 migration: wallet, contact and VRC survived the upgrade"
    );
    process.exitCode = 0;
  } catch (err) {
    console.error("\n[e2e] ❌ FAILED:", err.message);
    for (const d of [android, peer].filter(Boolean)) {
      try {
        await screenshot(d, "migration-failure");
        await dumpSource(d, "migration-failure");
      } catch {
        /* session may be dead */
      }
    }
    process.exitCode = 1;
  } finally {
    for (const d of [android, peer].filter(Boolean)) {
      try {
        await d.deleteSession();
      } catch {
        /* ignore */
      }
    }
    stopAppium();
  }
}
