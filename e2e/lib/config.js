import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

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

export const ANDROID_AVD = process.env.ANDROID_AVD || "Pixel_6_API_33";
export const IOS_DEVICE_NAME = process.env.IOS_DEVICE_NAME || "iPhone 17";
export const IOS_PLATFORM_VERSION = process.env.IOS_PLATFORM_VERSION || "26.3";

export function androidCaps() {
  return {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:avd": ANDROID_AVD,
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
    "appium:wdaLaunchTimeout": 180000,
    "appium:simulatorStartupTimeout": 300000,
  };
}
