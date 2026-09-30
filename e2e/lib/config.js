import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Imported for its side effect: it tees stdout and stderr into
// artifacts/<runner>-<timestamp>.log. Every runner imports this module for its
// capabilities, which makes it the one place that reaches all of them.
import "./transcript.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * app/.env is read by react-native-config, which accepts quoted values and
 * trailing `#` comments; a naive `.trim()` would carry both into the
 * invitation URL and produce a malformed one. Strips a matched pair of
 * surrounding quotes, and an unquoted trailing comment.
 */
function unquoteEnvValue(raw) {
  const value = raw.trim();
  const quoted = value.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];
  return value.split(/\s+#/)[0].trim();
}

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
    const match = readFileSync(appEnvPath, "utf-8").match(/^MEDIATOR_URL=(.*)$/m);
    const value = match && unquoteEnvValue(match[1]);
    if (value) return value;
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
// Second physical iOS device (iPad + iPhone runs).
export const IOS_UDID2 = process.env.IOS_UDID2 || "";
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

/**
 * `fullReset` uninstalls the app at the END of a session as well as the start,
 * so a rung that uses it deletes its own result on the way out and the next
 * rung opens a freshly installed app at the Welcome screen. That is right for
 * a rung run on its own — the suite's standing requirement is that every run
 * starts from an uninstall — and wrong for a chain, where a later rung needs
 * the state an earlier one left.
 *
 * `E2E_KEEP_APP=1` is the opt-out, for the FIRST rung of a chain: it still
 * installs and still onboards, it just does not take the app away afterwards.
 * Later rungs then run with `E2E_KEEP_STATE=1`, which already asks for
 * `noReset`. Clear the app yourself before the chain if you want it clean.
 */
