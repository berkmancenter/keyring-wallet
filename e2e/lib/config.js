import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * The witness's mediator invitation for the ":mediator" e2e variant (see
 * run-vrc-exchange-witnessed-android-only-devices-mediator.js). Reuses
 * app/.env's own MEDIATOR_URL rather than requiring a second, separately
 * maintained value: it's the same production mediator the wallets already
 * connect to, so this is what makes the variant a real test of "does
 * mediator-mode witnessing work against our actual infrastructure" rather
 * than a stand-in. Set WITNESS_MEDIATOR_INVITATION_URL to override.
 */
export function resolveWitnessMediatorInvitationUrl() {
  if (process.env.WITNESS_MEDIATOR_INVITATION_URL) {
    return process.env.WITNESS_MEDIATOR_INVITATION_URL;
  }
  const appEnvPath = path.join(repoRoot, "app", ".env");
  if (existsSync(appEnvPath)) {
    const match = readFileSync(appEnvPath, "utf-8").match(/^MEDIATOR_URL=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error(
    "no mediator invitation URL to run the witness against — set WITNESS_MEDIATOR_INVITATION_URL, " +
      "or set MEDIATOR_URL in app/.env (reused as-is: same production mediator the wallets already use)."
  );
}

export const APP_ID = "asml.bkc.harvard.wallet";
export const TEST_ID_PREFIX = "com.ariesbifold:id/";
export const APPIUM_PORT = Number(process.env.APPIUM_PORT || 4723);
export const PIN = process.env.E2E_PIN || "123456";

export const ANDROID_APK =
  process.env.ANDROID_APK ||
  path.join(repoRoot, "app/android/app/build/outputs/apk/debug/app-debug.apk");

// Built by: xcodebuild -workspace AriesBifold.xcworkspace -scheme AriesBifold -configuration Debug
//   -sdk iphonesimulator -derivedDataPath build/e2e-dd CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES build
// Ad-hoc signing is REQUIRED: CODE_SIGNING_ALLOWED=NO strips the keychain entitlements
// and react-native-keychain fails with "required entitlement isn't present" (error 1001).
export const IOS_APP =
  process.env.IOS_APP ||
  path.join(
    repoRoot,
    "app/ios/build/e2e-dd/Build/Products/Debug-iphonesimulator/KeyRing.app"
  );

export const ANDROID_AVD = process.env.ANDROID_AVD || "Pixel_8_API_33";
// Second AVD for PLATFORMS=android,android (two emulators can't share one AVD).
export const ANDROID_AVD2 = process.env.ANDROID_AVD2 || "";
export const IOS_DEVICE_NAME = process.env.IOS_DEVICE_NAME || "iPhone 17";
export const IOS_PLATFORM_VERSION = process.env.IOS_PLATFORM_VERSION || "26.3";

// --- Real-device runs (run-vrc-exchange-devices.js) ---
// UDIDs are auto-detected by the runner when unset (adb devices / devicectl).
export const ANDROID_UDID = process.env.ANDROID_UDID || "";
export const IOS_UDID = process.env.IOS_UDID || "";
// Second physical android device for the witnessed android-only devices run
// (two phones can't share one udid).
export const ANDROID_UDID2 = process.env.ANDROID_UDID2 || "";
// Apple team used to sign WebDriverAgent onto the physical iPhone.
export const IOS_TEAM_ID = process.env.IOS_TEAM_ID || "947XHQ9DVC";
// Device build (Debug-iphoneos, FORCE_BUNDLING=1 so it doesn't need metro) — see e2e/README.md
export const IOS_DEVICE_APP =
  process.env.IOS_DEVICE_APP ||
  path.join(
    repoRoot,
    "app/ios/build/device-dd/Build/Products/Debug-iphoneos/KeyRing.app"
  );

// UiAutomator2 waits for the UI thread to go "idle" before every action; RN
// screens with running animations never report idle, so each tap/setValue
// silently burns the full default 10s timeout (this was the "stuck on the
// second PIN input" symptom). 100ms keeps a tiny settle without the stall.
const ANDROID_SETTINGS = { "appium:settings[waitForIdleTimeout]": 100 };

export function androidCaps(avd = ANDROID_AVD) {
  return {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:avd": avd,
    "appium:app": ANDROID_APK,
    "appium:appPackage": APP_ID,
    "appium:appWaitActivity": "*",
    // fullReset = uninstall before install → satisfies the "uninstall every run" requirement
    "appium:fullReset": true,
    // don't auto-launch: we need `adb reverse tcp:8081` in place first so the
    // debug build can reach metro on the host
    "appium:autoLaunch": false,
    "appium:newCommandTimeout": 300,
    "appium:autoGrantPermissions": true,
    "appium:adbExecTimeout": 120000,
    "appium:uiautomator2ServerLaunchTimeout": 120000,
    ...ANDROID_SETTINGS,
  };
}

/** Physical Android phone over USB. Same debug APK; metro reached via `adb reverse`. */
export function androidDeviceCaps(udid) {
  return {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:udid": udid,
    "appium:app": ANDROID_APK,
    "appium:appPackage": APP_ID,
    "appium:appWaitActivity": "*",
    "appium:fullReset": true,
    "appium:autoLaunch": false,
    "appium:newCommandTimeout": 600,
    "appium:autoGrantPermissions": true,
    "appium:adbExecTimeout": 120000,
    "appium:uiautomator2ServerLaunchTimeout": 120000,
    ...ANDROID_SETTINGS,
  };
}

/**
 * Physical iPhone. Requires a Debug-iphoneos build signed with IOS_TEAM_ID and
 * Developer Mode enabled on the phone. Appium builds + signs WebDriverAgent
 * with the same team on first run (can take a few minutes).
 */
export function iosDeviceCaps(udid) {
  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": udid,
    "appium:app": IOS_DEVICE_APP,
    "appium:bundleId": APP_ID,
    "appium:fullReset": true,
    "appium:enforceAppInstall": true,
    "appium:xcodeOrgId": IOS_TEAM_ID,
    "appium:xcodeSigningId": "Apple Development",
    // unique WDA bundle id so provisioning under the team doesn't collide
    "appium:updatedWDABundleId": "asml.bkc.harvard.WebDriverAgentRunner",
    // appium doesn't pass -allowProvisioningUpdates to xcodebuild; if WDA has
    // never been provisioned for this team on this machine, prime it once:
    //   cd ~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent
    //   xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
    //     -destination "id=<IOS_UDID>" DEVELOPMENT_TEAM=<team> \
    //     PRODUCT_BUNDLE_IDENTIFIER=asml.bkc.harvard.WebDriverAgentRunner \
    //     -allowProvisioningUpdates build-for-testing
    "appium:allowProvisioningDeviceRegistration": true,
    // default 8100 can be taken by other tooling on the host
    "appium:wdaLocalPort": 8123,
    "appium:newCommandTimeout": 600,
    "appium:autoAcceptAlerts": true,
    "appium:wdaLaunchTimeout": 300000,
  };
}

export function iosCaps() {
  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:deviceName": IOS_DEVICE_NAME,
    "appium:platformVersion": IOS_PLATFORM_VERSION,
    "appium:app": IOS_APP,
    "appium:bundleId": APP_ID,
    "appium:fullReset": true,
    // bundle version rarely changes between local builds; force reinstall so a
    // freshly built .app always replaces whatever is on the simulator
    "appium:enforceAppInstall": true,
    "appium:newCommandTimeout": 300,
    "appium:autoAcceptAlerts": true,
    // WDA defaults to :8100, which collides with anything else on that port
    // (e.g. a local VTA); override with WDA_LOCAL_PORT
    "appium:wdaLocalPort": Number(process.env.WDA_LOCAL_PORT || 8100),
    "appium:wdaLaunchTimeout": 180000,
    "appium:simulatorStartupTimeout": 300000,
  };
}
