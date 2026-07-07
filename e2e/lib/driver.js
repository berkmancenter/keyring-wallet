import { remote } from "webdriverio";
import { spawn } from "node:child_process";
import net from "node:net";

import { APPIUM_PORT, TEST_ID_PREFIX, androidCaps, iosCaps } from "./config.js";

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
}

let appiumProc;

export async function ensureAppium() {
  if (await portInUse(APPIUM_PORT)) return;
  console.log(`[e2e] starting appium on :${APPIUM_PORT}`);
  appiumProc = spawn(
    "appium",
    ["--port", String(APPIUM_PORT), "--relaxed-security"],
    {
      stdio: ["ignore", "ignore", "inherit"],
      detached: false,
    }
  );
  for (let i = 0; i < 60; i++) {
    if (await portInUse(APPIUM_PORT)) return;
    await sleep(1000);
  }
  throw new Error("appium did not start within 60s");
}

export function stopAppium() {
  if (appiumProc) appiumProc.kill("SIGTERM");
}

export async function createSession(platform) {
  const capabilities = platform === "android" ? androidCaps() : iosCaps();
  console.log(`[e2e] creating ${platform} session…`);
  const driver = await remote({
    hostname: "127.0.0.1",
    port: APPIUM_PORT,
    connectionRetryTimeout: 600000,
    connectionRetryCount: 1,
    capabilities,
  });
  driver.e2ePlatform = platform;
  if (platform === "android") {
    // Debug builds load the JS bundle from metro on the host; map emulator port 8081 back
    // BEFORE the first app launch (autoLaunch is disabled in the caps).
    const udid =
      driver.capabilities.deviceUDID ||
      driver.capabilities["appium:udid"] ||
      driver.capabilities.udid;
    if (!udid)
      throw new Error(
        "could not determine android device udid for adb reverse"
      );
    const { execSync } = await import("node:child_process");
    execSync(`adb -s ${udid} reverse tcp:8081 tcp:8081`);
    console.log(`[e2e] adb reverse tcp:8081 set up on ${udid}`);
    const { APP_ID } = await import("./config.js");
    await driver.activateApp(APP_ID);
    console.log("[e2e] app launched");
  }
  if (platform === "ios") {
    // Pre-grant camera so the Scan screen skips the camera-disclosure Modal:
    // presenting that Modal right as the QR bottom-sheet dismisses intermittently
    // fails on the iOS simulator, leaving a blank Scan screen.
    try {
      const { execSync } = await import("node:child_process");
      const { APP_ID } = await import("./config.js");
      execSync(`xcrun simctl privacy booted grant camera ${APP_ID}`);
      // granting TCC permission kills the app; relaunch it cleanly (immediate
      // activate can race the teardown and leave a black screen)
      await driver.terminateApp(APP_ID).catch(() => {});
      await sleep(3000);
      await driver.activateApp(APP_ID);
      await sleep(3000);
    } catch {
      /* non-fatal — flow falls back to the disclosure modal */
    }
  }
  return driver;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Find an element by bifold testID (testIdWithKey key).
 * RN maps testID → resource-id on Android and → accessibility identifier on iOS.
 */
export function byTestId(driver, key) {
  const full = `${TEST_ID_PREFIX}${key}`;
  if (driver.e2ePlatform === "android") {
    return driver.$(`android=new UiSelector().resourceId("${full}")`);
  }
  return driver.$(`~${full}`);
}

export async function waitForTestId(driver, key, timeout = 30000) {
  const el = byTestId(driver, key);
  await el.waitForExist({
    timeout,
    timeoutMsg: `element testID=${key} not found in ${timeout}ms`,
  });
  return el;
}

export async function tapTestId(driver, key, timeout = 30000) {
  const el = await waitForTestId(driver, key, timeout);
  await el.waitForDisplayed({ timeout });
  await el.click();
  return el;
}

/** Swipe up until the element with the given testID is displayed (max 6 swipes). */
export async function scrollToTestId(driver, key, maxSwipes = 6) {
  for (let i = 0; i < maxSwipes; i++) {
    const el = byTestId(driver, key);
    if ((await el.isExisting()) && (await el.isDisplayed())) return el;
    const { width, height } = await driver.getWindowRect();
    await driver
      .action("pointer")
      .move({ x: Math.floor(width / 2), y: Math.floor(height * 0.7) })
      .down()
      .pause(100)
      .move({
        x: Math.floor(width / 2),
        y: Math.floor(height * 0.25),
        duration: 400,
      })
      .up()
      .perform();
    await sleep(500);
  }
  throw new Error(
    `element testID=${key} not displayed after ${maxSwipes} swipes`
  );
}

export async function existsTestId(driver, key, timeout = 4000) {
  try {
    await waitForTestId(driver, key, timeout);
    return true;
  } catch {
    return false;
  }
}

/** Find by visible text (fallback when a control has no testID). */
export function byText(driver, text) {
  if (driver.e2ePlatform === "android") {
    return driver.$(`android=new UiSelector().text("${text}")`);
  }
  return driver.$(
    `-ios predicate string:label == "${text}" OR name == "${text}"`
  );
}

/** Find by partial visible text (labels may have prefixes, e.g. "Contact: Alice"). */
export function byTextContains(driver, text) {
  if (driver.e2ePlatform === "android") {
    return driver.$(`android=new UiSelector().textContains("${text}")`);
  }
  return driver.$(
    `-ios predicate string:label CONTAINS "${text}" OR name CONTAINS "${text}"`
  );
}

export async function tapText(driver, text, timeout = 30000) {
  const el = byText(driver, text);
  await el.waitForExist({
    timeout,
    timeoutMsg: `element text="${text}" not found in ${timeout}ms`,
  });
  await el.click();
  return el;
}

export async function dumpSource(driver, label) {
  const src = await driver.getPageSource();
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("artifacts", { recursive: true });
  const file = `artifacts/${label}-${driver.e2ePlatform}-${Date.now()}.xml`;
  writeFileSync(file, src);
  console.log(`[e2e] page source dumped: ${file}`);
  return file;
}

export async function screenshot(driver, label) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync("artifacts", { recursive: true });
  const file = `artifacts/${label}-${driver.e2ePlatform}-${Date.now()}.png`;
  await driver.saveScreenshot(file);
  console.log(`[e2e] screenshot: ${file}`);
  return file;
}