const keepApp = () => process.env.E2E_KEEP_APP === '1'
// E2E_KEEP_STATE=1 means "this session must not touch the installed app".
// The comment above promised it; the capabilities did not honour it, so a
// session opened from a helper script without the runners' own keep() wrapper
// reinstalled the app and wiped its state (2026-09-21: the iPhone applicant).
const keepState = () => process.env.E2E_KEEP_STATE === '1'
const keepStateCaps = () =>
  keepState() ? { "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false } : {}

export function androidCaps(avd = ANDROID_AVD) {
  return {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:avd": avd,
    "appium:app": ANDROID_APK,
    "appium:appPackage": APP_ID,
    "appium:appWaitActivity": "*",
    // fullReset = uninstall before install → satisfies the "uninstall every run" requirement
    "appium:fullReset": !keepApp(),
    // don't auto-launch: we need `adb reverse tcp:8081` in place first so the
    // debug build can reach metro on the host
    "appium:autoLaunch": false,
    "appium:newCommandTimeout": 300,
    "appium:autoGrantPermissions": true,
    "appium:adbExecTimeout": 120000,
    "appium:uiautomator2ServerLaunchTimeout": 120000,
    ...ANDROID_SETTINGS,
    ...keepStateCaps(),
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
/**
 * Real iPhone/iPad. `ports` lets TWO iOS devices share one Appium server:
 * each needs its own WDA port, MJPEG port and WDA derived-data folder
 * (concurrent WDA builds into one folder collide).
 */
/**
 * Where WebDriverAgent is built, and whether it is rebuilt.
 *
 * Appium's XCUITest driver compiles WDA when a session starts, so every device
 * or simulator session adds an Xcode build to the machine that nobody chose —
 * three sessions, three builds. One night this Mac carried four `xcodebuild`
 * processes at once and a twenty-minute estimate became forty-five.
 *
 * Pinning the derived-data folder makes that build reusable. `usePrebuiltWDA`
 * then reuses it — but it is not a hint: with it set, the driver runs
 * `test-without-building` and does NOT build (appium-webdriveragent's
 * `xcodebuild.ts`: `usePrebuiltWDA || useXctestrunFile` pushes the test command
 * alone). Nothing checks that a product exists first, so setting it against an
 * empty folder does not "build once and reuse" — it fails inside WDA, before
 * any test runs.
 *
 * So this asks the filesystem rather than assuming: reuse only when this
 * platform's `WebDriverAgentRunner-Runner.app` is actually there. A cold
 * machine builds once, every run after that starts in seconds, and a folder
 * someone deleted heals itself.
 *
 * Device and simulator products are different builds (`Debug-iphoneos` versus
 * `Debug-iphonesimulator`) and they get separate folders, so one platform's
 * first run can never be handed the other's build.
 *
 * `E2E_REBUILD_WDA=1` forces a build even when a product exists: a stale
 * prebuilt WDA after an Appium or Xcode upgrade shows up as a session dying
 * inside WDA rather than in a test, and that is the first thing to try.
 * Concurrent sessions still cannot share one folder — simultaneous builds into
 * the same derived data collide — so a caller running devices in parallel
 * passes its own path, as the two-device runners do.
 */
const WDA_DERIVED_DATA_BASE =
  process.env.WDA_DERIVED_DATA || path.join(os.homedir(), "Library/Developer/Xcode/DerivedData/keyring-wda");
const REBUILD_WDA = process.env.E2E_REBUILD_WDA === "1";

/** Is this platform's WDA already built in `derivedDataPath`? */
function wdaProductExists(derivedDataPath, platform) {
  const built = platform === "device" ? "Debug-iphoneos" : "Debug-iphonesimulator";
  return existsSync(path.join(derivedDataPath, "Build", "Products", built, "WebDriverAgentRunner-Runner.app"));
}

/**
 * @param platform "device" | "sim"
 * @param ownPath a caller's own folder, for runs that drive two devices at once
 */
function prebuiltWdaCaps(platform, ownPath) {
  const derivedDataPath = ownPath ?? `${WDA_DERIVED_DATA_BASE}-${platform}`;
  const prebuilt = !REBUILD_WDA && wdaProductExists(derivedDataPath, platform);
  return { "appium:derivedDataPath": derivedDataPath, "appium:usePrebuiltWDA": prebuilt };
}

export function iosDeviceCaps(udid, ports = {}) {
  return {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": udid,
    "appium:app": IOS_DEVICE_APP,
    "appium:bundleId": APP_ID,
    // A chain of real-device rungs keeps the app between them, as simulator
    // rungs do: E2E_KEEP_APP on the first, E2E_KEEP_STATE on the rest.
    "appium:fullReset": !keepApp(),
    "appium:enforceAppInstall": !keepApp(),
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
    "appium:wdaLocalPort": ports.wdaLocalPort ?? 8123,
    ...(ports.mjpegServerPort ? { "appium:mjpegServerPort": ports.mjpegServerPort } : {}),
    ...prebuiltWdaCaps("device", ports.derivedDataPath),
    "appium:newCommandTimeout": 600,
    "appium:autoAcceptAlerts": true,
    "appium:wdaLaunchTimeout": 300000,
    ...keepStateCaps(),
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
    "appium:fullReset": !keepApp(),
    // bundle version rarely changes between local builds; force reinstall so a
    // freshly built .app always replaces whatever is on the simulator
    "appium:enforceAppInstall": !keepApp(),
    "appium:newCommandTimeout": 300,
    "appium:autoAcceptAlerts": true,
    // WDA defaults to :8100, which collides with anything else on that port
    // (e.g. a local VTA); override with WDA_LOCAL_PORT
    "appium:wdaLocalPort": Number(process.env.WDA_LOCAL_PORT || 8100),
    "appium:wdaLaunchTimeout": 180000,
    ...prebuiltWdaCaps("sim"),
    "appium:simulatorStartupTimeout": 300000,
    // A second worktree's Metro on another host port: a simulator shares the
    // host's localhost, so point the app at it with the NSUserDefaults key
    // React Native's bundle URL provider reads (RCT_jsLocation), passed as a
    // launch argument — no rebuild, and nothing left behind on the simulator.
    ...(process.env.METRO_PORT && process.env.METRO_PORT !== "8081"
      ? { "appium:processArguments": { args: ["-RCT_jsLocation", `localhost:${process.env.METRO_PORT}`] } }
      : {}),
    ...keepStateCaps(),
  };
}
